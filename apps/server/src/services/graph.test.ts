import { describe, expect, it } from 'vitest';
import { layoutGraph, type GraphNeighbor } from './graph';

const focus = { id: 'focus', canonicalName: '状态等价', coreStatement: '一句话' };

describe('layoutGraph', () => {
  it('没有邻居时只放焦点', () => {
    const layout = layoutGraph(focus, []);
    expect(layout.truncated).toBe(false);
    expect(layout.nodes).toEqual([
      {
        id: 'focus',
        canonicalName: '状态等价',
        coreStatement: '一句话',
        x: 0,
        y: 0,
      },
    ]);
    expect(layout.edges).toEqual([]);
  });

  it('四个扇区各放一个邻居', () => {
    const neighbors: GraphNeighbor[] = [
      { id: 'origin', sector: 'origin', canonicalName: '来源', coreStatement: '来源' },
      { id: 'destination', sector: 'destination', canonicalName: '去向', coreStatement: '去向' },
      { id: 'contrast', sector: 'contrast', canonicalName: '对照', coreStatement: '对照' },
      { id: 'change', sector: 'change', canonicalName: '变化', coreStatement: '变化' },
    ];
    const layout = layoutGraph(focus, neighbors);
    const byId = Object.fromEntries(layout.nodes.map((node) => [node.id, node]));
    expect(byId.origin).toMatchObject({ x: -180, y: 0 });
    expect(byId.destination).toMatchObject({ x: 180, y: 0 });
    expect(byId.contrast).toMatchObject({ x: 0, y: -180 });
    expect(byId.change).toMatchObject({ x: 0, y: 180 });
    expect(layout.edges).toHaveLength(4);
    for (const edge of layout.edges) expect(edge.fromId).toBe('focus');
  });

  it('两个 origin 沿纵轴对称', () => {
    const neighbors: GraphNeighbor[] = [
      { id: 'a', sector: 'origin', canonicalName: 'a', coreStatement: 'a' },
      { id: 'b', sector: 'origin', canonicalName: 'b', coreStatement: 'b' },
    ];
    const layout = layoutGraph(focus, neighbors);
    const origins = layout.nodes.filter((node) => node.id !== 'focus');
    expect(origins.map((node) => node.x)).toEqual([-180, -180]);
    expect(origins.map((node) => node.y)).toEqual([-36, 36]);
  });

  it('超过 50 个邻居时截断', () => {
    const neighbors: GraphNeighbor[] = Array.from({ length: 51 }, (_, index) => ({
      id: `n${index}`,
      sector: 'origin',
      canonicalName: `n${index}`,
      coreStatement: `n${index}`,
    }));
    const layout = layoutGraph(focus, neighbors);
    expect(layout.truncated).toBe(true);
    expect(layout.nodes).toHaveLength(51);
    expect(layout.nodes.map((node) => node.id)).not.toContain('n50');
  });
});
