import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphInclusion, GraphNode } from '@unfold/dto';
import { INCLUSION_PAD, INCLUSION_TITLE } from '@unfold/dto';
import { inclusionChildId, inclusionFrameRect, inclusionItemId, projectCollection } from './inclusion-view.js';
import { NODE_H, NODE_W } from './board-layout.js';

const childId = '550e8400-e29b-41d4-a716-446655440010';
const parentNode = '550e8400-e29b-41d4-a716-446655440001';
const innerNode = '550e8400-e29b-41d4-a716-446655440002';
const sharedNode = '550e8400-e29b-41d4-a716-446655440003';

function node(id: string, x: number | null, y: number | null): GraphNode {
  return {
    id,
    name: id.slice(0, 4),
    description: '',
    kind: 'text',
    x,
    y,
    z: 1,
    imageWidth: null,
    assetId: null,
    cardCount: 0,
    cardTypes: [],
    parentId: null,
    outlineOrder: 0,
  };
}

function edge(id: string, fromId: string, toId: string): GraphEdge {
  return { id, fromId, toId, label: '相关', cardCount: 0 };
}

function inclusion(patch: Partial<GraphInclusion> & Pick<GraphInclusion, 'nodes' | 'edges'>): GraphInclusion {
  return {
    childId,
    title: '笔记',
    x: 100,
    y: 80,
    collapsed: false,
    labels: ['包含'],
    ...patch,
  };
}

describe('projectCollection', () => {
  it('展开时把子集合的坐标加上锚点，并跳过已在父合集里的点', () => {
    const view = projectCollection({
      nodes: [node(parentNode, 0, 0), node(sharedNode, 20, 20)],
      edges: [],
      bridges: [edge('bridge', parentNode, innerNode)],
      inclusions: [
        inclusion({
          nodes: [node(innerNode, 10, 30), node(sharedNode, 400, 400)],
          edges: [edge('inner', innerNode, sharedNode)],
        }),
      ],
    });
    const inner = view.items.find((item) => item.id === innerNode);
    expect(inner).toMatchObject({ x: 110, y: 110, groupId: childId });
    expect(view.items.filter((item) => item.id === sharedNode)).toHaveLength(1);
    expect(view.items.find((item) => item.id === sharedNode)?.x).toBe(20);
    expect(view.groups[0]?.memberIds).toEqual([innerNode]);
    expect(view.links.map((link) => link.id)).toEqual(['bridge']);
    const frame = inclusionFrameRect(view.groups[0]!, new Map([[innerNode, { x: 110, y: 110, w: NODE_W, h: NODE_H }]]));
    expect(frame).toEqual({
      x: 110 - INCLUSION_PAD,
      y: 110 - INCLUSION_PAD - INCLUSION_TITLE,
      w: NODE_W + INCLUSION_PAD * 2,
      h: NODE_H + INCLUSION_PAD * 2 + INCLUSION_TITLE,
    });
  });

  it('收起时内部边消失，跨集合的边接到子集合那个点上', () => {
    const view = projectCollection({
      nodes: [node(parentNode, 0, 0)],
      edges: [],
      bridges: [edge('bridge', parentNode, innerNode)],
      inclusions: [inclusion({ collapsed: true, nodes: [node(innerNode, 10, 30)], edges: [edge('inner', innerNode, innerNode)] })],
    });
    const chip = view.items.find((item) => item.face === 'inclusion');
    expect(chip?.id).toBe(inclusionItemId(childId));
    expect(chip).toMatchObject({
      x: 110 - INCLUSION_PAD,
      y: 110 - INCLUSION_PAD - INCLUSION_TITLE,
      description: '子集合 · 1 个点',
    });
    expect(view.links).toEqual([
      expect.objectContaining({ id: 'bridge', fromId: parentNode, toId: inclusionItemId(childId) }),
    ]);
    expect(inclusionChildId(chip?.id ?? '')).toBe(childId);
  });
});
