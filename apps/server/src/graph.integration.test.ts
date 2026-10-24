import { domainSchema, objectSummarySchema } from '@unfold/dto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createDb, createPool } from './db/client.js';
import { documents, domains, evidence, knowledgeObjects, relations, users } from './db/schema.js';
import { graphResponseSchema } from './graph.js';

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

function errorOf(payload: unknown): { code: string; message: string } {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) {
    throw new Error('missing error');
  }
  const error = payload.error;
  if (!error || typeof error !== 'object' || !('code' in error) || !('message' in error)) {
    throw new Error('missing error');
  }
  if (typeof error.code !== 'string' || typeof error.message !== 'string') {
    throw new Error('missing error');
  }
  return { code: error.code, message: error.message };
}

describe('graph', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  let userId = '';
  const stamp = Date.now();
  const domainIds: string[] = [];
  const objectIds: string[] = [];
  let domainId = '';
  let seq = 0;

  function name(prefix: string): string {
    seq += 1;
    return `${prefix}-${stamp}-${seq}`;
  }

  async function createDomain(domainName: string): Promise<string> {
    const created = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { cookie },
      payload: { name: domainName },
    });
    expect(created.statusCode).toBe(201);
    const id = domainSchema.parse(created.json()).id;
    domainIds.push(id);
    return id;
  }

  async function createObject(canonicalName: string, coreStatement: string) {
    const created = await app.inject({
      method: 'POST',
      url: '/api/objects',
      headers: { cookie },
      payload: { domainId, type: 'concept', canonicalName, coreStatement },
    });
    expect(created.statusCode).toBe(201);
    const id = objectSummarySchema.parse(created.json()).id;
    objectIds.push(id);
    return id;
  }

  async function relate(payload: Record<string, unknown>) {
    const created = await app.inject({
      method: 'POST',
      url: '/api/relations',
      headers: { cookie },
      payload,
    });
    expect(created.statusCode).toBe(201);
  }

  async function readGraph(id: string) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/objects/${id}/graph`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    return graphResponseSchema.parse(res.json());
  }

  async function evidenceCount(): Promise<number> {
    const rows = await db
      .select({ count: sql<string>`count(*)::text` })
      .from(evidence)
      .where(eq(evidence.userId, userId));
    return Number(rows[0]?.count ?? '0');
  }

  beforeAll(async () => {
    app = await buildApp();
    pool = createPool();
    db = createDb(pool);
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username, password },
    });
    expect(login.statusCode).toBe(200);
    cookie = cookiePair(login.headers['set-cookie']);

    const found = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, username), isNull(users.deletedAt)))
      .limit(1);
    const user = found[0];
    if (!user) throw new Error('seed user missing');
    userId = user.id;
    domainId = await createDomain(`领域-${stamp}`);
  });

  afterAll(async () => {
    const now = new Date();
    if (objectIds.length > 0) {
      await db
        .update(knowledgeObjects)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(knowledgeObjects.id, objectIds));
      await db
        .update(documents)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(documents.ownerId, objectIds));
    }
    if (domainIds.length > 0) {
      await db.update(domains).set({ deletedAt: now, updatedAt: now }).where(inArray(domains.id, domainIds));
    }
    await pool.end();
    await app.close();
  });

  it('returns 404 when the id is not a uuid', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/objects/not-a-uuid/graph',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(errorOf(res.json())).toEqual({ code: 'not_found', message: '没有这个点' });
  });

  it('returns only the focus when nothing is linked', async () => {
    const canonicalName = name('孤点');
    const focusId = await createObject(canonicalName, '周围还没有关系');
    const body = await readGraph(focusId);
    expect(body.truncated).toBe(false);
    expect(body.edges).toEqual([]);
    expect(body.nodes).toEqual([
      {
        id: focusId,
        canonicalName,
        coreStatement: '周围还没有关系',
        type: 'concept',
        x: 0,
        y: 0,
      },
    ]);
  });

  it('places one accepted neighbor in each sector', async () => {
    const focusName = name('焦点');
    const focusId = await createObject(focusName, '看四周');
    const originId = await createObject(name('来历'), '更早的做法');
    const destinationId = await createObject(name('去向'), '用在别处');
    const contrastId = await createObject(name('对照'), '另一条路');
    const variantId = await createObject(name('变体'), '条件一变就不一样');

    await relate({
      fromId: focusId,
      toId: originId,
      type: 'evolves_from',
      whatChanged: '把重复合并掉',
    });
    await relate({
      fromId: focusId,
      toId: destinationId,
      type: 'applies',
    });
    await relate({
      fromId: focusId,
      toId: contrastId,
      type: 'contrasts',
      distinction: '一个合并，一个展开',
    });
    await relate({
      fromId: focusId,
      toId: variantId,
      type: 'variant',
      whatChanged: '改成带权重',
      condition: '边权不相等时',
    });

    const body = await readGraph(focusId);
    const byId = Object.fromEntries(body.nodes.map((node) => [node.id, node]));
    expect(byId[focusId]).toMatchObject({ x: 0, y: 0, canonicalName: focusName });
    expect(byId[originId]).toMatchObject({ x: -180, y: 0 });
    expect(byId[destinationId]).toMatchObject({ x: 180, y: 0 });
    expect(byId[contrastId]).toMatchObject({ x: 0, y: -180 });
    expect(byId[variantId]).toMatchObject({ x: 0, y: 180 });

    const edgeByTo = new Map(body.edges.map((edge) => [edge.toId, edge]));
    expect(edgeByTo.get(originId)).toEqual({
      fromId: focusId,
      toId: originId,
      type: 'evolves_from',
      label: '演化',
    });
    expect(edgeByTo.get(destinationId)).toEqual({
      fromId: focusId,
      toId: destinationId,
      type: 'applies',
      label: '应用',
    });
    expect(edgeByTo.get(contrastId)).toEqual({
      fromId: focusId,
      toId: contrastId,
      type: 'contrasts',
      label: '对比',
    });
    expect(edgeByTo.get(variantId)).toEqual({
      fromId: focusId,
      toId: variantId,
      type: 'variant',
      label: '变体',
    });
    expect(body.edges.every((edge) => edge.fromId === focusId)).toBe(true);
  });

  it('leaves a suggested prerequisite off the graph', async () => {
    const focusId = await createObject(name('焦点'), '建议先不画');
    const keptId = await createObject(name('来历'), '已经接受');
    const hiddenId = await createObject(name('前置'), '还只是建议');
    await relate({
      fromId: focusId,
      toId: keptId,
      type: 'evolves_from',
      whatChanged: '先收下这条',
    });
    await db.insert(relations).values({
      userId,
      fromId: focusId,
      toId: hiddenId,
      type: 'prerequisite',
      status: 'suggested',
    });

    const body = await readGraph(focusId);
    const ids = body.nodes.map((node) => node.id);
    expect(ids).toContain(keptId);
    expect(ids).not.toContain(hiddenId);
  });

  it('stacks two origins on the vertical axis', async () => {
    const focusId = await createObject(name('焦点'), '两条来历');
    const firstId = await createObject(name('来历'), '更早');
    const secondId = await createObject(name('来历'), '稍后');
    await relate({
      fromId: focusId,
      toId: firstId,
      type: 'evolves_from',
      whatChanged: '第一次变化',
    });
    await relate({
      fromId: focusId,
      toId: secondId,
      type: 'evolves_from',
      whatChanged: '第二次变化',
    });

    const body = await readGraph(focusId);
    const origins = body.nodes.filter((node) => node.id !== focusId);
    expect(origins.map((node) => node.x)).toEqual([-180, -180]);
    expect(origins.map((node) => node.y)).toEqual([-36, 36]);
  });

  it('truncates the 51st origin neighbor', async () => {
    const focusId = await createObject(name('焦点'), '来历太多');
    for (let index = 0; index < 51; index += 1) {
      const neighborId = await createObject(name('来历'), `第${index}条来历`);
      await relate({
        fromId: focusId,
        toId: neighborId,
        type: 'evolves_from',
        whatChanged: `变化${index}`,
      });
    }

    const ordered = await db
      .select({ toId: relations.toId })
      .from(relations)
      .where(
        and(
          eq(relations.userId, userId),
          eq(relations.fromId, focusId),
          eq(relations.type, 'evolves_from'),
          eq(relations.status, 'accepted'),
          isNull(relations.deletedAt),
        ),
      )
      .orderBy(asc(relations.createdAt), asc(relations.id));
    expect(ordered).toHaveLength(51);
    const droppedId = ordered[50]?.toId;
    if (!droppedId) throw new Error('missing 51st neighbor');

    const body = await readGraph(focusId);
    expect(body.truncated).toBe(true);
    expect(body.nodes).toHaveLength(51);
    expect(body.nodes.map((node) => node.id)).not.toContain(droppedId);
  });

  it('does not write evidence', async () => {
    const focusId = await createObject(name('焦点'), '只是看一眼');
    const before = await evidenceCount();
    const body = await readGraph(focusId);
    const after = await evidenceCount();
    expect(body.nodes.map((node) => node.id)).toEqual([focusId]);
    expect(after).toBe(before);
  });
});
