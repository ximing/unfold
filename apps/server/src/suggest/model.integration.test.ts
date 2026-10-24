import { domainSchema, objectSummarySchema, suggestionListSchema } from '@unfold/dto';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { createDb, createPool } from '../db/client.js';
import {
  documents,
  domains,
  knowledgeObjects,
  relations,
  suggestionNotices,
  suggestions,
  users,
} from '../db/schema.js';
import { modelSuggestionFailureNotice, type ModelRequester } from './model.js';
import { recordRuleSuggestions } from './record.js';

const username = process.env.SEED_USERNAME;
const password = process.env.SEED_PASSWORD;
if (!username) throw new Error('SEED_USERNAME is not set');
if (!password) throw new Error('SEED_PASSWORD is not set');

const savedKey = process.env.DASHSCOPE_API_KEY;
const savedBase = process.env.DASHSCOPE_BASE_URL;

function cookiePair(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!header) throw new Error('missing set-cookie');
  const pair = header.split(';')[0];
  if (!pair) throw new Error('missing set-cookie');
  return pair;
}

function restoreEnv(name: 'DASHSCOPE_API_KEY' | 'DASHSCOPE_BASE_URL', value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function ensureCredentials() {
  if (!process.env.DASHSCOPE_API_KEY?.trim()) process.env.DASHSCOPE_API_KEY = 'test-key';
  if (!process.env.DASHSCOPE_BASE_URL?.trim()) process.env.DASHSCOPE_BASE_URL = 'https://example.invalid';
}

describe('model suggestions', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDb>;
  let cookie = '';
  let userId = '';
  let domainId = '';
  const stamp = Date.now();
  let serial = 0;
  const domainIds: string[] = [];
  const objectIds: string[] = [];

  function nextName(prefix: string): string {
    serial += 1;
    return `${prefix}-${stamp}-${serial}`;
  }

  async function createObject(canonicalName: string): Promise<string> {
    const created = await app.inject({
      method: 'POST',
      url: '/api/objects',
      headers: { cookie },
      payload: { domainId, type: 'concept', canonicalName, coreStatement: '' },
    });
    expect(created.statusCode).toBe(201);
    const id = objectSummarySchema.parse(created.json()).id;
    objectIds.push(id);
    const doc = await app.inject({
      method: 'PUT',
      url: `/api/objects/${id}/doc`,
      headers: { cookie },
      payload: {
        schemaVersion: 1,
        plainText: 'x',
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] },
      },
    });
    expect(doc.statusCode).toBe(200);
    return id;
  }

  beforeAll(async () => {
    process.env.UNFOLD_SUGGEST_MODEL = 'off';
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
    const seed = found[0];
    if (!seed) throw new Error('seed user missing');
    userId = seed.id;

    const created = await app.inject({
      method: 'POST',
      url: '/api/domains',
      headers: { cookie },
      payload: { name: nextName('模型领域') },
    });
    expect(created.statusCode).toBe(201);
    domainId = domainSchema.parse(created.json()).id;
    domainIds.push(domainId);
  });

  afterAll(async () => {
    process.env.UNFOLD_SUGGEST_MODEL = 'off';
    restoreEnv('DASHSCOPE_API_KEY', savedKey);
    restoreEnv('DASHSCOPE_BASE_URL', savedBase);
    const now = new Date();
    if (objectIds.length > 0) {
      await db
        .update(suggestionNotices)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(suggestionNotices.objectId, objectIds));
      await db.update(suggestions).set({ deletedAt: now, updatedAt: now }).where(inArray(suggestions.objectId, objectIds));
      await db
        .update(relations)
        .set({ deletedAt: now, updatedAt: now })
        .where(or(inArray(relations.fromId, objectIds), inArray(relations.toId, objectIds)));
      await db
        .update(knowledgeObjects)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(knowledgeObjects.id, objectIds));
      await db.update(documents).set({ deletedAt: now, updatedAt: now }).where(inArray(documents.ownerId, objectIds));
    }
    if (domainIds.length > 0) {
      await db.update(domains).set({ deletedAt: now, updatedAt: now }).where(inArray(domains.id, domainIds));
    }
    await pool.end();
    await app.close();
  });

  it('stores a model analogy and clears the notice', async () => {
    process.env.UNFOLD_SUGGEST_MODEL = 'off';
    const currentName = nextName('模型当前');
    const otherName = nextName('模型候选');
    const currentId = await createObject(currentName);
    const otherId = await createObject(otherName);
    const linked = await app.inject({
      method: 'POST',
      url: '/api/relations',
      headers: { cookie },
      payload: {
        fromId: otherId,
        toId: currentId,
        type: 'implements',
        note: '实现',
        whatChanged: '',
        distinction: '',
        boundary: '',
        condition: '',
      },
    });
    expect(linked.statusCode).toBe(201);

    let calls = 0;
    const fake: ModelRequester = async () => {
      calls += 1;
      return {
        ok: true,
        items: [
          {
            kind: 'relation',
            type: 'analogous',
            fromName: currentName,
            toName: otherName,
            boundary: '只在名字上像',
            summary: '模型类比',
            acceptLabel: '',
          },
        ],
      };
    };

    process.env.UNFOLD_SUGGEST_MODEL = 'on';
    ensureCredentials();
    try {
      await recordRuleSuggestions(db, userId, currentId, fake);
    } finally {
      process.env.UNFOLD_SUGGEST_MODEL = 'off';
    }

    expect(calls).toBe(1);
    const rows = await db
      .select({
        origin: suggestions.origin,
        status: suggestions.status,
        acceptLabel: suggestions.acceptLabel,
        fragmentKey: suggestions.fragmentKey,
        summary: suggestions.summary,
      })
      .from(suggestions)
      .where(
        and(
          eq(suggestions.userId, userId),
          eq(suggestions.objectId, currentId),
          eq(suggestions.origin, 'model'),
          isNull(suggestions.deletedAt),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      origin: 'model',
      status: 'pending',
      acceptLabel: '接受',
      summary: '模型类比',
    });
    expect(rows[0]?.fragmentKey.startsWith('model:')).toBe(true);

    const listed = await app.inject({
      method: 'GET',
      url: `/api/objects/${currentId}/suggestions`,
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(suggestionListSchema.parse(listed.json()).notice).toBe('');
  });

  it('keeps rule rows and writes the failure notice when the model returns nothing', async () => {
    process.env.UNFOLD_SUGGEST_MODEL = 'off';
    const currentName = nextName('失败当前');
    const otherName = nextName('失败候选');
    const currentId = await createObject(currentName);
    const otherId = await createObject(otherName);
    const fragmentKey = `rule-keep-${stamp}-${serial}`;
    await db.insert(suggestions).values({
      userId,
      objectId: currentId,
      fragmentKey,
      kind: 'relation',
      origin: 'rule',
      status: 'pending',
      summary: '规则还在',
      acceptLabel: '接受关系',
      payload: {
        type: 'implements',
        fromId: otherId,
        toId: currentId,
        whatChanged: '',
        distinction: '',
        boundary: '',
        note: '实现',
      },
    });

    let calls = 0;
    const fake: ModelRequester = async () => {
      calls += 1;
      return { ok: false };
    };
    process.env.UNFOLD_SUGGEST_MODEL = 'on';
    ensureCredentials();
    try {
      await recordRuleSuggestions(db, userId, currentId, fake);
    } finally {
      process.env.UNFOLD_SUGGEST_MODEL = 'off';
    }

    expect(calls).toBe(1);
    const kept = await db
      .select({ origin: suggestions.origin, status: suggestions.status, deletedAt: suggestions.deletedAt })
      .from(suggestions)
      .where(
        and(eq(suggestions.userId, userId), eq(suggestions.objectId, currentId), eq(suggestions.fragmentKey, fragmentKey)),
      );
    expect(kept[0]).toMatchObject({ origin: 'rule', status: 'pending', deletedAt: null });

    const listed = await app.inject({
      method: 'GET',
      url: `/api/objects/${currentId}/suggestions`,
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(suggestionListSchema.parse(listed.json()).notice).toBe(modelSuggestionFailureNotice);
  });

  it('does not call the model when the switch is off', async () => {
    process.env.UNFOLD_SUGGEST_MODEL = 'off';
    ensureCredentials();
    const currentId = await createObject(nextName('关闭当前'));
    let calls = 0;
    const fake: ModelRequester = async () => {
      calls += 1;
      return { ok: false };
    };
    await recordRuleSuggestions(db, userId, currentId, fake);
    expect(calls).toBe(0);
    const listed = await app.inject({
      method: 'GET',
      url: `/api/objects/${currentId}/suggestions`,
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(suggestionListSchema.parse(listed.json()).notice).toBe('');
  });
});
