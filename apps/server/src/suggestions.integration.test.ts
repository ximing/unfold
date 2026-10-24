import {
  documentResponseSchema,
  domainSchema,
  fanRelationListSchema,
  objectSummarySchema,
  suggestionListSchema,
  suggestionSchema,
  type Suggestion,
} from '@unfold/dto';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createDb, createPool } from './db/client.js';
import { documents, domains, knowledgeObjects, relations, suggestions, users } from './db/schema.js';

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

function relationOf(item: Suggestion) {
  if (item.kind !== 'relation' || !('type' in item.payload)) return null;
  return item.payload;
}

describe('rule suggestions', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  const stamp = Date.now();
  const domainName = `领域-${stamp}`;
  const stateName = `状态等价-${stamp}`;
  const treeName = `决策树-${stamp}`;
  const optName = `最优子结构-${stamp}`;
  const overName = `重叠子问题-${stamp}`;
  const domainIds: string[] = [];
  const objectIds: string[] = [];
  let domainId = '';
  let stateId = '';
  let treeId = '';
  let contrastId = '';
  let contrastKey = '';
  let evolvesId = '';

  async function createObject(
    type: 'concept' | 'principle' | 'model',
    canonicalName: string,
    coreStatement: string,
  ): Promise<string> {
    const created = await app.inject({
      method: 'POST',
      url: '/api/objects',
      headers: { cookie },
      payload: { domainId, type, canonicalName, coreStatement },
    });
    expect(created.statusCode).toBe(201);
    const id = objectSummarySchema.parse(created.json()).id;
    objectIds.push(id);
    return id;
  }

  async function putDoc(objectId: string, plainText: string) {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/objects/${objectId}/doc`,
      headers: { cookie },
      payload: {
        schemaVersion: 1,
        plainText,
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: plainText }] }],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(documentResponseSchema.parse(res.json()).plainText).toBe(plainText);
    return res;
  }

  async function listSuggestions(objectId: string) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/objects/${objectId}/suggestions`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    return suggestionListSchema.parse(res.json()).suggestions;
  }

  async function resolve(id: string, status: 'accepted' | 'deferred' | 'rejected') {
    return app.inject({
      method: 'POST',
      url: `/api/suggest/${id}/resolve`,
      headers: { cookie },
      payload: { status },
    });
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
    if (!found[0]) throw new Error('seed user missing');

    const created = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { cookie },
      payload: { name: domainName },
    });
    expect(created.statusCode).toBe(201);
    domainId = domainSchema.parse(created.json()).id;
    domainIds.push(domainId);

    stateId = await createObject('concept', stateName, '两个历史对未来没有影响就是同一状态');
    treeId = await createObject('model', treeName, '重复子问题被合并成同一状态');
    await createObject('principle', optName, '局部最优能拼成全局最优');
    await createObject('principle', overName, '同一个状态会被反复遇到');
  });

  afterAll(async () => {
    const now = new Date();
    if (objectIds.length > 0) {
      await db
        .update(suggestions)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(suggestions.objectId, objectIds));
      await db
        .update(relations)
        .set({ deletedAt: now, updatedAt: now })
        .where(or(inArray(relations.fromId, objectIds), inArray(relations.toId, objectIds)));
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

  it('rejects GET /api/objects/:id/suggestions without a cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/objects/${stateId}/suggestions`,
    });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res.json())).toEqual({ code: 'unauthenticated', message: '未登录' });
  });

  it('records a contrast and an evolves_from after the object document is saved', async () => {
    await putDoc(stateId, `${optName}和${overName}写在同一段，还有${treeName}。`);
    const listed = await listSuggestions(stateId);
    expect(listed.some((item) => item.kind === 'personal_note')).toBe(false);

    const contrast = listed.find((item) => relationOf(item)?.type === 'contrasts');
    const evolves = listed.find((item) => relationOf(item)?.type === 'evolves_from');
    expect(contrast).toBeTruthy();
    expect(evolves).toBeTruthy();
    if (!contrast || !evolves) return;
    expect(contrast.summary).toContain('不提供合并');
    const evolvesPayload = relationOf(evolves);
    expect(evolvesPayload).toMatchObject({ type: 'evolves_from', fromId: stateId, toId: treeId });
    contrastId = contrast.id;
    contrastKey = contrast.fragmentKey;
    evolvesId = evolves.id;
  });

  it('does not bring back a rejected fragment key on the next save', async () => {
    const rejected = await resolve(contrastId, 'rejected');
    expect(rejected.statusCode).toBe(200);
    expect(suggestionSchema.parse(rejected.json()).status).toBe('rejected');

    await putDoc(stateId, `${optName}和${overName}写在同一段，还有${treeName}。`);
    const listed = await listSuggestions(stateId);
    expect(listed.some((item) => item.fragmentKey === contrastKey)).toBe(false);
  });

  it('accepts evolves_from into the fan and drops it from the tray', async () => {
    const accepted = await resolve(evolvesId, 'accepted');
    expect(accepted.statusCode).toBe(200);
    expect(suggestionSchema.parse(accepted.json())).toMatchObject({
      id: evolvesId,
      status: 'accepted',
      origin: 'rule',
    });

    const rel = await app.inject({
      method: 'GET',
      url: `/api/objects/${stateId}/relations`,
      headers: { cookie },
    });
    expect(rel.statusCode).toBe(200);
    const fan = fanRelationListSchema.parse(rel.json());
    expect(
      fan.relations.some(
        (item) =>
          item.type === 'evolves_from' &&
          item.status === 'accepted' &&
          item.origin === 'rule' &&
          item.fromId === stateId &&
          item.toId === treeId,
      ),
    ).toBe(true);

    const listed = await listSuggestions(stateId);
    expect(listed.some((item) => item.id === evolvesId)).toBe(false);
  });

  it('turns an accepted personal note into a block and removes it from the tray', async () => {
    const sentence = '我认为这两个历史对未来没有影响。';
    await putDoc(stateId, sentence);
    const listed = await listSuggestions(stateId);
    const note = listed.find((item) => item.kind === 'personal_note');
    expect(note).toBeTruthy();
    if (!note) return;
    expect(note.payload).toMatchObject({ text: sentence });

    const accepted = await resolve(note.id, 'accepted');
    expect(accepted.statusCode).toBe(200);
    expect(suggestionSchema.parse(accepted.json()).status).toBe('accepted');

    const doc = await app.inject({
      method: 'GET',
      url: `/api/objects/${stateId}/doc`,
      headers: { cookie },
    });
    expect(doc.statusCode).toBe(200);
    const body = documentResponseSchema.parse(doc.json());
    expect(JSON.stringify(body.content)).toContain('personal_note');
    expect(JSON.stringify(body.content)).toContain('我');
    expect(body.plainText).toContain('我');

    const after = await listSuggestions(stateId);
    expect(after.some((item) => item.id === note.id)).toBe(false);
  });

  it('keeps a deferred suggestion until it is accepted, then refuses another resolve', async () => {
    const sentence = '我还想记一条不同的理解。';
    await putDoc(stateId, sentence);
    const listed = await listSuggestions(stateId);
    const note = listed.find((item) => item.kind === 'personal_note' && 'text' in item.payload);
    expect(note).toBeTruthy();
    if (!note || !('text' in note.payload)) return;
    expect(note.payload.text).toBe(sentence);

    const deferred = await resolve(note.id, 'deferred');
    expect(deferred.statusCode).toBe(200);
    expect(suggestionSchema.parse(deferred.json()).status).toBe('deferred');

    const still = await listSuggestions(stateId);
    expect(still.some((item) => item.id === note.id && item.status === 'deferred')).toBe(true);

    const accepted = await resolve(note.id, 'accepted');
    expect(accepted.statusCode).toBe(200);
    expect(suggestionSchema.parse(accepted.json()).status).toBe('accepted');

    const again = await resolve(note.id, 'rejected');
    expect(again.statusCode).toBe(409);
    expect(errorOf(again.json())).toEqual({
      code: 'invalid_transition',
      message: '这条建议不能再改状态',
    });
  });

  it('does not record a personal note when the sentence has no 我', async () => {
    const aloneId = await createObject('concept', `同一状态-${stamp}`, '');
    await putDoc(aloneId, '如果两个历史对未来没有影响，它们就是同一状态。');
    const listed = await listSuggestions(aloneId);
    expect(listed.some((item) => item.kind === 'personal_note')).toBe(false);
  });

  it('defers every pending suggestion on the point', async () => {
    const focusId = await createObject('concept', `另一焦点-${stamp}`, '');
    await putDoc(focusId, `${optName}与${overName}，以及${treeName}`);
    const before = await listSuggestions(focusId);
    expect(before.filter((item) => item.status === 'pending')).toHaveLength(2);

    const res = await app.inject({
      method: 'POST',
      url: `/api/objects/${focusId}/suggestions/defer`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = suggestionListSchema.parse(res.json());
    expect(body.suggestions).toHaveLength(2);
    expect(body.suggestions.every((item) => item.status === 'deferred')).toBe(true);
    expect(body.suggestions.some((item) => item.status === 'pending')).toBe(false);
  });
});
