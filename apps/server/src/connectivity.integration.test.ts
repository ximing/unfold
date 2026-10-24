import { afterAll, describe, expect, it } from 'vitest';
import { createPool } from './db/client.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function meili(path: string, key: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${key}`);
  if (init?.body) headers.set('Content-Type', 'application/json');
  return fetch(`${required('MEILI_URL')}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(8000),
  });
}

describe('connectivity', () => {
  const pools: Array<{ end: () => Promise<void> }> = [];

  afterAll(async () => {
    const qdrant = process.env.QDRANT_URL;
    const qdrantKey = process.env.QDRANT_API_KEY;
    if (qdrant && qdrantKey) {
      await fetch(`${qdrant}/collections/unfold_connectivity_probe`, {
        method: 'DELETE',
        headers: { 'api-key': qdrantKey },
        signal: AbortSignal.timeout(8000),
      }).catch(() => undefined);
    }
    for (const pool of pools) await pool.end();
  });

  it('connects to unfold_dev', async () => {
    const pool = createPool();
    pools.push(pool);
    const result = await pool.query('select current_database() as name');
    expect(result.rows[0].name).toBe('unfold_dev');
  });

  it('searches the unfold index with the search key', async () => {
    const admin = required('MEILI_ADMIN_KEY');
    const search = required('MEILI_SEARCH_KEY');
    const created = await meili('/indexes', admin, {
      method: 'POST',
      body: JSON.stringify({ uid: 'unfold', primaryKey: 'id' }),
    });
    expect([200, 202, 409]).toContain(created.status);

    const settings = await meili('/indexes/unfold/settings', admin, {
      method: 'PATCH',
      body: JSON.stringify({
        searchableAttributes: ['title', 'aliases', 'core', 'text'],
        filterableAttributes: ['user_id', 'kind', 'domain'],
      }),
    });
    expect([200, 202]).toContain(settings.status);

    let status = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const res = await meili('/indexes/unfold/search', search, {
        method: 'POST',
        body: JSON.stringify({ q: '' }),
      });
      status = res.status;
      if (status === 200) {
        const body = (await res.json()) as { hits?: unknown };
        expect(Array.isArray(body.hits)).toBe(true);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(status).toBe(200);
  });

  it('creates a qdrant collection', async () => {
    const root = required('QDRANT_URL');
    const key = required('QDRANT_API_KEY');
    const url = `${root}/collections/unfold_connectivity_probe`;
    const headers = { 'api-key': key, 'Content-Type': 'application/json' };
    await fetch(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(8000) }).catch(() => undefined);
    const created = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ vectors: { size: 4, distance: 'Cosine' } }),
      signal: AbortSignal.timeout(8000),
    });
    expect(created.status).toBe(200);
  });
});
