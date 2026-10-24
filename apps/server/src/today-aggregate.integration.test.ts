import { SCHEMA_VERSION } from '@unfold/doc-schema';
import { capabilitySchema, domainSchema, objectSummarySchema, todayResponseSchema, type TodayResponse } from '@unfold/dto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildApp } from './app.js';
import { createDb, createPool } from './db/client.js';
import { capabilities, capabilityObjects, documents, domains, evidence, knowledgeObjects, reviewStates, suggestions, users } from './db/schema.js';

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

describe('today aggregate', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  let userId = '';
  const suffix = Date.now();
  const domainName = `领域-${suffix}`;
  const nameA = `点A-${suffix}`;
  const nameB = `点B-${suffix}`;
  const statementA = `陈述A-${suffix}`;
  const statementB = `陈述B-${suffix}`;
  const domainIds: string[] = [];
  const objectIds: string[] = [];
  const capabilityIds: string[] = [];
  let domainId = '';
  let idA = '';
  let idB = '';

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
  });

  afterAll(async () => {
    const now = new Date();
    if (capabilityIds.length > 0) {
      await db
        .update(evidence)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(evidence.capabilityId, capabilityIds));
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
        .update(suggestions)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(suggestions.objectId, objectIds));
      await db
        .update(knowledgeObjects)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(knowledgeObjects.id, objectIds));
      await db
        .update(documents)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(documents.ownerType, 'object'), inArray(documents.ownerId, objectIds)));
    }
    if (domainIds.length > 0) {
      await db.update(domains).set({ deletedAt: now, updatedAt: now }).where(inArray(domains.id, domainIds));
    }
    await pool.end();
    await app.close();
  });

  async function readToday(): Promise<TodayResponse> {
    const res = await app.inject({
      method: 'GET',
      url: '/api/today',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    return todayResponseSchema.parse(res.json());
  }

  async function createPoint(canonicalName: string, coreStatement: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/objects',
      headers: { cookie },
      payload: {
        domainId,
        type: 'concept',
        canonicalName,
        coreStatement,
      },
    });
    expect(res.statusCode).toBe(201);
    const created = objectSummarySchema.parse(res.json());
    objectIds.push(created.id);
    return created.id;
  }

  it('focuses the point saved later', async () => {
    const createdDomain = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { cookie },
      payload: { name: domainName },
    });
    expect(createdDomain.statusCode).toBe(201);
    const domain = domainSchema.parse(createdDomain.json());
    domainId = domain.id;
    domainIds.push(domain.id);

    idA = await createPoint(nameA, statementA);
    idB = await createPoint(nameB, statementB);

    const today = await readToday();
    expect(today.focus?.id).toBe(idB);
    expect(today.focus?.canonicalName).toBe(nameB);
    expect(today.focus?.coreStatement).toBe(statementB);
    expect(today.focus?.domainName).toBe(domainName);
    expect(today.focus?.type).toBe('concept');
    expect(today.due).toEqual([]);
  });

  it('moves focus to the point whose question was just saved', async () => {
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/objects/${idA}/doc`,
      headers: { cookie },
      payload: {
        schemaVersion: SCHEMA_VERSION,
        plainText: '为什么容易混乱',
        content: {
          type: 'doc',
          content: [
            {
              type: 'question',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: '为什么容易混乱' }],
                },
              ],
            },
          ],
        },
      },
    });
    expect(saved.statusCode).toBe(200);

    const today = await readToday();
    expect(today.focus?.id).toBe(idA);
    const questions = today.openQuestions.filter((question) => question.objectId === idA);
    expect(questions).toHaveLength(1);
    expect(questions[0]?.objectName).toBe(nameA);
    expect(questions[0]?.text).toBe('为什么容易混乱');
    expect(z.uuid().safeParse(questions[0]?.blockId).success).toBe(true);
    expect(today.due).toEqual([]);
  });

  it('counts pending and deferred suggestions but not rejected ones', async () => {
    const before = await readToday();
    const inserted = await db
      .insert(suggestions)
      .values({
        userId,
        objectId: idA,
        fragmentKey: `today-${suffix}`,
        kind: 'personal_note',
        origin: 'rule',
        status: 'pending',
        summary: '个人',
        acceptLabel: '转成个人理解块',
        payload: { text: '我还不确定' },
      })
      .returning({ id: suggestions.id });
    const suggestionId = inserted[0]?.id;
    if (!suggestionId) throw new Error('insert suggestion failed');

    const pending = await readToday();
    expect(pending.pendingSuggestions).toBe(before.pendingSuggestions + 1);
    expect(pending.due).toEqual([]);

    await db
      .update(suggestions)
      .set({ status: 'deferred', updatedAt: new Date() })
      .where(eq(suggestions.id, suggestionId));
    const deferred = await readToday();
    expect(deferred.pendingSuggestions).toBe(before.pendingSuggestions + 1);
    expect(deferred.due).toEqual([]);

    await db
      .update(suggestions)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(eq(suggestions.id, suggestionId));
    const rejected = await readToday();
    expect(rejected.pendingSuggestions).toBe(before.pendingSuggestions);
    expect(rejected.due).toEqual([]);
  });

  it('lists a capability whose review is due and hides one that is not', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/capabilities',
      headers: { cookie },
      payload: { statement: `到期能力-${suffix}`, kind: 'explain', primaryObjectId: idA },
    });
    expect(created.statusCode).toBe(201);
    const capability = capabilitySchema.parse(created.json());
    capabilityIds.push(capability.id);

    const posted = await app.inject({
      method: 'POST',
      url: `/api/capabilities/${capability.id}/evidence`,
      headers: { cookie },
      payload: { mode: 'practice', hintLevel: 0, rating: 'fail', obstacle: '没看出相同前缀', body: '不该优先显示' },
    });
    expect(posted.statusCode).toBe(201);

    const later = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db
      .update(reviewStates)
      .set({ dueAt: later, updatedAt: new Date() })
      .where(and(eq(reviewStates.capabilityId, capability.id), isNull(reviewStates.deletedAt)));
    const hidden = await readToday();
    expect(hidden.due.find((item) => item.capabilityId === capability.id)).toBeUndefined();

    const past = new Date(Date.now() - 60 * 1000);
    await db
      .update(reviewStates)
      .set({ dueAt: past, updatedAt: new Date() })
      .where(and(eq(reviewStates.capabilityId, capability.id), isNull(reviewStates.deletedAt)));
    const today = await readToday();
    const item = today.due.find((row) => row.capabilityId === capability.id);
    expect(item?.statement).toBe(`到期能力-${suffix}`);
    expect(item?.evidenceNote).toBe('没看出相同前缀');
    expect(item?.dueAt).toBe(past.toISOString());

    const dueRes = await app.inject({ method: 'GET', url: '/api/review/due', headers: { cookie } });
    expect(dueRes.statusCode).toBe(200);
    const dueBody = dueRes.json() as { due: { capabilityId: string; evidenceNote: string }[] };
    expect(dueBody.due.find((row) => row.capabilityId === capability.id)?.evidenceNote).toBe('没看出相同前缀');
  });
});
