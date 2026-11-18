import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import { buildApp } from '../app.js';
import { createPool } from '../db/client.js';

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

type Side = 'left' | 'right' | null;

type GNode = {
  id: string;
  parentId: string | null;
  outlineOrder: number;
  layoutSide: Side;
};

type Graph = {
  layoutDirection: 'right' | 'left' | 'both';
  outlineVersion: number;
  nodes: GNode[];
};

type Created = {
  id: string;
  parentId: string | null;
  outlineOrder: number;
  outlineVersion: number;
};

type Owned = { nodes: string[]; collections: string[] };

describe('mindmap direction', () => {
  let app: FastifyInstance;
  let pool: Pool;
  let cookie: string;

  beforeAll(async () => {
    app = await buildApp();
    pool = createPool();
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username, password } });
    expect(login.statusCode).toBe(200);
    cookie = cookiePair(login.headers['set-cookie']);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
    withCookie: string | false = cookie,
  ): Promise<LightMyRequestResponse> {
    return app.inject({
      method,
      url,
      payload,
      headers: withCookie ? { cookie: withCookie } : undefined,
    });
  }

  async function makeCollection(created: Owned, title: string): Promise<string> {
    const res = await call('POST', '/api/collections', { title });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { id: string }).id;
    created.collections.push(id);
    return id;
  }

  async function makeNode(
    created: Owned,
    collectionId: string,
    name: string,
    extra?: { parentId?: string | null },
  ): Promise<Created> {
    const res = await call('POST', `/api/collections/${collectionId}/nodes`, { name, ...extra });
    const body = res.json() as Partial<Created>;
    if (body.id) created.nodes.push(body.id);
    expect(res.statusCode).toBe(201);
    return body as Created;
  }

  async function graphOf(collectionId: string): Promise<Graph> {
    const res = await call('GET', `/api/collections/${collectionId}/graph`);
    expect(res.statusCode).toBe(200);
    return res.json() as Graph;
  }

  function nodeOf(graph: Graph, id: string): GNode {
    const node = graph.nodes.find((item) => item.id === id);
    if (!node) throw new Error(`missing node ${id}`);
    return node;
  }

  function patchLayout(collectionId: string, direction: 'right' | 'left' | 'both', withCookie: string | false = cookie) {
    return call('PATCH', `/api/collections/${collectionId}/layout`, { direction }, withCookie);
  }

  function patchSide(collectionId: string, nodeId: string, side: 'left' | 'right', withCookie: string | false = cookie) {
    return call('PATCH', `/api/collections/${collectionId}/members/${nodeId}/side`, { side }, withCookie);
  }

  async function cleanup(created: Owned) {
    for (const id of created.nodes) await call('DELETE', `/api/nodes/${id}`);
    for (const id of created.collections) await call('DELETE', `/api/collections/${id}`);
  }

  it('starts to the right and leaves new nodes unsided', async () => {
    const token = randomUUID();
    const created: Owned = { nodes: [], collections: [] };
    try {
      const collectionId = await makeCollection(created, `朝向${token}`);
      expect((await graphOf(collectionId)).layoutDirection).toBe('right');
      const root = await makeNode(created, collectionId, `根${token}`);
      const child = await makeNode(created, collectionId, `子${token}`, { parentId: root.id });
      const graph = await graphOf(collectionId);
      expect(graph.layoutDirection).toBe('right');
      expect(nodeOf(graph, root.id).layoutSide).toBeNull();
      expect(nodeOf(graph, child.id).layoutSide).toBeNull();
    } finally {
      await cleanup(created);
    }
  });

  it('fills empty direct children once when the direction becomes both', async () => {
    const token = randomUUID();
    const created: Owned = { nodes: [], collections: [] };
    try {
      const collectionId = await makeCollection(created, `两侧${token}`);
      const root = await makeNode(created, collectionId, `根${token}`);
      const even = await makeNode(created, collectionId, `偶${token}`, { parentId: root.id });
      const kept = await makeNode(created, collectionId, `留${token}`, { parentId: root.id });
      const secondEven = await makeNode(created, collectionId, `偶2${token}`, { parentId: root.id });
      const odd = await makeNode(created, collectionId, `奇${token}`, { parentId: root.id });
      const grand = await makeNode(created, collectionId, `孙${token}`, { parentId: even.id });
      const marked = await patchSide(collectionId, kept.id, 'right');
      expect(marked.statusCode).toBe(200);
      expect(marked.json()).toEqual({ side: 'right' });
      const before = await graphOf(collectionId);
      const version = before.outlineVersion;
      expect(nodeOf(before, kept.id)).toMatchObject({ outlineOrder: 1, layoutSide: 'right' });

      const turned = await patchLayout(collectionId, 'both');
      expect(turned.statusCode).toBe(200);
      expect(turned.json()).toEqual({ direction: 'both' });
      const graph = await graphOf(collectionId);
      expect(graph.layoutDirection).toBe('both');
      expect(graph.outlineVersion).toBe(version);
      expect(nodeOf(graph, root.id).layoutSide).toBeNull();
      expect(nodeOf(graph, even.id)).toMatchObject({ outlineOrder: 0, layoutSide: 'right' });
      expect(nodeOf(graph, kept.id)).toMatchObject({ outlineOrder: 1, layoutSide: 'right' });
      expect(nodeOf(graph, secondEven.id)).toMatchObject({ outlineOrder: 2, layoutSide: 'right' });
      expect(nodeOf(graph, odd.id)).toMatchObject({ outlineOrder: 3, layoutSide: 'left' });
      expect(nodeOf(graph, grand.id)).toMatchObject({ layoutSide: null, parentId: even.id });

      const again = await patchLayout(collectionId, 'both');
      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual({ direction: 'both' });
      const after = await graphOf(collectionId);
      expect(after.outlineVersion).toBe(version);
      expect(nodeOf(after, kept.id).layoutSide).toBe('right');
      expect(nodeOf(after, odd.id).layoutSide).toBe('left');
      expect(nodeOf(after, grand.id).layoutSide).toBeNull();
    } finally {
      await cleanup(created);
    }
  });

  it('sets the side of a direct child and rejects a deeper node', async () => {
    const token = randomUUID();
    const created: Owned = { nodes: [], collections: [] };
    try {
      const collectionId = await makeCollection(created, `换侧${token}`);
      const root = await makeNode(created, collectionId, `根${token}`);
      const child = await makeNode(created, collectionId, `子${token}`, { parentId: root.id });
      const grand = await makeNode(created, collectionId, `孙${token}`, { parentId: child.id });
      const before = await graphOf(collectionId);
      const version = before.outlineVersion;
      const childOrder = nodeOf(before, child.id).outlineOrder;
      const grandOrder = nodeOf(before, grand.id).outlineOrder;

      const moved = await patchSide(collectionId, child.id, 'left');
      expect(moved.statusCode).toBe(200);
      expect(moved.json()).toEqual({ side: 'left' });
      const afterMove = await graphOf(collectionId);
      expect(afterMove.outlineVersion).toBe(version);
      expect(nodeOf(afterMove, child.id)).toMatchObject({ layoutSide: 'left', outlineOrder: childOrder });

      const denied = await patchSide(collectionId, grand.id, 'left');
      expect(denied.statusCode).toBe(400);
      expect(errorOf(denied.json()).code).toBe('invalid_body');
      const after = await graphOf(collectionId);
      expect(after.outlineVersion).toBe(version);
      expect(nodeOf(after, grand.id)).toMatchObject({
        layoutSide: null,
        outlineOrder: grandOrder,
        parentId: child.id,
      });
      expect(nodeOf(after, child.id).outlineOrder).toBe(childOrder);
    } finally {
      await cleanup(created);
    }
  });

  it('puts a new child of a root on the side that has fewer nodes', async () => {
    const token = randomUUID();
    const created: Owned = { nodes: [], collections: [] };
    try {
      const collectionId = await makeCollection(created, `计数${token}`);
      const root = await makeNode(created, collectionId, `根${token}`);
      const turned = await patchLayout(collectionId, 'both');
      expect(turned.statusCode).toBe(200);
      const version = (await graphOf(collectionId)).outlineVersion;
      const first = await makeNode(created, collectionId, `一${token}`, { parentId: root.id });
      const second = await makeNode(created, collectionId, `二${token}`, { parentId: root.id });
      const third = await makeNode(created, collectionId, `三${token}`, { parentId: root.id });
      const fourth = await makeNode(created, collectionId, `四${token}`, { parentId: root.id });
      const otherRoot = await makeNode(created, collectionId, `另根${token}`);
      const grand = await makeNode(created, collectionId, `孙${token}`, { parentId: first.id });
      const graph = await graphOf(collectionId);
      expect(graph.outlineVersion).toBe(version + 6);
      expect(nodeOf(graph, first.id)).toMatchObject({ parentId: root.id, outlineOrder: 0, layoutSide: 'right' });
      expect(nodeOf(graph, second.id)).toMatchObject({ parentId: root.id, outlineOrder: 1, layoutSide: 'left' });
      expect(nodeOf(graph, third.id)).toMatchObject({ parentId: root.id, outlineOrder: 2, layoutSide: 'right' });
      expect(nodeOf(graph, fourth.id)).toMatchObject({ parentId: root.id, outlineOrder: 3, layoutSide: 'left' });
      expect(nodeOf(graph, otherRoot.id)).toMatchObject({ parentId: null, layoutSide: null });
      expect(nodeOf(graph, grand.id)).toMatchObject({ parentId: first.id, layoutSide: null });
    } finally {
      await cleanup(created);
    }
  });

  it('copies the demoted node side onto an inserted parent', async () => {
    const token = randomUUID();
    const created: Owned = { nodes: [], collections: [] };
    try {
      const collectionId = await makeCollection(created, `父题${token}`);
      const root = await makeNode(created, collectionId, `根${token}`);
      const child = await makeNode(created, collectionId, `子${token}`, { parentId: root.id });
      const marked = await patchSide(collectionId, child.id, 'left');
      expect(marked.statusCode).toBe(200);
      const before = await graphOf(collectionId);
      const inserted = await call('POST', `/api/collections/${collectionId}/outline/parent`, {
        expectedVersion: before.outlineVersion,
        nodeId: child.id,
        name: `父${token}`,
      });
      const body = inserted.json() as Partial<Created>;
      if (body.id) created.nodes.push(body.id);
      expect(inserted.statusCode).toBe(201);
      const graph = await graphOf(collectionId);
      expect(nodeOf(graph, body.id as string)).toMatchObject({ layoutSide: 'left', parentId: root.id });
      expect(nodeOf(graph, child.id).parentId).toBe(body.id);
      expect(nodeOf(graph, child.id).layoutSide).toBe('left');
    } finally {
      await cleanup(created);
    }
  });

  it('keeps layoutSide when an outline put only changes the parent', async () => {
    const token = randomUUID();
    const created: Owned = { nodes: [], collections: [] };
    try {
      const collectionId = await makeCollection(created, `改父${token}`);
      const root = await makeNode(created, collectionId, `根${token}`);
      const other = await makeNode(created, collectionId, `另${token}`);
      const child = await makeNode(created, collectionId, `子${token}`, { parentId: root.id });
      const marked = await patchSide(collectionId, child.id, 'left');
      expect(marked.statusCode).toBe(200);
      const before = await graphOf(collectionId);
      expect(nodeOf(before, child.id).layoutSide).toBe('left');
      const put = await call('PUT', `/api/collections/${collectionId}/outline`, {
        expectedVersion: before.outlineVersion,
        items: [
          { nodeId: root.id, parentId: null, order: 0 },
          { nodeId: other.id, parentId: null, order: 1 },
          { nodeId: child.id, parentId: other.id, order: 0 },
        ],
      });
      expect(put.statusCode).toBe(200);
      const after = await graphOf(collectionId);
      expect(nodeOf(after, child.id)).toMatchObject({ parentId: other.id, layoutSide: 'left' });
    } finally {
      await cleanup(created);
    }
  });

  it('hides direction and side from another user', async () => {
    const token = randomUUID();
    const created: Owned = { nodes: [], collections: [] };
    const otherName = `u${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    try {
      const collectionId = await makeCollection(created, `私${token}`);
      const node = await makeNode(created, collectionId, `点${token}`);
      const registered = await app.inject({
        method: 'POST',
        url: '/api/register',
        payload: { username: otherName, password: 'secret-88' },
      });
      expect(registered.statusCode).toBe(201);
      const otherCookie = cookiePair(registered.headers['set-cookie']);
      const graph = await call('GET', `/api/collections/${collectionId}/graph`, undefined, otherCookie);
      expect(graph.statusCode).toBe(404);
      expect(errorOf(graph.json()).code).toBe('not_found');
      const layout = await patchLayout(collectionId, 'both', otherCookie);
      expect(layout.statusCode).toBe(404);
      expect(errorOf(layout.json()).code).toBe('not_found');
      const side = await patchSide(collectionId, node.id, 'left', otherCookie);
      expect(side.statusCode).toBe(404);
      expect(errorOf(side.json()).code).toBe('not_found');
      expect((await graphOf(collectionId)).layoutDirection).toBe('right');
      expect(nodeOf(await graphOf(collectionId), node.id).layoutSide).toBeNull();
    } finally {
      await cleanup(created);
    }
  });
});
