import { capabilitySchema, domainSchema, objectSummarySchema } from '@unfold/dto';
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
} from './db/schema.js';

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

describe('core statement review', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  const domainIds: string[] = [];
  const objectIds: string[] = [];
  const capabilityIds: string[] = [];

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

  async function dueAtOf(capabilityId: string): Promise<Date> {
    const rows = await db
      .select({ dueAt: reviewStates.dueAt })
      .from(reviewStates)
      .where(and(eq(reviewStates.capabilityId, capabilityId), isNull(reviewStates.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error('missing review state');
    return row.dueAt;
  }

  async function evidenceCount(capabilityId: string): Promise<number> {
    const rows = await db
      .select({ id: evidence.id })
      .from(evidence)
      .where(and(eq(evidence.capabilityId, capabilityId), isNull(evidence.deletedAt)));
    return rows.length;
  }

  it('pulls the primary capability due only when the core statement changes', async () => {
    const suffix = Date.now();
    const createdDomain = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { cookie },
      payload: { name: `重看领域-${suffix}` },
    });
    expect(createdDomain.statusCode).toBe(201);
    const domainId = domainSchema.parse(createdDomain.json()).id;
    domainIds.push(domainId);

    const canonicalName = `重看点-${suffix}`;
    const createdObject = await app.inject({
      method: 'POST',
      url: '/api/objects',
      headers: { cookie },
      payload: { domainId, type: 'concept', canonicalName, coreStatement: '旧陈述' },
    });
    expect(createdObject.statusCode).toBe(201);
    const objectId = objectSummarySchema.parse(createdObject.json()).id;
    objectIds.push(objectId);

    const createdCapability = await app.inject({
      method: 'POST',
      url: '/api/capabilities',
      headers: { cookie },
      payload: { statement: `能解释-${suffix}`, kind: 'explain', primaryObjectId: objectId },
    });
    expect(createdCapability.statusCode).toBe(201);
    const capabilityId = capabilitySchema.parse(createdCapability.json()).id;
    capabilityIds.push(capabilityId);

    const createdEvidence = await app.inject({
      method: 'POST',
      url: `/api/capabilities/${capabilityId}/evidence`,
      headers: { cookie },
      payload: { mode: 'practice', hintLevel: 0, rating: 'fail', obstacle: '没写出来' },
    });
    expect(createdEvidence.statusCode).toBe(201);
    expect(await evidenceCount(capabilityId)).toBe(1);

    const later = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await db
      .update(reviewStates)
      .set({ dueAt: later, updatedAt: new Date() })
      .where(and(eq(reviewStates.capabilityId, capabilityId), isNull(reviewStates.deletedAt)));
    const scheduled = await dueAtOf(capabilityId);

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/objects/${objectId}`,
      headers: { cookie },
      payload: { canonicalName: `${canonicalName}改` },
    });
    expect(renamed.statusCode).toBe(200);
    expect((await dueAtOf(capabilityId)).getTime()).toBe(scheduled.getTime());

    const restated = await app.inject({
      method: 'PATCH',
      url: `/api/objects/${objectId}`,
      headers: { cookie },
      payload: { coreStatement: '新陈述' },
    });
    expect(restated.statusCode).toBe(200);
    const afterStatement = await dueAtOf(capabilityId);
    expect(afterStatement.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
    expect(afterStatement.getTime()).toBeLessThan(scheduled.getTime());
    expect(await evidenceCount(capabilityId)).toBe(1);
  });
});
