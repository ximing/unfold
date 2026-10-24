import { describe, expect, it } from 'vitest';
import { buildChain, layoutChain, type ChainEdge } from './chain.js';

function at(ms: number): Date {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, ms));
}

function edge(
  id: string,
  fromId: string,
  toId: string,
  type: ChainEdge['type'],
  whatChanged: string,
  createdAt: Date,
): ChainEdge {
  return { id, fromId, toId, type, whatChanged, createdAt };
}

describe('buildChain', () => {
  it('places evolves_from origins on the left and keeps whatChanged verbatim', () => {
    const edges = [
      edge('b-from-a', 'B', 'A', 'evolves_from', '重复子问题被合并。', at(1)),
      edge('c-from-b', 'C', 'B', 'evolves_from', '第一次算完，就记住！', at(2)),
    ];

    expect(buildChain('B', edges)).toEqual([
      {
        type: 'evolves_from',
        nodeIds: ['A', 'B', 'C'],
        edges: [
          { fromId: 'A', toId: 'B', whatChanged: '重复子问题被合并。' },
          { fromId: 'B', toId: 'C', whatChanged: '第一次算完，就记住！' },
        ],
      },
    ]);
  });

  it('stops when evolves_from loops', () => {
    const edges = [
      edge('b-from-a', 'B', 'A', 'evolves_from', 'b来自a', at(1)),
      edge('c-from-b', 'C', 'B', 'evolves_from', 'c来自b', at(2)),
      edge('a-from-c', 'A', 'C', 'evolves_from', 'a来自c', at(3)),
    ];

    expect(buildChain('B', edges)).toEqual([
      {
        type: 'evolves_from',
        nodeIds: ['C', 'A', 'B'],
        edges: [
          { fromId: 'C', toId: 'A', whatChanged: 'a来自c' },
          { fromId: 'A', toId: 'B', whatChanged: 'b来自a' },
        ],
      },
    ]);
  });

  it('follows the earliest createdAt edge at a fork', () => {
    const edges = [
      edge('early-origin', 'B', 'A', 'evolves_from', '早来历', at(1)),
      edge('late-origin', 'B', 'D', 'evolves_from', '晚来历', at(3)),
      edge('early-later', 'C', 'B', 'evolves_from', '早去向', at(2)),
      edge('late-later', 'E', 'B', 'evolves_from', '晚去向', at(4)),
    ];

    expect(buildChain('B', edges)).toEqual([
      {
        type: 'evolves_from',
        nodeIds: ['A', 'B', 'C'],
        edges: [
          { fromId: 'A', toId: 'B', whatChanged: '早来历' },
          { fromId: 'B', toId: 'C', whatChanged: '早去向' },
        ],
      },
    ]);
  });

  it('walks variant from fromId to toId', () => {
    const edges = [
      edge('a-to-b', 'A', 'B', 'variant', '目标变成最少刀数', at(1)),
      edge('b-to-c', 'B', 'C', 'variant', '再放宽一步', at(2)),
    ];

    expect(buildChain('A', edges)).toEqual([
      {
        type: 'variant',
        nodeIds: ['A', 'B', 'C'],
        edges: [
          { fromId: 'A', toId: 'B', whatChanged: '目标变成最少刀数' },
          { fromId: 'B', toId: 'C', whatChanged: '再放宽一步' },
        ],
      },
    ]);
  });

  it('keeps evolves_from and variant on separate chains', () => {
    const edges = [
      edge('evolves', 'B', 'A', 'evolves_from', '演化了', at(1)),
      edge('variant', 'B', 'C', 'variant', '变成了', at(2)),
    ];

    expect(buildChain('B', edges)).toEqual([
      {
        type: 'evolves_from',
        nodeIds: ['A', 'B'],
        edges: [{ fromId: 'A', toId: 'B', whatChanged: '演化了' }],
      },
      {
        type: 'variant',
        nodeIds: ['B', 'C'],
        edges: [{ fromId: 'B', toId: 'C', whatChanged: '变成了' }],
      },
    ]);
  });
});

describe('layoutChain', () => {
  it('spaces three nodes 160 apart on y = 0', () => {
    expect(layoutChain(['A', 'B', 'C'])).toEqual([
      { id: 'A', x: 0, y: 0 },
      { id: 'B', x: 160, y: 0 },
      { id: 'C', x: 320, y: 0 },
    ]);
  });
});
