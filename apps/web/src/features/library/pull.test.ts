import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiSend } from './api.js';
import { LibraryService } from './library.service.js';

const id = '550e8400-e29b-41d4-a716-446655440000';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('另一处拉取', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('当前全貌会被换上，失败不写错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json({
          collections: [{ id, title: '甲', nodeCount: 1 }],
          edges: [],
        }),
      ),
    );
    const library = new LibraryService();
    library.watchView({ kind: 'library', edgeId: null });
    await library.pull();
    expect(library.libraryGraph).toEqual({
      collections: [{ id, title: '甲', nodeCount: 1 }],
      edges: [],
    });
    expect(library.error).toBe('');
  });

  it('拉取期间又写了本地，就不盖住', async () => {
    let release: (value: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: unknown, init?: RequestInit) => {
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method !== 'GET') return Promise.resolve(new Response(null, { status: 204 }));
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }),
    );
    const library = new LibraryService();
    library.libraryGraph = { collections: [], edges: [] };
    library.watchView({ kind: 'library', edgeId: null });
    const pending = library.pull();
    await apiSend('/api/collections/x', { method: 'PATCH' });
    release(
      json({
        collections: [{ id, title: '乙', nodeCount: 0 }],
        edges: [],
      }),
    );
    await pending;
    expect(library.libraryGraph).toEqual({ collections: [], edges: [] });
  });
});
