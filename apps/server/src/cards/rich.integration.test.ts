import { randomUUID } from 'node:crypto';
import { access, readdir } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RichDoc } from '@unfold/dto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { assetFilePath, isEnoent, removeAssetFiles } from '../assets/files.js';
import { richPlain } from './plain.js';

const username = process.env.SEED_USERNAME;
const password = process.env.SEED_PASSWORD;
if (!username) throw new Error('SEED_USERNAME is not set');
if (!password) throw new Error('SEED_PASSWORD is not set');

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const sampleDoc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '甲' }] },
    { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const a = 1' }] },
    { type: 'blockMath', attrs: { latex: 'x^2' } },
  ],
} satisfies RichDoc;

const samplePlain = '甲\nconst a = 1\nx^2';

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

function oversizedDoc(): RichDoc {
  const probe = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }],
  };
  const base = Buffer.byteLength(JSON.stringify(probe), 'utf8');
  const text = 'a'.repeat(1024 * 1024 + 1 - base);
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

function imageDoc(src: string, alt: string): RichDoc {
  return {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '见图' }] },
      { type: 'image', attrs: { src, alt } },
    ],
  };
}

type UploadFile = { filename: string; type: string; bytes: Buffer };

describe('rich plain', () => {
  it('joins paragraph, code, and block math with newlines', () => {
    expect(richPlain(sampleDoc)).toBe(samplePlain);
    expect(
      richPlain({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: '甲' },
              { type: 'hardBreak' },
              { type: 'text', text: '乙' },
              { type: 'inlineMath', attrs: { latex: 'y' } },
              { type: 'image', attrs: { src: '550e8400-e29b-41d4-a716-446655440000', alt: '图' } },
            ],
          },
          { type: 'mermaid', attrs: { source: 'graph TD' } },
        ],
      }),
    ).toBe('甲乙y图\ngraph TD');
  });
});

