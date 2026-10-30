import { defaultEdgeAppearance } from '@unfold/dto';
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
      nodes: [
        {
          id,
          name: '后来的点',
          description: '',
          kind: 'text',
          x: null,
          y: null,
          z: null,
          imageWidth: null,
          assetId: null,
          cardCount: 0,
          cardTypes: [],
          parentId: null,
          outlineOrder: 0,
        },
      ],
      edges: [], bridges: [], inclusions: [], appearance: defaultEdgeAppearance, outlineVersion: 0,
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

  it('保存位置成功后写回当前图', async () => {
    const other = '550e8400-e29b-41d4-a716-446655440001';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const library = new LibraryService();
    library.graphId = 'col-1';
    library.graph = {
      nodes: [
        { ...placedNode, id, name: '甲' },
        { ...placedNode, id: other, name: '乙', x: 1, y: 2, z: 0 },
      ],
      edges: [], bridges: [], inclusions: [], appearance: defaultEdgeAppearance, outlineVersion: 0,
    };
    await expect(library.savePlacements('col-1', [{ nodeId: id, x: 12.5, y: -4, z: 3 }])).resolves.toBe(true);
    expect(library.graph.nodes[0]).toMatchObject({ x: 12.5, y: -4, z: 3 });
    expect(library.graph.nodes[1]).toMatchObject({ x: 1, y: 2, z: 0 });
    expect(library.error).toBe('');
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/collections/col-1/placements',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify({ placements: [{ nodeId: id, x: 12.5, y: -4, z: 3 }] }),
      }),
    );
  });

  it('保存图片宽度成功后写回 imageWidth', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const library = new LibraryService();
    library.graphId = 'col-1';
    library.graph = { nodes: [{ ...placedNode, x: 1, y: 2, z: 0, imageWidth: null }], edges: [], bridges: [], inclusions: [], appearance: defaultEdgeAppearance, outlineVersion: 0 };
    await expect(
      library.savePlacements('col-1', [{ nodeId: id, x: 1, y: 2, z: 0, imageWidth: 300 }]),
    ).resolves.toBe(true);
    expect(library.graph.nodes[0]).toMatchObject({ x: 1, y: 2, z: 0, imageWidth: 300 });
  });

  it('只保存坐标时保留原来的 imageWidth', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const library = new LibraryService();
    library.graphId = 'col-1';
    library.graph = { nodes: [{ ...placedNode, x: 1, y: 2, z: 0, imageWidth: 240 }], edges: [], bridges: [], inclusions: [], appearance: defaultEdgeAppearance, outlineVersion: 0 };
    await expect(library.savePlacements('col-1', [{ nodeId: id, x: 5, y: 6, z: 1 }])).resolves.toBe(true);
    expect(library.graph.nodes[0]).toMatchObject({ x: 5, y: 6, z: 1, imageWidth: 240 });
  });

  it('保存位置失败时保留坐标并显示服务端说明', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'invalid_body', message: '位置不对' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const library = new LibraryService();
    library.graphId = 'col-1';
    library.graph = { nodes: [{ ...placedNode, x: 3, y: 4, z: 1, imageWidth: 240 }], edges: [], bridges: [], inclusions: [], appearance: defaultEdgeAppearance, outlineVersion: 0 };
    await expect(
      library.savePlacements('col-1', [{ nodeId: id, x: 9, y: 9, z: 2, imageWidth: 300 }]),
    ).resolves.toBe(false);
    expect(library.graph.nodes[0]).toMatchObject({ x: 3, y: 4, z: 1, imageWidth: 240 });
    expect(library.error).toBe('位置不对');
  });

  it('保存位置断开时返回 false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const library = new LibraryService();
    library.graphId = 'col-1';
    library.graph = { nodes: [{ ...placedNode, imageWidth: 240 }], edges: [], bridges: [], inclusions: [], appearance: defaultEdgeAppearance, outlineVersion: 0 };
    await expect(
      library.savePlacements('col-1', [{ nodeId: id, x: 1, y: 1, z: 1, imageWidth: 300 }]),
    ).resolves.toBe(false);
    expect(library.error).toBe('网络没有连上');
    expect(library.graph.nodes[0]).toMatchObject({ x: null, y: null, z: null, imageWidth: 240 });
  });

  it('先发出的位置请求后完成时不会盖住后一次保存', async () => {
    let releaseFirst: (value: Response) => void = () => {};
    const first = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        calls += 1;
        return calls === 1 ? first : Promise.resolve(new Response(null, { status: 204 }));
      }),
    );
    const library = new LibraryService();
    library.graphId = 'col-1';
    library.graph = { nodes: [{ ...placedNode, x: 0, y: 0, z: 0 }], edges: [], bridges: [], inclusions: [], appearance: defaultEdgeAppearance, outlineVersion: 0 };
    const older = library.savePlacements('col-1', [{ nodeId: id, x: 1, y: 1, z: 1 }]);
    const newer = library.savePlacements('col-1', [{ nodeId: id, x: 9, y: 8, z: 4 }]);
    releaseFirst(new Response(null, { status: 204 }));
    await older;
    await newer;
    expect(library.graph.nodes[0]).toMatchObject({ x: 9, y: 8, z: 4 });
  });

  it('连线外观失败时回到写入前', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const library = new LibraryService();
    library.graphId = 'col-1';
    library.graph = { nodes: [], edges: [], bridges: [], inclusions: [], appearance: { ...defaultEdgeAppearance }, outlineVersion: 0 };
    await expect(
      library.updateAppearance('col-1', { ...defaultEdgeAppearance, color: 'red' }),
    ).resolves.toBe(false);
    expect(library.graph.appearance.color).toBe('gray');
    expect(library.error).toBe('网络没有连上');
  });

  it('后发出的连线外观不会被先发出的失败盖住', async () => {
    let rejectFirst: (reason: unknown) => void = () => {};
    const first = new Promise<Response>((_resolve, reject) => {
      rejectFirst = reject;
    });
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        calls += 1;
        if (calls === 1) return first;
        return Promise.resolve(json({ ...defaultEdgeAppearance, color: 'blue' }));
      }),
    );
    const library = new LibraryService();
    library.graphId = 'col-1';
    library.graph = { nodes: [], edges: [], bridges: [], inclusions: [], appearance: { ...defaultEdgeAppearance }, outlineVersion: 0 };
    const older = library.updateAppearance('col-1', { ...defaultEdgeAppearance, color: 'red' });
    const newer = library.updateAppearance('col-1', { ...defaultEdgeAppearance, color: 'blue' });
    rejectFirst(new TypeError('Failed to fetch'));
    await older;
    await expect(newer).resolves.toBe(true);
    expect(library.graph.appearance.color).toBe('blue');
    expect(library.error).toBe('');
  });

  it('保存子集合里的点时写回那一层的坐标', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const childId = '550e8400-e29b-41d4-a716-446655440001';
    const library = new LibraryService();
    library.graphId = 'col-1';
    library.graph = {
      nodes: [],
      edges: [],
      bridges: [],
      inclusions: [
        {
          childId,
          title: '子',
          x: 10,
          y: 20,
          collapsed: false,
          labels: [],
          nodes: [{ ...placedNode, x: 1, y: 2, z: 0 }],
          edges: [],
        },
      ],
      appearance: defaultEdgeAppearance, outlineVersion: 0,
    };
    await expect(library.savePlacements(childId, [{ nodeId: id, x: 8, y: 9, z: 3 }])).resolves.toBe(true);
    expect(library.graph.inclusions[0]?.nodes[0]).toMatchObject({ x: 8, y: 9, z: 3 });
    expect(library.graph.nodes).toEqual([]);
  });
});

const placedNode = {
  id,
  name: '甲',
  description: '',
  kind: 'text' as const,
  x: null,
  y: null,
  z: null,
  imageWidth: null,
  assetId: null,
  cardCount: 0,
  cardTypes: [],
  parentId: null,
  outlineOrder: 0,
};
