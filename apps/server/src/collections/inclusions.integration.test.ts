import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray, or } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.js';
import { createDb, createPool } from '../db/client.js';
import { collectionEdges, collectionInclusions, collections, memberships, users } from '../db/schema.js';

const username = process.env.SEED_USERNAME;
const password = process.env.SEED_PASSWORD;
if (!username) throw new Error('SEED_USERNAME is not set');
if (!password) throw new Error('SEED_PASSWORD is not set');

const createdUsernames: string[] = [];

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

type GraphEdge = { id: string; fromId: string; toId: string; label: string };
type GraphInclusion = {
  childId: string;
  x: number;
  y: number;
  collapsed: boolean;
  labels: string[];
  nodes: { id: string; x: number | null; y: number | null }[];
  edges: GraphEdge[];
};
type GraphBody = {
  nodes: { id: string }[];
  edges: GraphEdge[];
  bridges: GraphEdge[];
  inclusions: GraphInclusion[];
};

describe('collection inclusions', () => {
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
    if (createdUsernames.length === 0) return;
    const pool = createPool();
    try {
      const db = createDb(pool);
      const owned = await db.select({ id: users.id }).from(users).where(inArray(users.username, createdUsernames));
      const userIds = owned.map((row) => row.id);
      if (userIds.length === 0) return;
      const ownedCollections = await db
        .select({ id: collections.id })
        .from(collections)
        .where(inArray(collections.userId, userIds));
      const collectionIds = ownedCollections.map((row) => row.id);
      if (collectionIds.length > 0) {
        await db.delete(memberships).where(inArray(memberships.collectionId, collectionIds));
        await db
          .delete(collectionInclusions)
          .where(
            or(
              inArray(collectionInclusions.parentId, collectionIds),
              inArray(collectionInclusions.childId, collectionIds),
            ),
          );
        await db.delete(collectionEdges).where(
          or(
            inArray(collectionEdges.userId, userIds),
            inArray(collectionEdges.fromId, collectionIds),
            inArray(collectionEdges.toId, collectionIds),
          ),
        );
        await db.delete(collections).where(inArray(collections.id, collectionIds));
      }
      await db.delete(users).where(inArray(users.id, userIds));
    } finally {
      await pool.end();
    }
  });

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
    withCookie = true,
  ): Promise<LightMyRequestResponse> {
    return app.inject({
      method,
      url,
      payload,
      headers: withCookie ? { cookie } : undefined,
    });
  }

  async function graphOf(collectionId: string): Promise<GraphBody> {
    const res = await call('GET', `/api/collections/${collectionId}/graph`);
    expect(res.statusCode).toBe(200);
    return res.json() as GraphBody;
  }

  it('puts another collection on the board without creating a collection edge', async () => {
    const token = randomUUID().replaceAll('-', '').slice(0, 12);
    const label = `包含${token.slice(0, 4)}`;
    const created = { nodes: [] as string[], collections: [] as string[] };
    const otherName = `u${randomUUID().replaceAll('-', '').slice(0, 10)}`;
    createdUsernames.push(otherName);

    async function makeCollection(title: string, withCookie = cookie): Promise<string> {
      const res = await app.inject({
        method: 'POST',
        url: '/api/collections',
        payload: { title },
        headers: { cookie: withCookie },
      });
      expect(res.statusCode).toBe(201);
      const id = (res.json() as { id: string }).id;
      if (withCookie === cookie) created.collections.push(id);
      return id;
    }

    async function makeNode(collectionId: string, name: string): Promise<string> {
      const res = await call('POST', `/api/collections/${collectionId}/nodes`, { name });
      expect(res.statusCode).toBe(201);
      const id = (res.json() as { id: string }).id;
      created.nodes.push(id);
      return id;
    }

    try {
      const anon = await call('POST', `/api/collections/${randomUUID()}/inclusions`, undefined, false);
      expect(anon.statusCode).toBe(401);
      expect(errorOf(anon.json()).code).toBe('unauthenticated');

      const parent = await makeCollection(`父${token}`);
      const child = await makeCollection(`子${token}`);
      const linked = await makeCollection(`连${token}`);
      const loose = await makeCollection(`散${token}`);
      const parentNode = await makeNode(parent, `父点${token}`);
      const childNode = await makeNode(child, `子点${token}`);
      const linkedNode = await makeNode(linked, `连点${token}`);

      const placed = await call('PATCH', `/api/collections/${child}/placements`, {
        placements: [{ nodeId: childNode, x: 10, y: 30, z: 0 }],
      });
      expect(placed.statusCode).toBe(204);

      const self = await call('POST', `/api/collections/${parent}/inclusions`, {
        childId: parent,
        originX: 0,
        originY: 0,
      });
      expect(self.statusCode).toBe(400);
      expect(errorOf(self.json())).toEqual({ code: 'invalid_body', message: '不能把合集放进自己' });

      const unlabeled = await call('POST', `/api/collections/${parent}/inclusions`, {
        childId: loose,
        originX: 0,
        originY: 0,
      });
      expect(unlabeled.statusCode).toBe(201);
      expect(unlabeled.json()).toEqual({ childId: loose });

      const inserted = await call('POST', `/api/collections/${parent}/inclusions`, {
        childId: child,
        originX: 0,
        originY: 0,
        label,
      });
      expect(inserted.statusCode).toBe(201);
      expect(inserted.json()).toEqual({ childId: child });

      const library = await call('GET', '/api/library');
      expect(library.statusCode).toBe(200);
      const between = (left: string, right: string) =>
        (library.json() as { edges: GraphEdge[] }).edges.filter(
          (edge) =>
            (edge.fromId === left && edge.toId === right) || (edge.fromId === right && edge.toId === left),
        );
      expect(between(parent, loose)).toEqual([]);
      expect(between(parent, child)).toEqual([]);

      const first = await graphOf(parent);
      const placedChild = first.inclusions.find((item) => item.childId === child);
      expect(placedChild).toMatchObject({ x: 18, y: 30, collapsed: false, labels: [] });
      expect(placedChild?.nodes.map((node) => node.id)).toEqual([childNode]);
      expect(placedChild?.nodes[0]).toMatchObject({ x: 10, y: 30 });

      const again = await call('POST', `/api/collections/${parent}/inclusions`, {
        childId: child,
        originX: 40,
        originY: 40,
        label,
      });
      expect(again.statusCode).toBe(409);
      expect(errorOf(again.json())).toEqual({ code: 'conflict', message: '这个合集已经在里面了' });

      const bridge = await call('POST', '/api/edges', {
        fromId: parentNode,
        toId: linkedNode,
        label: `跨${token.slice(0, 4)}`,
      });
      expect(bridge.statusCode).toBe(201);
      const bridgeId = (bridge.json() as { id: string }).id;

      const byNodes = await call('POST', `/api/collections/${parent}/inclusions`, {
        childId: linked,
        originX: 80,
        originY: 80,
      });
      expect(byNodes.statusCode).toBe(201);

      const second = await graphOf(parent);
      expect(second.edges.map((edge) => edge.id)).not.toContain(bridgeId);
      expect(second.inclusions.find((item) => item.childId === linked)?.edges.map((edge) => edge.id) ?? []).not.toContain(
        bridgeId,
      );
      expect(second.bridges.map((edge) => edge.id)).toContain(bridgeId);
      expect(second.inclusions.find((item) => item.childId === linked)?.labels).toEqual([]);

      const cycle = await call('POST', `/api/collections/${child}/inclusions`, {
        childId: parent,
        originX: 0,
        originY: 0,
        label: `回${token.slice(0, 4)}`,
      });
      expect(cycle.statusCode).toBe(400);
      expect(errorOf(cycle.json())).toEqual({ code: 'invalid_body', message: '这样放会绕回自己' });

      const moved = await call('PATCH', `/api/collections/${parent}/inclusions/${linked}`, {
        x: 5,
        y: 6,
        collapsed: true,
      });
      expect(moved.statusCode).toBe(204);
      const collapsed = (await graphOf(parent)).inclusions.find((item) => item.childId === linked);
      expect(collapsed).toMatchObject({ x: 5, y: 6, collapsed: true });

      const emptyPatch = await call('PATCH', `/api/collections/${parent}/inclusions/${linked}`, {});
      expect(emptyPatch.statusCode).toBe(400);
      expect(errorOf(emptyPatch.json())).toEqual({ code: 'invalid_body', message: '请求不正确' });

      const removed = await call('DELETE', `/api/collections/${parent}/inclusions/${child}`);
      expect(removed.statusCode).toBe(204);
      const afterRemove = await graphOf(parent);
      expect(afterRemove.inclusions.map((item) => item.childId)).not.toContain(child);
      const childGraph = await graphOf(child);
      expect(childGraph.nodes.map((node) => node.id)).toContain(childNode);
      const libraryAfter = await call('GET', '/api/library');
      expect(
        (libraryAfter.json() as { edges: GraphEdge[] }).edges.filter(
          (edge) =>
            (edge.fromId === parent && edge.toId === child) || (edge.fromId === child && edge.toId === parent),
        ),
      ).toEqual([]);

      const registered = await app.inject({
        method: 'POST',
        url: '/api/register',
        payload: { username: otherName, password: 'secret-88' },
      });
      expect(registered.statusCode).toBe(201);
      const otherCookie = cookiePair(registered.headers['set-cookie']);
      const foreign = await makeCollection(`别人${token}`, otherCookie);
      const hidden = await call('POST', `/api/collections/${parent}/inclusions`, {
        childId: foreign,
        originX: 0,
        originY: 0,
        label: '不该看见',
      });
      expect(hidden.statusCode).toBe(404);
      expect(errorOf(hidden.json())).toEqual({ code: 'not_found', message: '合集没有找到' });
      const foreignGone = await app.inject({
        method: 'DELETE',
        url: `/api/collections/${foreign}`,
        headers: { cookie: otherCookie },
      });
      expect(foreignGone.statusCode).toBe(204);

      const deletedChild = await call('DELETE', `/api/collections/${linked}`);
      expect(deletedChild.statusCode).toBe(204);
      created.collections = created.collections.filter((id) => id !== linked);
      const afterDelete = await graphOf(parent);
      expect(afterDelete.inclusions.map((item) => item.childId)).not.toContain(linked);
      const stillThere = await call('GET', `/api/nodes/${linkedNode}`);
      expect(stillThere.statusCode).toBe(200);
    } finally {
      for (const id of created.nodes) await call('DELETE', `/api/nodes/${id}`);
      for (const id of created.collections) await call('DELETE', `/api/collections/${id}`);
    }
  });
});
