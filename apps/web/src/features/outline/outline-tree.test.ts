import { describe, expect, it } from 'vitest';
import { expandedWithAncestors, type OutlineNodeRef } from './outline-tree.js';

function node(id: string, parentId: string | null, outlineOrder = 0): OutlineNodeRef {
  return { id, parentId, outlineOrder };
}

const nodes: OutlineNodeRef[] = [
  node('root', null, 0),
  node('parent', 'root', 0),
  node('child', 'parent', 0),
  node('other', null, 1),
  node('other-child', 'other', 0),
];

describe('expandedWithAncestors', () => {
  it('折叠的父项会被加进展开集合', () => {
    const expanded = new Set<string>();
    const next = expandedWithAncestors(expanded, nodes, 'child');
    expect(next.has('parent')).toBe(true);
    expect(next.has('root')).toBe(true);
    expect(next.has('child')).toBe(false);
    expect(expanded.size).toBe(0);
  });

  it('无关的折叠保持折叠', () => {
    const expanded = new Set<string>(['root']);
    const next = expandedWithAncestors(expanded, nodes, 'child');
    expect(next.has('other')).toBe(false);
    expect(next.has('other-child')).toBe(false);
    expect(next.has('parent')).toBe(true);
  });

  it('已经展开的还在', () => {
    const expanded = new Set(['root', 'kept']);
    const next = expandedWithAncestors(expanded, nodes, 'child');
    expect(next.has('root')).toBe(true);
    expect(next.has('kept')).toBe(true);
    expect(next.has('parent')).toBe(true);
  });

  it('节点不在图里时集合不变', () => {
    const expanded = new Set(['root', 'kept']);
    const next = expandedWithAncestors(expanded, nodes, 'missing');
    expect(next).toEqual(new Set(['root', 'kept']));
    next.add('extra');
    expect(expanded.has('extra')).toBe(false);
  });
});
