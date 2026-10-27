import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { createPool } from './client.js';

const username = process.env.SEED_USERNAME;
const password = process.env.SEED_PASSWORD;
if (!username) throw new Error('SEED_USERNAME is not set');
if (!password) throw new Error('SEED_PASSWORD is not set');

const currentTables = [
  'users',
  'collections',
  'nodes',
  'memberships',
  'edges',
  'collection_edges',
  'collection_inclusions',
  'cards',
  'assets',
] as const;

const retiredTables = [
  'capabilities',
  'capability_objects',
  'evidence',
  'review_states',
  'suggestions',
  'suggestion_notices',
  'revisions',
  'documents',
  'document_revisions',
  'domains',
  'knowledge_objects',
  'index_outbox',
  'collection_reads',
  'annotations',
  'relations',
  'sources',
  'block_index',
] as const;

describe('live schema', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username, password },
    });
    expect(login.statusCode).toBe(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps the live product tables and has none of the retired tables', async () => {
    const pool = createPool();
    try {
      const result = await pool.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      const tables = result.rows.map((row) => row.table_name);

      expect(tables).toEqual(expect.arrayContaining([...currentTables]));
      for (const name of retiredTables) {
        expect(tables).not.toContain(name);
      }
    } finally {
      await pool.end();
    }
  });
});
