import { randomUUID } from 'node:crypto';
import { access, readdir } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { loadConfig } from '../config.js';
import { buildApp } from '../app.js';
import { assetFilePath, isEnoent, removeAssetFiles } from './files.js';

const username = process.env.SEED_USERNAME;
const password = process.env.SEED_PASSWORD;
if (!username) throw new Error('SEED_USERNAME is not set');
if (!password) throw new Error('SEED_PASSWORD is not set');

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

type UploadFile = { filename: string; type: string; bytes: Buffer };

type GraphNode = {
  id: string;
  name: string;
  kind: string;
  x: number | null;
  y: number | null;
  z: number | null;
  imageWidth: number | null;
  assetId: string | null;
};

function cookiePair(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!header) throw new Error('missing set-cookie');
  const pair = header.split(';')[0];
  if (!pair) throw new Error('missing set-cookie');
  return pair;
}

function errorOf(body: { error?: { code?: string; message?: string } }) {
  return body.error ?? { code: '', message: '' };
}

describe('image assets', () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username, password },
    });
    expect(login.statusCode).toBe(200);
    cookie = cookiePair(login.headers['set-cookie']);
  });

  afterAll(async () => {
    await app.close();
  });

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> {
    return app.inject({ method, url, payload, headers: { cookie } });
  }

  async function imageRequest(
    method: 'POST' | 'PUT',
    url: string,
    file: UploadFile,
    fields?: Record<string, string>,
    withCookie = true,
  ) {
    const form = new FormData();
    if (fields) {
      for (const [key, value] of Object.entries(fields)) form.append(key, value);
    }
    form.append('file', new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.filename);
    const encoded = new Response(form);
    const contentType = encoded.headers.get('content-type');
    if (!contentType) throw new Error('missing content-type');
    return app.inject({
      method,
      url,
      payload: Buffer.from(await encoded.arrayBuffer()),
      headers: {
        ...(withCookie ? { cookie } : {}),
        'content-type': contentType,
      },
    });
  }

  async function createCollection(): Promise<string> {
    const created = await call('POST', '/api/collections', { title: `图${randomUUID().slice(0, 8)}` });
    expect(created.statusCode).toBe(201);
    return (created.json() as { id: string }).id;
  }

  async function graphNodes(collectionId: string): Promise<GraphNode[]> {
    const res = await call('GET', `/api/collections/${collectionId}/graph`);
    expect(res.statusCode).toBe(200);
    return (res.json() as { nodes: GraphNode[] }).nodes;
  }

  async function listAssetNames(): Promise<string[]> {
    try {
      return (await readdir(loadConfig().assetDir)).sort();
    } catch (error) {
      if (isEnoent(error)) return [];
      throw error;
    }
  }

  async function cleanup(nodeIds: string[], collectionId?: string, assetIds: string[] = []) {
    for (const id of nodeIds) await call('DELETE', `/api/nodes/${id}`);
    if (collectionId) await call('DELETE', `/api/collections/${collectionId}`);
    await removeAssetFiles(assetIds);
  }

  it('creates an image node and returns the same bytes', async () => {
    let collectionId: string | undefined;
    const nodeIds: string[] = [];
    const assetIds: string[] = [];
    try {
      collectionId = await createCollection();
      const created = await imageRequest('POST', `/api/collections/${collectionId}/images`, {
        filename: '样本图.png',
        type: 'image/png',
        bytes: png,
      });
      expect(created.statusCode).toBe(201);
      const body = created.json() as { id: string; name: string };
      expect(body.name).toBe('样本图');
      expect(Object.keys(body).sort()).toEqual(['id', 'name']);
      nodeIds.push(body.id);

      const node = (await graphNodes(collectionId)).find((item) => item.id === body.id);
      expect(node).toMatchObject({ kind: 'image', name: '样本图' });
      expect(node?.assetId).toEqual(expect.any(String));
      if (!node?.assetId) throw new Error('missing asset');
      assetIds.push(node.assetId);

      const anon = await app.inject({ method: 'GET', url: `/api/assets/${node.assetId}` });
      expect(anon.statusCode).toBe(401);
      expect(errorOf(anon.json())).toEqual({ code: 'unauthenticated', message: '未登录' });

      const fetched = await call('GET', `/api/assets/${node.assetId}`);
      expect(fetched.statusCode).toBe(200);
      expect(fetched.headers['content-type']).toBe('image/png');
      expect(fetched.headers['x-content-type-options']).toBe('nosniff');
      expect(fetched.headers['content-disposition']).toBe('inline');
      expect(Buffer.from(fetched.rawPayload).equals(png)).toBe(true);
    } finally {
      await cleanup(nodeIds, collectionId, assetIds);
    }
  });

  it('writes finite x and y and ignores a single coordinate', async () => {
    let collectionId: string | undefined;
    const nodeIds: string[] = [];
    try {
      collectionId = await createCollection();
      const placed = await imageRequest(
        'POST',
        `/api/collections/${collectionId}/images`,
        { filename: '样本图.png', type: 'image/png', bytes: png },
        { x: '12.5', y: '-4' },
      );
      expect(placed.statusCode).toBe(201);
      const placedId = (placed.json() as { id: string }).id;
      nodeIds.push(placedId);
      expect((await graphNodes(collectionId)).find((item) => item.id === placedId)).toMatchObject({
        x: 12.5,
        y: -4,
        z: 1,
      });

      const half = await imageRequest(
        'POST',
        `/api/collections/${collectionId}/images`,
        { filename: '只有横.png', type: 'image/png', bytes: png },
        { x: '3' },
      );
      expect(half.statusCode).toBe(201);
      const halfId = (half.json() as { id: string }).id;
      nodeIds.push(halfId);
      expect((await graphNodes(collectionId)).find((item) => item.id === halfId)).toMatchObject({
        x: null,
        y: null,
        z: null,
      });
    } finally {
      await cleanup(nodeIds, collectionId);
    }
  });

  it('derives the name from the filename', async () => {
    let collectionId: string | undefined;
    const nodeIds: string[] = [];
    try {
      collectionId = await createCollection();
      const cases: { filename: string; name: string }[] = [
        { filename: '档案.tar.png', name: '档案.tar' },
        { filename: '.png', name: '图片' },
        { filename: `${'名'.repeat(81)}.png`, name: '名'.repeat(80) },
      ];
      for (const item of cases) {
        const created = await imageRequest('POST', `/api/collections/${collectionId}/images`, {
          filename: item.filename,
          type: 'image/png',
          bytes: png,
        });
        expect(created.statusCode).toBe(201);
        const body = created.json() as { id: string; name: string };
        nodeIds.push(body.id);
        expect(body.name).toBe(item.name);
      }
    } finally {
      await cleanup(nodeIds, collectionId);
    }
  });

  it('rejects a text file without creating a node or a file', async () => {
    let collectionId: string | undefined;
    try {
      collectionId = await createCollection();
      const before = await listAssetNames();
      const created = await imageRequest('POST', `/api/collections/${collectionId}/images`, {
        filename: '笔记.txt',
        type: 'text/plain',
        bytes: Buffer.from('不是图片'),
      });
      expect(created.statusCode).toBe(400);
      expect(errorOf(created.json())).toEqual({
        code: 'invalid_body',
        message: '只能放入 JPEG、PNG、WebP 或 GIF',
      });
      expect(await graphNodes(collectionId)).toEqual([]);
      expect(await listAssetNames()).toEqual(before);
    } finally {
      await cleanup([], collectionId);
    }
  });

  it('rejects an empty image without creating a node', async () => {
    let collectionId: string | undefined;
    try {
      collectionId = await createCollection();
      const before = await listAssetNames();
      const created = await imageRequest('POST', `/api/collections/${collectionId}/images`, {
        filename: '空.png',
        type: 'image/png',
        bytes: Buffer.alloc(0),
      });
      expect(created.statusCode).toBe(400);
      expect(errorOf(created.json())).toEqual({
        code: 'invalid_body',
        message: '只能放入 JPEG、PNG、WebP 或 GIF',
      });
      expect(await graphNodes(collectionId)).toEqual([]);
      expect(await listAssetNames()).toEqual(before);
    } finally {
      await cleanup([], collectionId);
    }
  });

  it('rejects an image larger than 10 MiB without creating a node', async () => {
    let collectionId: string | undefined;
    try {
      collectionId = await createCollection();
      const before = await listAssetNames();
      const created = await imageRequest('POST', `/api/collections/${collectionId}/images`, {
        filename: '太大.png',
        type: 'image/png',
        bytes: Buffer.alloc(10 * 1024 * 1024 + 1),
      });
      expect(created.statusCode).toBe(400);
      expect(errorOf(created.json())).toEqual({ code: 'invalid_body', message: '图片不能超过 10 MB' });
      expect(await graphNodes(collectionId)).toEqual([]);
      expect(await listAssetNames()).toEqual(before);
    } finally {
      await cleanup([], collectionId);
    }
  });

  it('accepts an image of exactly 10 MiB', async () => {
    let collectionId: string | undefined;
    const nodeIds: string[] = [];
    const bytes = Buffer.alloc(10 * 1024 * 1024, 7);
    try {
      collectionId = await createCollection();
      const created = await imageRequest('POST', `/api/collections/${collectionId}/images`, {
        filename: '正好.png',
        type: 'image/png',
        bytes,
      });
      expect(created.statusCode).toBe(201);
      const nodeId = (created.json() as { id: string }).id;
      nodeIds.push(nodeId);
      const assetId = (await graphNodes(collectionId)).find((item) => item.id === nodeId)?.assetId;
      expect(assetId).toEqual(expect.any(String));
      if (!assetId) throw new Error('missing asset');
      const fetched = await call('GET', `/api/assets/${assetId}`);
      expect(fetched.statusCode).toBe(200);
      expect(Buffer.from(fetched.rawPayload).equals(bytes)).toBe(true);
    } finally {
      await cleanup(nodeIds, collectionId);
    }
  });

  it('does not replace a text node', async () => {
    let collectionId: string | undefined;
    const nodeIds: string[] = [];
    try {
      collectionId = await createCollection();
      const created = await call('POST', `/api/collections/${collectionId}/nodes`, { name: '文字' });
      expect(created.statusCode).toBe(201);
      const nodeId = (created.json() as { id: string }).id;
      nodeIds.push(nodeId);
      const replaced = await imageRequest('PUT', `/api/nodes/${nodeId}/image`, {
        filename: '样本图.png',
        type: 'image/png',
        bytes: png,
      });
      expect(replaced.statusCode).toBe(400);
      expect(errorOf(replaced.json())).toEqual({ code: 'invalid_body', message: '这是文字点' });
      expect((await graphNodes(collectionId)).find((item) => item.id === nodeId)?.assetId).toBeNull();
    } finally {
      await cleanup(nodeIds, collectionId);
    }
  });

  it('replaces an image and retires the previous asset', async () => {
    let collectionId: string | undefined;
    const nodeIds: string[] = [];
    const next = Buffer.from('GIF89a-next');
    try {
      collectionId = await createCollection();
      const created = await imageRequest('POST', `/api/collections/${collectionId}/images`, {
        filename: '样本图.png',
        type: 'image/png',
        bytes: png,
      });
      expect(created.statusCode).toBe(201);
      const nodeId = (created.json() as { id: string }).id;
      nodeIds.push(nodeId);
      const previous = (await graphNodes(collectionId)).find((item) => item.id === nodeId)?.assetId;
      if (!previous) throw new Error('missing asset');

      const replaced = await imageRequest('PUT', `/api/nodes/${nodeId}/image`, {
        filename: '另一张.gif',
        type: 'image/gif',
        bytes: next,
      });
      expect(replaced.statusCode).toBe(200);
      const body = replaced.json() as { id: string };
      expect(body.id).not.toBe(previous);
      expect((await graphNodes(collectionId)).find((item) => item.id === nodeId)?.assetId).toBe(body.id);

      const fetched = await call('GET', `/api/assets/${body.id}`);
      expect(fetched.statusCode).toBe(200);
      expect(fetched.headers['content-type']).toBe('image/gif');
      expect(Buffer.from(fetched.rawPayload).equals(next)).toBe(true);

      const gone = await call('GET', `/api/assets/${previous}`);
      expect(gone.statusCode).toBe(404);
      expect(errorOf(gone.json()).code).toBe('not_found');
      await expect(access(assetFilePath(previous))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await cleanup(nodeIds, collectionId);
    }
  });

  it('clamps image width to 120–480', async () => {
    let collectionId: string | undefined;
    const nodeIds: string[] = [];
    try {
      collectionId = await createCollection();
      const created = await imageRequest('POST', `/api/collections/${collectionId}/images`, {
        filename: '样本图.png',
        type: 'image/png',
        bytes: png,
      });
      expect(created.statusCode).toBe(201);
      const nodeId = (created.json() as { id: string }).id;
      nodeIds.push(nodeId);

      const narrow = await call('PATCH', `/api/collections/${collectionId}/placements`, {
        placements: [{ nodeId, x: 0, y: 0, z: 1, imageWidth: 10 }],
      });
      expect(narrow.statusCode).toBe(204);
      expect((await graphNodes(collectionId)).find((item) => item.id === nodeId)?.imageWidth).toBe(120);

      const wide = await call('PATCH', `/api/collections/${collectionId}/placements`, {
        placements: [{ nodeId, x: 0, y: 0, z: 1, imageWidth: 900 }],
      });
      expect(wide.statusCode).toBe(204);
      expect((await graphNodes(collectionId)).find((item) => item.id === nodeId)?.imageWidth).toBe(480);
    } finally {
      await cleanup(nodeIds, collectionId);
    }
  });

  it('deletes the asset file when the node is deleted', async () => {
    let collectionId: string | undefined;
    try {
      collectionId = await createCollection();
      const created = await imageRequest('POST', `/api/collections/${collectionId}/images`, {
        filename: '样本图.png',
        type: 'image/png',
        bytes: png,
      });
      expect(created.statusCode).toBe(201);
      const nodeId = (created.json() as { id: string }).id;
      const assetId = (await graphNodes(collectionId)).find((item) => item.id === nodeId)?.assetId;
      if (!assetId) throw new Error('missing asset');
      await expect(access(assetFilePath(assetId))).resolves.toBeUndefined();

      const removed = await call('DELETE', `/api/nodes/${nodeId}`);
      expect(removed.statusCode).toBe(204);
      const gone = await call('GET', `/api/assets/${assetId}`);
      expect(gone.statusCode).toBe(404);
      expect(errorOf(gone.json()).code).toBe('not_found');
      await expect(access(assetFilePath(assetId))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await cleanup([], collectionId);
    }
  });

  it('keeps the image when the collection is deleted', async () => {
    let collectionId: string | undefined;
    const nodeIds: string[] = [];
    try {
      collectionId = await createCollection();
      const created = await imageRequest('POST', `/api/collections/${collectionId}/images`, {
        filename: '样本图.png',
        type: 'image/png',
        bytes: png,
      });
      expect(created.statusCode).toBe(201);
      const nodeId = (created.json() as { id: string }).id;
      nodeIds.push(nodeId);
      const assetId = (await graphNodes(collectionId)).find((item) => item.id === nodeId)?.assetId;
      if (!assetId) throw new Error('missing asset');

      const removed = await call('DELETE', `/api/collections/${collectionId}`);
      expect(removed.statusCode).toBe(204);
      collectionId = undefined;
      const fetched = await call('GET', `/api/assets/${assetId}`);
      expect(fetched.statusCode).toBe(200);
      expect(Buffer.from(fetched.rawPayload).equals(png)).toBe(true);
      await expect(access(assetFilePath(assetId))).resolves.toBeUndefined();
    } finally {
      await cleanup(nodeIds, collectionId);
    }
  });

  it('reports a missing collection and does not keep the file', async () => {
    const before = await listAssetNames();
    const created = await imageRequest('POST', `/api/collections/${randomUUID()}/images`, {
      filename: '样本图.png',
      type: 'image/png',
      bytes: png,
    });
    expect(created.statusCode).toBe(404);
    expect(errorOf(created.json())).toEqual({ code: 'not_found', message: '合集没有找到' });
    expect(await listAssetNames()).toEqual(before);
  });
});
