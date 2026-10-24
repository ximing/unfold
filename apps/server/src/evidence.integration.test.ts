import { randomUUID } from 'node:crypto';
import { capabilitySchema, domainSchema, evidenceSchema, objectSummarySchema } from '@unfold/dto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createDb, createPool } from './db/client.js';
import {
  capabilities,
  capabilityObjects,
  documents,
  domains,
  evidence,
  knowledgeObjects,
  reviewStates,
  users,
} from './db/schema.js';
import { rebuildReviewState } from './evidence.js';

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
  if (!payload || typeof payload !== 'object' || !('error' in payload)) throw new Error('missing error');
  const error = payload.error;
  if (!error || typeof error !== 'object' || !('code' in error) || !('message' in error)) {
    throw new Error('missing error');
  }
  if (typeof error.code !== 'string' || typeof error.message !== 'string') throw new Error('missing error');
  return { code: error.code, message: error.message };
}

describe('evidence', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  let userId = '';
  const suffix = Date.now();
  const domainIds: string[] = [];
  const objectIds: string[] = [];
  const capabilityIds: string[] = [];
  let domainId = '';
  let objectA = '';
  let explainId = '';

  beforeAll(async () => {
    app = await buildApp();
    pool = createPool();
    db = createDb(pool);
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username, password },
    });
    cookie = cookiePair(login.headers['set-cookie']);
    const found = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, username), isNull(users.deletedAt)))
      .limit(1);
    const user = found[0];
    if (!user) throw new Error('missing seed user');
    userId = user.id;
  });

  afterAll(async () => {
    const now = new Date();
    if (capabilityIds.length > 0) {
      await db.update(evidence).set({ deletedAt: now, updatedAt: now }).where(inArray(evidence.capabilityId, capabilityIds));
      await db
        .update(reviewStates)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(reviewStates.capabilityId, capabilityIds));
      await db
        .update(capabilityObjects)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(capabilityObjects.capabilityId, capabilityIds));
      await db.update(capabilities).set({ deletedAt: now, updatedAt: now }).where(inArray(capabilities.id, capabilityIds));
    }
    if (objectIds.length > 0) {
      await db
        .update(documents)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(documents.ownerType, 'object'), inArray(documents.ownerId, objectIds)));
      await db.update(knowledgeObjects).set({ deletedAt: now, updatedAt: now }).where(inArray(knowledgeObjects.id, objectIds));
    }
    if (domainIds.length > 0) {
      await db.update(domains).set({ deletedAt: now, updatedAt: now }).where(inArray(domains.id, domainIds));
    }
    await pool.end();
    await app.close();
  });

  async function createObject(name: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/objects',
      headers: { cookie },
      payload: { domainId, type: 'problem', canonicalName: name, coreStatement: '一句话' },
    });
    expect(res.statusCode).toBe(201);
    const object = objectSummarySchema.parse(res.json());
    objectIds.push(object.id);
    return object.id;
  }

  async function createCapability(primaryObjectId: string, kind: 'explain' | 'transfer', statement: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/capabilities',
      headers: { cookie },
      payload: { statement, kind, primaryObjectId },
    });
    expect(res.statusCode).toBe(201);
    const created = capabilitySchema.parse(res.json());
    capabilityIds.push(created.id);
    return created.id;
  }

  async function countEvidence(capabilityId: string): Promise<number> {
    const rows = await db
      .select({ id: evidence.id })
      .from(evidence)
      .where(and(eq(evidence.capabilityId, capabilityId), isNull(evidence.deletedAt)));
    return rows.length;
  }

  it('rejects evidence without a cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/capabilities/${randomUUID()}/evidence`,
      payload: { mode: 'practice', hintLevel: 0, rating: 'fail' },
    });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res.json())).toEqual({ code: 'unauthenticated', message: '未登录' });
  });

  it('rejects an empty evidence body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/capabilities/${randomUUID()}/evidence`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res.json())).toEqual({ code: 'invalid_body', message: '请求格式不正确' });
  });

  it('rejects independent evidence once hints reach the threshold', async () => {
    const createdDomain = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { cookie },
      payload: { name: `证据领域-${suffix}` },
    });
    expect(createdDomain.statusCode).toBe(201);
    domainId = domainSchema.parse(createdDomain.json()).id;
    domainIds.push(domainId);
    objectA = await createObject(`证据点-${suffix}`);
    explainId = await createCapability(objectA, 'explain', `能解释-${suffix}`);

    const missing = await app.inject({
      method: 'POST',
      url: `/api/capabilities/${randomUUID()}/evidence`,
      headers: { cookie },
      payload: { mode: 'practice', hintLevel: 0, rating: 'fail' },
    });
    expect(missing.statusCode).toBe(404);
    expect(errorOf(missing.json())).toEqual({ code: 'not_found', message: '没有这个能力' });

    const locked = await app.inject({
      method: 'POST',
      url: `/api/capabilities/${explainId}/evidence`,
      headers: { cookie },
      payload: { mode: 'practice', hintLevel: 3, rating: 'independent', body: '不该写入' },
    });
    expect(locked.statusCode).toBe(409);
    expect(errorOf(locked.json())).toEqual({
      code: 'independent_locked',
      message: '提示已经到第 3 级。这次不能记为独立完成。',
    });
    expect(await countEvidence(explainId)).toBe(0);
  });

  it('stores evidence, skips schedule movement for saw_material, and rebuilds the same due', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/api/capabilities/${explainId}/evidence`,
      headers: { cookie },
      payload: { mode: 'practice', hintLevel: 0, rating: 'independent', body: '独立说出了定义' },
    });
    expect(created.statusCode).toBe(201);
    const row = evidenceSchema.parse(created.json());
    expect(row.capabilityId).toBe(explainId);
    expect(row.createdAt.length).toBeGreaterThan(0);

    const before = await db
      .select({ dueAt: reviewStates.dueAt, reps: reviewStates.reps })
      .from(reviewStates)
      .where(and(eq(reviewStates.capabilityId, explainId), isNull(reviewStates.deletedAt)))
      .limit(1);
    expect(before[0]).toBeTruthy();
    const due = before[0]!.dueAt.getTime();
    const reps = before[0]!.reps;

    const saw = await app.inject({
      method: 'POST',
      url: `/api/capabilities/${explainId}/evidence`,
      headers: { cookie },
      payload: { mode: 'reread', hintLevel: 0, rating: 'saw_material' },
    });
    expect(saw.statusCode).toBe(201);
    const afterSaw = await db
      .select({ dueAt: reviewStates.dueAt, reps: reviewStates.reps })
      .from(reviewStates)
      .where(and(eq(reviewStates.capabilityId, explainId), isNull(reviewStates.deletedAt)))
      .limit(1);
    expect(afterSaw[0]!.dueAt.getTime()).toBe(due);
    expect(afterSaw[0]!.reps).toBe(reps);

    await db.delete(reviewStates).where(eq(reviewStates.capabilityId, explainId));
    await rebuildReviewState(db, userId, explainId);
    const rebuilt = await db
      .select({ dueAt: reviewStates.dueAt })
      .from(reviewStates)
      .where(and(eq(reviewStates.capabilityId, explainId), isNull(reviewStates.deletedAt)))
      .limit(1);
    expect(rebuilt[0]!.dueAt.getTime()).toBe(due);

    const failed = await app.inject({
      method: 'POST',
      url: `/api/capabilities/${explainId}/evidence`,
      headers: { cookie },
      payload: { mode: 'practice', hintLevel: 3, rating: 'fail', obstacle: '没看出相同前缀' },
    });
    expect(failed.statusCode).toBe(201);
    const stillLocked = await app.inject({
      method: 'POST',
      url: `/api/capabilities/${explainId}/evidence`,
      headers: { cookie },
      payload: { mode: 'practice', hintLevel: 3, rating: 'independent' },
    });
    expect(stillLocked.statusCode).toBe(409);
    expect(await countEvidence(explainId)).toBe(3);
  });

  it('blocks transfer practice until a non-transfer capability has independent evidence', async () => {
    const objectB = await createObject(`迁移点-${suffix}`);
    const transferId = await createCapability(objectB, 'transfer', `能迁移-${suffix}`);
    const blocked = await app.inject({
      method: 'POST',
      url: `/api/capabilities/${transferId}/evidence`,
      headers: { cookie },
      payload: { mode: 'practice', hintLevel: 0, rating: 'fail' },
    });
    expect(blocked.statusCode).toBe(409);
    expect(errorOf(blocked.json())).toEqual({
      code: 'transfer_locked',
      message: '迁移练习还没开放：主点上还没有一条独立完成的非迁移证据。',
    });
    expect(await countEvidence(transferId)).toBe(0);

    const sibling = await createCapability(objectB, 'explain', `能解释迁移点-${suffix}`);
    const opened = await app.inject({
      method: 'POST',
      url: `/api/capabilities/${sibling}/evidence`,
      headers: { cookie },
      payload: { mode: 'practice', hintLevel: 0, rating: 'independent' },
    });
    expect(opened.statusCode).toBe(201);
    const transfer = await app.inject({
      method: 'POST',
      url: `/api/capabilities/${transferId}/evidence`,
      headers: { cookie },
      payload: { mode: 'practice', hintLevel: 0, rating: 'independent' },
    });
    expect(transfer.statusCode).toBe(201);
  });

  it('does not write evidence on passive reads', async () => {
    const before = await db.select({ id: evidence.id }).from(evidence).where(eq(evidence.userId, userId));
    const objectRes = await app.inject({ method: 'GET', url: `/api/objects/${objectA}`, headers: { cookie } });
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/capabilities?objectId=${objectA}`,
      headers: { cookie },
    });
    const todayRes = await app.inject({ method: 'GET', url: '/api/today', headers: { cookie } });
    expect(objectRes.statusCode).toBe(200);
    expect(listRes.statusCode).toBe(200);
    expect(todayRes.statusCode).toBe(200);
    const after = await db.select({ id: evidence.id }).from(evidence).where(eq(evidence.userId, userId));
    expect(after.map((row) => row.id).sort()).toEqual(before.map((row) => row.id).sort());
  });
});
