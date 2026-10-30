import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.js';

const username = process.env.SEED_USERNAME;
const password = process.env.SEED_PASSWORD;
if (!username) throw new Error('SEED_USERNAME is not set');
if (!password) throw new Error('SEED_PASSWORD is not set');

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

type GraphNode = {
  id: string;
  name: string;
  description: string;
  kind: string;
  x: number | null;
  y: number | null;
  z: number | null;
  imageWidth: number | null;
  assetId: string | null;
  cardCount: number;
  cardTypes: string[];
  parentId: string | null;
  outlineOrder: number;
};

describe('canvas placements', () => {
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
    return app.inject({
      method,
      url,
      payload,
      headers: { cookie },
    });
  }

  async function graphOf(collectionId: string) {
    const res = await call('GET', `/api/collections/${collectionId}/graph`);
    expect(res.statusCode).toBe(200);
    return res.json() as { nodes: GraphNode[]; edges: unknown[] };
  }

  function findNode(nodes: GraphNode[], id: string): GraphNode {
    const node = nodes.find((item) => item.id === id);
    if (!node) throw new Error(`missing node ${id}`);
    return node;
  }

  it('reads and writes placement only on this collection', async () => {
    const token = randomUUID();
    const sharedName = `点甲${token}`;
    const otherName = `点乙${token}`;
    const created = { collections: [] as string[], nodes: [] as string[] };

    try {
      const collectionARes = await call('POST', '/api/collections', { title: `合集甲${token}` });
      const collectionBRes = await call('POST', '/api/collections', { title: `合集乙${token}` });
      expect(collectionARes.statusCode).toBe(201);
      expect(collectionBRes.statusCode).toBe(201);
      const collectionA = collectionARes.json() as { id: string };
      const collectionB = collectionBRes.json() as { id: string };
      created.collections.push(collectionA.id, collectionB.id);

      const sharedRes = await call('POST', `/api/collections/${collectionA.id}/nodes`, { name: sharedName });
      expect(sharedRes.statusCode).toBe(201);
      const shared = sharedRes.json() as { id: string; name: string };
      expect(shared).toMatchObject({ id: shared.id, name: sharedName });
      created.nodes.push(shared.id);

      const otherRes = await call('POST', `/api/collections/${collectionB.id}/nodes`, { name: otherName });
      expect(otherRes.statusCode).toBe(201);
      const other = otherRes.json() as { id: string };
      created.nodes.push(other.id);

      const joined = await call('POST', `/api/collections/${collectionB.id}/members`, { nodeId: shared.id });
      expect(joined.statusCode).toBe(200);

      const emptyA = await graphOf(collectionA.id);
      expect(emptyA.edges).toEqual([]);
      expect(findNode(emptyA.nodes, shared.id)).toEqual({
        id: shared.id,
        name: sharedName,
        description: '',
        kind: 'text',
        x: null,
        y: null,
        z: null,
        imageWidth: null,
        assetId: null,
        cardCount: 0,
        cardTypes: [],
        parentId: null,
        outlineOrder: 0,
      });

      const emptyB = await graphOf(collectionB.id);
      expect(findNode(emptyB.nodes, shared.id)).toMatchObject({
        kind: 'text',
        x: null,
        y: null,
        z: null,
        imageWidth: null,
        assetId: null,
      });

      const missing = await call('PATCH', `/api/collections/${randomUUID()}/placements`, {
        placements: [],
      });
      expect(missing.statusCode).toBe(404);
      expect(errorOf(missing.json())).toEqual({ code: 'not_found', message: '合集没有找到' });

      const emptyWrite = await call('PATCH', `/api/collections/${collectionA.id}/placements`, {
        placements: [],
      });
      expect(emptyWrite.statusCode).toBe(204);
      expect(findNode((await graphOf(collectionA.id)).nodes, shared.id).x).toBeNull();

      const saved = await call('PATCH', `/api/collections/${collectionA.id}/placements`, {
        placements: [{ nodeId: shared.id, x: 12.5, y: -4, z: 7, imageWidth: 200 }],
      });
      expect(saved.statusCode).toBe(204);

      const placed = findNode((await graphOf(collectionA.id)).nodes, shared.id);
      expect(placed).toMatchObject({
        id: shared.id,
        name: sharedName,
        description: '',
        kind: 'text',
        x: 12.5,
        y: -4,
        z: 7,
        imageWidth: null,
        assetId: null,
      });
      expect(findNode((await graphOf(collectionB.id)).nodes, shared.id)).toMatchObject({
        x: null,
        y: null,
        z: null,
        imageWidth: null,
      });
      expect(findNode((await graphOf(collectionB.id)).nodes, other.id)).toMatchObject({
        x: null,
        y: null,
        z: null,
        imageWidth: null,
      });

      const notMember = await call('PATCH', `/api/collections/${collectionA.id}/placements`, {
        placements: [
          { nodeId: shared.id, x: 99, y: 99, z: 99 },
          { nodeId: other.id, x: 1, y: 1, z: 1 },
        ],
      });
      expect(notMember.statusCode).toBe(400);
      expect(errorOf(notMember.json()).code).toBe('invalid_body');

      const infinite = await app.inject({
        method: 'PATCH',
        url: `/api/collections/${collectionA.id}/placements`,
        headers: { cookie, 'content-type': 'application/json' },
        payload: `{"placements":[{"nodeId":${JSON.stringify(shared.id)},"x":1e309,"y":0,"z":0}]}`,
      });
      expect(infinite.statusCode).toBe(400);
      expect(errorOf(infinite.json()).code).toBe('invalid_body');

      const notNumber = await call('PATCH', `/api/collections/${collectionA.id}/placements`, {
        placements: [{ nodeId: shared.id, x: '12', y: 0, z: 0 }],
      });
      expect(notNumber.statusCode).toBe(400);
      expect(errorOf(notNumber.json()).code).toBe('invalid_body');

      const afterReject = findNode((await graphOf(collectionA.id)).nodes, shared.id);
      expect(afterReject).toMatchObject({ x: 12.5, y: -4, z: 7, imageWidth: null, kind: 'text' });
      expect(findNode((await graphOf(collectionB.id)).nodes, shared.id)).toMatchObject({
        x: null,
        y: null,
        z: null,
        imageWidth: null,
      });

      const detail = await call('GET', `/api/nodes/${shared.id}`);
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).not.toHaveProperty('kind');
    } finally {
      for (const id of created.nodes) await call('DELETE', `/api/nodes/${id}`);
      for (const id of created.collections) await call('DELETE', `/api/collections/${id}`);
    }
  });
});
