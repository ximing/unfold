import { afterEach, describe, expect, it, vi } from 'vitest';
import { LibraryService } from './library.service.js';

const id = '550e8400-e29b-41d4-a716-446655440000';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('LibraryService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('合法响应会写入合集', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ collections: [{ id, title: '甲', nodeCount: 1 }] })),
    );
    const library = new LibraryService();
    await expect(library.loadCollections()).resolves.toBe(true);
    expect(library.collections).toEqual([{ id, title: '甲', nodeCount: 1 }]);
    expect(library.error).toBe('');
  });

  it('合集请求断开时返回 false，不抛出', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const library = new LibraryService();
    await expect(library.loadCollections()).resolves.toBe(false);
    expect(library.error).toBe('网络没有连上');
    expect(library.collections).toEqual([]);
  });

  it('过期的图请求失败不会盖住后到的结果', async () => {
    let rejectFirst: (reason: unknown) => void = () => {};
    const first = new Promise<Response>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const graph = {
      nodes: [{ id, name: '后来的点', description: '', cardCount: 0, cardTypes: [] }],
      edges: [],
    };
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        calls += 1;
        return calls === 1 ? first : Promise.resolve(json(graph));
      }),
    );
    const library = new LibraryService();
    const pending = library.loadGraph('col-old');
    await expect(library.loadGraph('col-new')).resolves.toBe(true);
    rejectFirst(new TypeError('Failed to fetch'));
    await expect(pending).resolves.toBe(false);
    expect(library.graph.nodes.map((node) => node.name)).toEqual(['后来的点']);
    expect(library.graphId).toBe('col-new');
    expect(library.error).not.toBe('网络没有连上');
  });

  it('预览请求断开时保持安静', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const library = new LibraryService();
    await library.loadPeek(id);
    expect(library.error).toBe('');
    expect(library.peek).toBeNull();
  });
});
