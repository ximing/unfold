import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import { buildApp } from '../app.js';
import { createDb, createPool } from '../db/client.js';
import { collections, memberships, users } from '../db/schema.js';

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

type Owned = { nodes: string[]; collections: string[] };

type MemberBackup = {
  x: number | null;
  y: number | null;
  freeX: number | null;
  freeY: number | null;
  freeCaptured: boolean;
  parentNodeId: string | null;
  layoutSide: string | null;
  outlineOrder: number;
};

describe('mindmap anchor', () => {
  let app: FastifyInstance;
  let pool: Pool;
  let db: ReturnType<typeof createDb>;
  let cookie: string;
  let info: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    info = vi.spyOn(console, 'info');
    app = await buildApp();
    pool = createPool();
    db = createDb(pool);
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username, password } });
    expect(login.statusCode).toBe(200);
    cookie = cookiePair(login.headers['set-cookie']);
  });

  beforeEach(() => {
    info.mockClear();
  });

  afterAll(async () => {
    info.mockRestore();
    await app.close();
    await pool.end();
  });

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

  function mindmapLogs(): string[] {
    return info.mock.calls
      .map((args) => args.map(String).join(' '))
      .filter((line) => line.startsWith('mindmap-'));
  }

  async function makeCollection(created: Owned, title: string): Promise<string> {
    const res = await call('POST', '/api/collections', { title });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { id: string }).id;
    created.collections.push(id);
    return id;
  }

  async function makeNode(created: Owned, collectionId: string, name: string, parentId?: string): Promise<string> {
    const res = await call('POST', `/api/collections/${collectionId}/nodes`, {
      name,
      ...(parentId ? { parentId } : {}),
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { id: string }).id;
    created.nodes.push(id);
    return id;
  }

  async function place(collectionId: string, nodeId: string, x: number, y: number) {
    const res = await call('PATCH', `/api/collections/${collectionId}/placements`, {
      placements: [{ nodeId, x, y, z: 1 }],
    });
    expect(res.statusCode).toBe(204);
  }

  async function memberRow(collectionId: string, nodeId: string): Promise<MemberBackup> {
    const rows = await db
      .select({
        x: memberships.x,
        y: memberships.y,
        freeX: memberships.freeX,
        freeY: memberships.freeY,
        freeCaptured: memberships.freeCaptured,
        parentNodeId: memberships.parentNodeId,
        layoutSide: memberships.layoutSide,
        outlineOrder: memberships.outlineOrder,
      })
      .from(memberships)
      .where(and(eq(memberships.collectionId, collectionId), eq(memberships.nodeId, nodeId)));
    const row = rows[0];
    if (!row) throw new Error('missing membership');
    return row;
  }

  async function flagOf(collectionId: string) {
    const rows = await db
      .select({
        mindmapAnchored: collections.mindmapAnchored,
        outlineVersion: collections.outlineVersion,
      })
      .from(collections)
      .where(eq(collections.id, collectionId));
    const row = rows[0];
    if (!row) throw new Error('missing collection');
    return row;
  }

  async function cleanup(created: Owned) {
    for (const id of created.nodes) await call('DELETE', `/api/nodes/${id}`);
    for (const id of created.collections) await call('DELETE', `/api/collections/${id}`);
  }

  it('copies free coordinates once and logs even when nothing is copied', async () => {
    const token = randomUUID();
    const created: Owned = { nodes: [], collections: [] };
    try {
      const collectionId = await makeCollection(created, `备份${token}`);
      const otherId = await makeCollection(created, `旁集${token}`);
      const opened = await call('GET', `/api/collections/${collectionId}/graph`);
      expect(opened.statusCode).toBe(200);
      const version = (await flagOf(collectionId)).outlineVersion;

      const empty = await call('POST', `/api/collections/${collectionId}/mindmap-adopt`);
      expect(empty.statusCode).toBe(200);
      expect(empty.json()).toEqual({ mindmapAnchored: false, copied: 0 });
      expect(await flagOf(collectionId)).toEqual({ mindmapAnchored: false, outlineVersion: version });
      expect(mindmapLogs()).toEqual([`mindmap-adopt collection=${collectionId} copied=0`]);

      const root = await makeNode(created, collectionId, `根${token}`);
      const child = await makeNode(created, collectionId, `子${token}`, root);
      const sided = await call('PATCH', `/api/collections/${collectionId}/members/${child}/side`, { side: 'left' });
      expect(sided.statusCode).toBe(200);
      await place(collectionId, root, 0, 3);
      await place(collectionId, child, 12.5, -4);
      const joined = await call('POST', `/api/collections/${otherId}/members`, { nodeId: root });
      expect(joined.statusCode).toBe(200);
      await place(otherId, root, 1, 1);
      const before = await flagOf(collectionId);

      const adopted = await call('POST', `/api/collections/${collectionId}/mindmap-adopt`);
      expect(adopted.statusCode).toBe(200);
      expect(adopted.json()).toEqual({ mindmapAnchored: false, copied: 2 });
      expect(await flagOf(collectionId)).toEqual(before);
      expect(await memberRow(collectionId, root)).toMatchObject({
        x: 0,
        y: 3,
        freeX: 0,
        freeY: 3,
        freeCaptured: true,
        parentNodeId: null,
        layoutSide: null,
      });
      expect(await memberRow(collectionId, child)).toMatchObject({
        x: 12.5,
        y: -4,
        freeX: 12.5,
        freeY: -4,
        freeCaptured: true,
        parentNodeId: root,
        layoutSide: 'left',
      });
      expect(await memberRow(otherId, root)).toMatchObject({
        x: 1,
        y: 1,
        freeX: null,
        freeY: null,
        freeCaptured: false,
      });

      const graph = await call('GET', `/api/collections/${collectionId}/graph`);
      expect(graph.statusCode).toBe(200);
      const body = graph.json() as { mindmapAnchored: boolean; nodes: Record<string, unknown>[] };
      expect(body.mindmapAnchored).toBe(false);
      expect(body).not.toHaveProperty('free_x');
      expect(body).not.toHaveProperty('free_y');
      expect(body).not.toHaveProperty('free_captured');
      for (const node of body.nodes) {
        expect(node).not.toHaveProperty('freeX');
        expect(node).not.toHaveProperty('free_x');
        expect(node).not.toHaveProperty('freeY');
        expect(node).not.toHaveProperty('free_y');
        expect(node).not.toHaveProperty('freeCaptured');
        expect(node).not.toHaveProperty('free_captured');
      }

      await place(collectionId, root, 9, 8);
      const again = await call('POST', `/api/collections/${collectionId}/mindmap-adopt`, { expectedVersion: 99 });
      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual({ mindmapAnchored: false, copied: 0 });
      expect(await memberRow(collectionId, root)).toMatchObject({ x: 9, y: 8, freeX: 0, freeY: 3, freeCaptured: true });
      expect(await memberRow(collectionId, child)).toMatchObject({ freeX: 12.5, freeY: -4, freeCaptured: true });
      expect(mindmapLogs()).toEqual([
        `mindmap-adopt collection=${collectionId} copied=0`,
        `mindmap-adopt collection=${collectionId} copied=2`,
        `mindmap-adopt collection=${collectionId} copied=0`,
      ]);
    } finally {
      await cleanup(created);
    }
  });

  it('rejects commit when an uncaptured member already has x', async () => {
    const token = randomUUID();
    const created: Owned = { nodes: [], collections: [] };
    try {
      const collectionId = await makeCollection(created, `冲突${token}`);
      const placed = await makeNode(created, collectionId, `有点${token}`);
      const empty = await makeNode(created, collectionId, `空点${token}`);
      await place(collectionId, placed, 0, 5);
      const beforeFlag = await flagOf(collectionId);
      const beforePlaced = await memberRow(collectionId, placed);
      const beforeEmpty = await memberRow(collectionId, empty);

      const denied = await call('POST', `/api/collections/${collectionId}/mindmap-commit`, { expectedVersion: 1 });
      expect(denied.statusCode).toBe(409);
      expect(errorOf(denied.json())).toEqual({ code: 'conflict', message: '旧位置还没记下来，没有重排' });
      expect(await flagOf(collectionId)).toEqual(beforeFlag);
      expect(beforeFlag.mindmapAnchored).toBe(false);
      expect(await memberRow(collectionId, placed)).toEqual(beforePlaced);
      expect(await memberRow(collectionId, empty)).toEqual(beforeEmpty);
      expect(beforePlaced).toMatchObject({ x: 0, y: 5, freeX: null, freeCaptured: false });
      expect(beforeEmpty).toMatchObject({ x: null, freeX: null, freeCaptured: false });
      expect(mindmapLogs()).toEqual([]);
    } finally {
      await cleanup(created);
    }
  });

  it('commits when free_x is null but already captured, and when x is null', async () => {
    const token = randomUUID();
    const created: Owned = { nodes: [], collections: [] };
    try {
      const collectionId = await makeCollection(created, `通过${token}`);
      const captured = await makeNode(created, collectionId, `已抄${token}`);
      const adopted = await call('POST', `/api/collections/${collectionId}/mindmap-adopt`);
      expect(adopted.json()).toEqual({ mindmapAnchored: false, copied: 1 });
      await place(collectionId, captured, 8, 2);
      const fresh = await makeNode(created, collectionId, `未摆${token}`);
      const version = (await flagOf(collectionId)).outlineVersion;

      const committed = await call('POST', `/api/collections/${collectionId}/mindmap-commit`);
      expect(committed.statusCode).toBe(200);
      expect(committed.json()).toEqual({ mindmapAnchored: true });
      expect(await flagOf(collectionId)).toEqual({ mindmapAnchored: true, outlineVersion: version });
      expect(await memberRow(collectionId, captured)).toMatchObject({
        x: 8,
        y: 2,
        freeX: null,
        freeY: null,
        freeCaptured: true,
      });
      expect(await memberRow(collectionId, fresh)).toMatchObject({
        x: null,
        y: null,
        freeX: null,
        freeY: null,
        freeCaptured: false,
      });
      expect(mindmapLogs()).toEqual([
        `mindmap-adopt collection=${collectionId} copied=1`,
        `mindmap-commit collection=${collectionId}`,
      ]);

      const repeat = await call('POST', `/api/collections/${collectionId}/mindmap-commit`, { expectedVersion: 3 });
      expect(repeat.statusCode).toBe(200);
      expect(repeat.json()).toEqual({ mindmapAnchored: true });
      expect(await memberRow(collectionId, captured)).toMatchObject({ freeX: null, freeCaptured: true, x: 8 });
      expect(await memberRow(collectionId, fresh)).toMatchObject({ freeCaptured: false, x: null });
      expect(mindmapLogs()).toEqual([
        `mindmap-adopt collection=${collectionId} copied=1`,
        `mindmap-commit collection=${collectionId}`,
      ]);
    } finally {
      await cleanup(created);
    }
  });

  it('does not copy members created after the flag is set', async () => {
    const token = randomUUID();
    const created: Owned = { nodes: [], collections: [] };
    try {
      const collectionId = await makeCollection(created, `锚定${token}`);
      const kept = await makeNode(created, collectionId, `旧${token}`);
      await place(collectionId, kept, 4, 4);
      const adopted = await call('POST', `/api/collections/${collectionId}/mindmap-adopt`);
      expect(adopted.json()).toEqual({ mindmapAnchored: false, copied: 1 });
      const committed = await call('POST', `/api/collections/${collectionId}/mindmap-commit`);
      expect(committed.json()).toEqual({ mindmapAnchored: true });
      info.mockClear();

      const added = await makeNode(created, collectionId, `新${token}`);
      await place(collectionId, added, 6, 7);
      const again = await call('POST', `/api/collections/${collectionId}/mindmap-adopt`);
      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual({ mindmapAnchored: true, copied: 0 });
      expect(await memberRow(collectionId, added)).toMatchObject({
        x: 6,
        y: 7,
        freeX: null,
        freeY: null,
        freeCaptured: false,
      });
      expect(await memberRow(collectionId, kept)).toMatchObject({
        x: 4,
        y: 4,
        freeX: 4,
        freeY: 4,
        freeCaptured: true,
      });
      expect(mindmapLogs()).toEqual([]);

      const graph = await call('GET', `/api/collections/${collectionId}/graph`);
      const body = graph.json() as { mindmapAnchored: boolean; nodes: Record<string, unknown>[] };
      expect(body.mindmapAnchored).toBe(true);
      for (const node of body.nodes) expect(node).not.toHaveProperty('free_x');
    } finally {
      await cleanup(created);
    }
  });

  it('hides adopt and commit from another user', async () => {
    const token = randomUUID();
    const created: Owned = { nodes: [], collections: [] };
    const otherName = `u${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    try {
      const collectionId = await makeCollection(created, `私${token}`);
      const missingAdopt = await call('POST', `/api/collections/${randomUUID()}/mindmap-adopt`);
      expect(missingAdopt.statusCode).toBe(404);
      expect(errorOf(missingAdopt.json())).toEqual({ code: 'not_found', message: '合集没有找到' });
      const missingCommit = await call('POST', `/api/collections/${randomUUID()}/mindmap-commit`);
      expect(missingCommit.statusCode).toBe(404);
      expect(errorOf(missingCommit.json()).code).toBe('not_found');

      const registered = await app.inject({
        method: 'POST',
        url: '/api/register',
        payload: { username: otherName, password: 'other-pass-88' },
      });
      expect(registered.statusCode).toBe(201);
      const otherCookie = cookiePair(registered.headers['set-cookie']);
      const adopt = await call('POST', `/api/collections/${collectionId}/mindmap-adopt`, undefined, otherCookie);
      expect(adopt.statusCode).toBe(404);
      expect(errorOf(adopt.json())).toEqual({ code: 'not_found', message: '合集没有找到' });
      const commit = await call('POST', `/api/collections/${collectionId}/mindmap-commit`, undefined, otherCookie);
      expect(commit.statusCode).toBe(404);
      expect(errorOf(commit.json()).code).toBe('not_found');
      expect((await flagOf(collectionId)).mindmapAnchored).toBe(false);
      expect(mindmapLogs()).toEqual([]);
    } finally {
      await cleanup(created);
      await db.delete(users).where(eq(users.username, otherName));
    }
  });
});