describe('rich cards', () => {
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

  async function imageRequest(url: string, file: UploadFile) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.filename);
    const encoded = new Response(form);
    const contentType = encoded.headers.get('content-type');
    if (!contentType) throw new Error('missing content-type');
    return app.inject({
      method: 'POST',
      url,
      payload: Buffer.from(await encoded.arrayBuffer()),
      headers: { cookie, 'content-type': contentType },
    });
  }

  async function createCollection(title: string): Promise<string> {
    const created = await call('POST', '/api/collections', { title });
    expect(created.statusCode).toBe(201);
    return (created.json() as { id: string }).id;
  }

  async function createNode(collectionId: string, name: string): Promise<string> {
    const created = await call('POST', `/api/collections/${collectionId}/nodes`, { name });
    expect(created.statusCode).toBe(201);
    return (created.json() as { id: string }).id;
  }

  async function nodePlain(nodeId: string, cardId: string): Promise<string> {
    const res = await call('GET', `/api/nodes/${nodeId}`);
    expect(res.statusCode).toBe(200);
    const cards = (res.json() as { cards: { id: string; content: { plain?: string } }[] }).cards;
    const card = cards.find((item) => item.id === cardId);
    if (!card) throw new Error('missing card');
    return card.content.plain ?? '';
  }

  async function fileExists(id: string): Promise<boolean> {
    try {
      await access(assetFilePath(id));
      return true;
    } catch (error) {
      if (isEnoent(error)) return false;
      throw error;
    }
  }

  async function listAssetNames(): Promise<string[]> {
    try {
      return (await readdir(loadConfig().assetDir)).sort();
    } catch (error) {
      if (isEnoent(error)) return [];
      throw error;
    }
  }

  async function cleanup(nodeIds: string[], collectionIds: string[], assetIds: string[]) {
    for (const id of nodeIds) await call('DELETE', `/api/nodes/${id}`);
    for (const id of collectionIds) await call('DELETE', `/api/collections/${id}`);
    await removeAssetFiles(assetIds);
  }

  it('rejects a rich card on an edge or a collection edge and does not create it', async () => {
    const token = randomUUID().slice(0, 8);
    const collectionIds: string[] = [];
    const nodeIds: string[] = [];
    try {
      const collectionA = await createCollection(`富文甲${token}`);
      const collectionB = await createCollection(`富文乙${token}`);
      collectionIds.push(collectionA, collectionB);
      const nodeA = await createNode(collectionA, `点甲${token}`);
      const nodeB = await createNode(collectionA, `点乙${token}`);
      nodeIds.push(nodeA, nodeB);

      const edge = await call('POST', '/api/edges', { fromId: nodeA, toId: nodeB, label: '相关' });
      expect(edge.statusCode).toBe(201);
      const edgeId = (edge.json() as { id: string }).id;
      const onEdge = await call('POST', '/api/cards', {
        ownerKind: 'edge',
        ownerId: edgeId,
        type: 'rich',
        content: { doc: sampleDoc },
      });
      expect(onEdge.statusCode).toBe(400);
      expect(errorOf(onEdge.json())).toEqual({ code: 'invalid_body', message: '富文本只挂在点上' });
      const edgeDetail = await call('GET', `/api/edges/${edgeId}`);
      expect(edgeDetail.statusCode).toBe(200);
      expect((edgeDetail.json() as { cards: unknown[] }).cards).toEqual([]);

      const collectionEdge = await call('POST', '/api/collection-edges', {
        fromId: collectionA,
        toId: collectionB,
        label: '相关',
      });
      expect(collectionEdge.statusCode).toBe(201);
      const collectionEdgeId = (collectionEdge.json() as { id: string }).id;
      const onCollectionEdge = await call('POST', '/api/cards', {
        ownerKind: 'collection_edge',
        ownerId: collectionEdgeId,
        type: 'rich',
        content: { doc: sampleDoc },
      });
      expect(onCollectionEdge.statusCode).toBe(400);
      expect(errorOf(onCollectionEdge.json())).toEqual({ code: 'invalid_body', message: '富文本只挂在点上' });
      const collectionEdgeDetail = await call('GET', `/api/collection-edges/${collectionEdgeId}`);
      expect(collectionEdgeDetail.statusCode).toBe(200);
      expect((collectionEdgeDetail.json() as { cards: unknown[] }).cards).toEqual([]);
    } finally {
      await cleanup(nodeIds, collectionIds, []);
    }
  });

  it('stores server plain and keeps the old doc when an image or the size is rejected', async () => {
    const token = randomUUID().slice(0, 8);
    const collectionIds: string[] = [];
    const nodeIds: string[] = [];
    const assetIds: string[] = [];
    try {
      const collectionId = await createCollection(`富文存${token}`);
      collectionIds.push(collectionId);
      const nodeId = await createNode(collectionId, `点存${token}`);
      nodeIds.push(nodeId);

      const withImage = await call('POST', '/api/cards', {
        ownerKind: 'node',
        ownerId: nodeId,
        type: 'rich',
        content: { doc: imageDoc(randomUUID(), '还没有') },
      });
      expect(withImage.statusCode).toBe(400);
      expect(errorOf(withImage.json())).toEqual({ code: 'invalid_body', message: '文稿里有找不到的图片' });
      const emptyDetail = await call('GET', `/api/nodes/${nodeId}`);
      expect((emptyDetail.json() as { cards: unknown[] }).cards).toEqual([]);

      const created = await call('POST', '/api/cards', {
        ownerKind: 'node',
        ownerId: nodeId,
        type: 'rich',
        content: { doc: sampleDoc },
      });
      expect(created.statusCode).toBe(201);
      const card = created.json() as { id: string; type: string; content: { doc: RichDoc; plain: string } };
      expect(card.type).toBe('rich');
      expect(card.content.plain).toBe(samplePlain);
      expect(card.content.doc).toEqual(sampleDoc);

      const note = await call('POST', '/api/cards', {
        ownerKind: 'node',
        ownerId: nodeId,
        type: 'note',
        content: { body: '旧' },
      });
      expect(note.statusCode).toBe(201);
      const noteId = (note.json() as { id: string }).id;
      const notePatch = await call('PATCH', `/api/cards/${noteId}`, { content: { body: '新' } });
      expect(notePatch.statusCode).toBe(200);
      expect((notePatch.json() as { content: { body: string } }).content).toEqual({ body: '新' });

      const rewritten = await call('PATCH', `/api/cards/${card.id}`, {
        content: { doc: sampleDoc, plain: '客户端写的' },
      });
      expect(rewritten.statusCode).toBe(200);
      expect((rewritten.json() as { content: { plain: string } }).content.plain).toBe(samplePlain);

      const uploaded = await imageRequest(`/api/collections/${collectionId}/images`, {
        filename: '别人.png',
        type: 'image/png',
        bytes: png,
      });
      expect(uploaded.statusCode).toBe(201);
      const imageNodeId = (uploaded.json() as { id: string }).id;
      nodeIds.push(imageNodeId);
      const graph = await call('GET', `/api/collections/${collectionId}/graph`);
      const foreignId = (graph.json() as { nodes: { id: string; assetId: string | null }[] }).nodes.find(
        (node) => node.id === imageNodeId,
      )?.assetId;
      expect(foreignId).toEqual(expect.any(String));
      if (!foreignId) throw new Error('missing asset');
      assetIds.push(foreignId);

      const foreign = await call('PATCH', `/api/cards/${card.id}`, {
        content: { doc: imageDoc(foreignId, '别人的图'), plain: '假' },
      });
      expect(foreign.statusCode).toBe(400);
      expect(errorOf(foreign.json())).toEqual({ code: 'invalid_body', message: '文稿里有找不到的图片' });
      expect(await nodePlain(nodeId, card.id)).toBe(samplePlain);
      const foreignBytes = await call('GET', `/api/assets/${foreignId}`);
      expect(foreignBytes.statusCode).toBe(200);

      const huge = oversizedDoc();
      expect(Buffer.byteLength(JSON.stringify(huge), 'utf8')).toBeGreaterThan(1024 * 1024);
      const tooBig = await call('PATCH', `/api/cards/${card.id}`, { content: { doc: huge } });
      expect(tooBig.statusCode).toBe(400);
      expect(errorOf(tooBig.json())).toEqual({ code: 'invalid_body', message: '这篇文稿太大了' });
      expect(await nodePlain(nodeId, card.id)).toBe(samplePlain);
    } finally {
      await cleanup(nodeIds, collectionIds, assetIds);
    }
  });

  it('deletes card images that the doc no longer uses, and deletes them with the card or the node', async () => {
    const token = randomUUID().slice(0, 8);
    const collectionIds: string[] = [];
    const nodeIds: string[] = [];
    const assetIds: string[] = [];
    try {
      const collectionId = await createCollection(`富文图${token}`);
      collectionIds.push(collectionId);
      const nodeId = await createNode(collectionId, `点图${token}`);
      nodeIds.push(nodeId);
      const created = await call('POST', '/api/cards', {
        ownerKind: 'node',
        ownerId: nodeId,
        type: 'rich',
        content: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
      });
      expect(created.statusCode).toBe(201);
      const cardId = (created.json() as { id: string }).id;

      const first = await imageRequest(`/api/cards/${cardId}/assets`, {
        filename: '甲.png',
        type: 'image/png',
        bytes: png,
      });
      expect(first.statusCode).toBe(201);
      const firstBody = first.json() as { id: string };
      expect(Object.keys(firstBody)).toEqual(['id']);
      const firstId = firstBody.id;
      assetIds.push(firstId);

      const second = await imageRequest(`/api/cards/${cardId}/assets`, {
        filename: '乙.png',
        type: 'image/png',
        bytes: png,
      });
      expect(second.statusCode).toBe(201);
      const secondId = (second.json() as { id: string }).id;
      assetIds.push(secondId);

      const kept = await call('PATCH', `/api/cards/${cardId}`, {
        content: { doc: imageDoc(firstId, '示意图'), plain: '丢掉' },
      });
      expect(kept.statusCode).toBe(200);
      expect((kept.json() as { content: { plain: string } }).content.plain).toBe('见图\n示意图');
      expect((await call('GET', `/api/assets/${firstId}`)).statusCode).toBe(200);
      expect((await call('GET', `/api/assets/${secondId}`)).statusCode).toBe(404);
      expect(errorOf((await call('GET', `/api/assets/${secondId}`)).json()).code).toBe('not_found');
      expect(await fileExists(secondId)).toBe(false);
      expect(await fileExists(firstId)).toBe(true);

      const cleared = await call('PATCH', `/api/cards/${cardId}`, {
        content: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
      });
      expect(cleared.statusCode).toBe(200);
      expect((await call('GET', `/api/assets/${firstId}`)).statusCode).toBe(404);
      expect(await fileExists(firstId)).toBe(false);

      const third = await imageRequest(`/api/cards/${cardId}/assets`, {
        filename: '丙.png',
        type: 'image/png',
        bytes: png,
      });
      expect(third.statusCode).toBe(201);
      const thirdId = (third.json() as { id: string }).id;
      assetIds.push(thirdId);
      const removed = await call('DELETE', `/api/cards/${cardId}`);
      expect(removed.statusCode).toBe(204);
      expect((await call('GET', `/api/assets/${thirdId}`)).statusCode).toBe(404);
      expect(await fileExists(thirdId)).toBe(false);

      const again = await call('POST', '/api/cards', {
        ownerKind: 'node',
        ownerId: nodeId,
        type: 'rich',
        content: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
      });
      expect(again.statusCode).toBe(201);
      const againId = (again.json() as { id: string }).id;
      const fourth = await imageRequest(`/api/cards/${againId}/assets`, {
        filename: '丁.png',
        type: 'image/png',
        bytes: png,
      });
      expect(fourth.statusCode).toBe(201);
      const fourthId = (fourth.json() as { id: string }).id;
      assetIds.push(fourthId);
      const removedNode = await call('DELETE', `/api/nodes/${nodeId}`);
      expect(removedNode.statusCode).toBe(204);
      nodeIds.splice(nodeIds.indexOf(nodeId), 1);
      expect((await call('GET', `/api/assets/${fourthId}`)).statusCode).toBe(404);
      expect(await fileExists(fourthId)).toBe(false);
    } finally {
      await cleanup(nodeIds, collectionIds, assetIds);
    }
  });

  it('does not create an asset for a non-rich card or a rejected image', async () => {
    const token = randomUUID().slice(0, 8);
    const collectionIds: string[] = [];
    const nodeIds: string[] = [];
    try {
      const collectionId = await createCollection(`富文拒${token}`);
      collectionIds.push(collectionId);
      const nodeId = await createNode(collectionId, `点拒${token}`);
      nodeIds.push(nodeId);
      const note = await call('POST', '/api/cards', {
        ownerKind: 'node',
        ownerId: nodeId,
        type: 'note',
        content: { body: '' },
      });
      expect(note.statusCode).toBe(201);
      const noteId = (note.json() as { id: string }).id;

      const before = await listAssetNames();
      const missing = await imageRequest(`/api/cards/${randomUUID()}/assets`, {
        filename: '无.png',
        type: 'image/png',
        bytes: png,
      });
      expect(missing.statusCode).toBe(404);
      expect(errorOf(missing.json()).code).toBe('not_found');

      const onNote = await imageRequest(`/api/cards/${noteId}/assets`, {
        filename: '笔记.png',
        type: 'image/png',
        bytes: png,
      });
      expect(onNote.statusCode).toBe(404);
      expect(errorOf(onNote.json()).code).toBe('not_found');

      const rich = await call('POST', '/api/cards', {
        ownerKind: 'node',
        ownerId: nodeId,
        type: 'rich',
        content: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
      });
      expect(rich.statusCode).toBe(201);
      const cardId = (rich.json() as { id: string }).id;
      const badType = await imageRequest(`/api/cards/${cardId}/assets`, {
        filename: '图.svg',
        type: 'image/svg+xml',
        bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      });
      expect(badType.statusCode).toBe(400);
      expect(errorOf(badType.json())).toEqual({
        code: 'invalid_body',
        message: '只能放入 JPEG、PNG、WebP 或 GIF',
      });

      const tooBig = await imageRequest(`/api/cards/${cardId}/assets`, {
        filename: '太大.png',
        type: 'image/png',
        bytes: Buffer.alloc(10 * 1024 * 1024 + 1),
      });
      expect(tooBig.statusCode).toBe(400);
      expect(errorOf(tooBig.json())).toEqual({ code: 'invalid_body', message: '图片不能超过 10 MB' });
      expect(await listAssetNames()).toEqual(before);
    } finally {
      await cleanup(nodeIds, collectionIds, []);
    }
  });
});
