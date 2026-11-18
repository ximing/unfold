import { describe, expect, it } from 'vitest';
import {
  MINDMAP_DRAFT_H,
  mindmapDraftAt,
  mindmapKeyAction,
  mindmapNeighbor,
  mindmapSelectionOf,
  type MindmapKeyInput,
} from './mindmap-draft.js';

const anchor = { x: 100, y: 200, w: 80, h: 40 };
const draft = { w: 60, h: MINDMAP_DRAFT_H };
const parent = { x: 10, y: 50, w: 80, h: 40 };

describe('mindmapDraftAt', () => {
  it('子主题在右侧 72，垂直居中', () => {
    expect(mindmapDraftAt('child', anchor, draft, null)).toEqual({ x: 252, y: 203 });
  });

  it('同级之后在下方 16，左对齐', () => {
    expect(mindmapDraftAt('after', anchor, draft, null)).toEqual({ x: 100, y: 256 });
  });

  it('同级之前在上方 16，左对齐', () => {
    expect(mindmapDraftAt('before', anchor, draft, null)).toEqual({ x: 100, y: 150 });
  });

  it('父主题在两点中心的中点，根则在左侧 72', () => {
    expect(mindmapDraftAt('parent', anchor, draft, parent)).toEqual({ x: 65, y: 128 });
    expect(mindmapDraftAt('parent', anchor, draft, null)).toEqual({ x: -32, y: 203 });
  });
});

const nodes = [
  { id: 'p', parentId: null, outlineOrder: 0 },
  { id: 'q', parentId: null, outlineOrder: 1 },
  { id: 'b', parentId: 'p', outlineOrder: 1 },
  { id: 'a', parentId: 'p', outlineOrder: 1 },
  { id: 'c', parentId: 'p', outlineOrder: 0 },
];

describe('mindmapNeighbor', () => {
  it('向右进第一个子项，向左回父项，上下是同级', () => {
    expect(mindmapNeighbor(nodes, 'p', 'right')).toBe('c');
    expect(mindmapNeighbor(nodes, 'c', 'down')).toBe('a');
    expect(mindmapNeighbor(nodes, 'a', 'down')).toBe('b');
    expect(mindmapNeighbor(nodes, 'b', 'down')).toBeNull();
    expect(mindmapNeighbor(nodes, 'a', 'up')).toBe('c');
    expect(mindmapNeighbor(nodes, 'c', 'left')).toBe('p');
    expect(mindmapNeighbor(nodes, 'p', 'left')).toBeNull();
    expect(mindmapNeighbor(nodes, 'p', 'down')).toBe('q');
    expect(mindmapNeighbor(nodes, 'q', 'down')).toBeNull();
  });
});

function key(patch: Partial<MindmapKeyInput>): MindmapKeyInput {
  return {
    toolsOn: true,
    field: false,
    blocked: false,
    composing: false,
    repeat: false,
    key: 'Tab',
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    selection: 'member',
    ...patch,
  };
}

describe('mindmapKeyAction', () => {
  it('直接成员：Tab 子主题，Enter 同级，Shift+Enter 之前，⌘Enter 父主题', () => {
    expect(mindmapKeyAction(key({ key: 'Tab' }))).toEqual({ type: 'draft', role: 'child' });
    expect(mindmapKeyAction(key({ key: 'Enter' }))).toEqual({ type: 'draft', role: 'after' });
    expect(mindmapKeyAction(key({ key: 'Enter', shiftKey: true }))).toEqual({ type: 'draft', role: 'before' });
    expect(mindmapKeyAction(key({ key: 'Enter', metaKey: true }))).toEqual({ type: 'draft', role: 'parent' });
    expect(mindmapKeyAction(key({ key: 'Enter', ctrlKey: true }))).toEqual({ type: 'draft', role: 'parent' });
    expect(mindmapKeyAction(key({ key: 'Enter', metaKey: true, shiftKey: true }))).toBeNull();
    expect(mindmapKeyAction(key({ key: 'ArrowUp', altKey: true }))).toEqual({ type: 'move-sibling', direction: 'up' });
    expect(mindmapKeyAction(key({ key: 'ArrowDown', altKey: true }))).toEqual({ type: 'move-sibling', direction: 'down' });
    expect(mindmapKeyAction(key({ key: 'ArrowRight' }))).toEqual({ type: 'navigate', direction: 'right' });
    expect(mindmapKeyAction(key({ key: 'F2' }))).toEqual({ type: 'rename' });
    expect(mindmapKeyAction(key({ key: ' ' }))).toBeNull();
  });

  it('多选、芯片、输入框不产生结构动作', () => {
    expect(mindmapKeyAction(key({ selection: 'multi', key: 'Tab' }))).toEqual({ type: 'suppress' });
    expect(mindmapKeyAction(key({ selection: 'multi', key: 'Enter', shiftKey: true }))).toEqual({ type: 'suppress' });
    expect(mindmapKeyAction(key({ selection: 'multi', key: 'Enter', metaKey: true }))).toEqual({ type: 'suppress' });
    expect(mindmapKeyAction(key({ selection: 'multi', key: 'ArrowDown' }))).toEqual({ type: 'suppress' });
    expect(mindmapKeyAction(key({ selection: 'multi', key: 'ArrowUp', altKey: true }))).toEqual({ type: 'suppress' });
    expect(mindmapKeyAction(key({ selection: 'chip', key: 'Tab' }))).toEqual({ type: 'suppress' });
    expect(mindmapKeyAction(key({ selection: 'chip', key: 'Enter' }))).toBeNull();
    expect(mindmapKeyAction(key({ selection: 'chip', key: 'ArrowUp', altKey: true }))).toEqual({ type: 'suppress' });
    expect(mindmapKeyAction(key({ field: true, key: 'Tab' }))).toBeNull();
    expect(mindmapKeyAction(key({ field: true, key: 'Enter' }))).toBeNull();
    expect(mindmapKeyAction(key({ field: true, key: 'ArrowRight' }))).toBeNull();
    expect(mindmapKeyAction(key({ field: true, key: 'ArrowDown', altKey: true }))).toBeNull();
    expect(mindmapKeyAction(key({ blocked: true, key: 'Tab' }))).toBeNull();
    expect(mindmapKeyAction(key({ composing: true, key: 'Enter' }))).toBeNull();
    expect(mindmapKeyAction(key({ toolsOn: false, key: 'Tab' }))).toBeNull();
  });

  it('只有没有 groupId 的直接成员走树，投影点方向键留给空间远近', () => {
    expect(
      mindmapSelectionOf({
        selectedIds: ['a'],
        selectedId: 'a',
        edge: false,
        item: { id: 'a' },
      }),
    ).toBe('member');
    expect(
      mindmapSelectionOf({
        selectedIds: ['a'],
        selectedId: 'a',
        edge: false,
        item: { id: 'a', groupId: 'child' },
      }),
    ).toBe('projected');
    expect(
      mindmapSelectionOf({
        selectedIds: ['inclusion:c'],
        selectedId: 'inclusion:c',
        edge: false,
        item: { id: 'inclusion:c', face: 'inclusion', groupId: 'c' },
      }),
    ).toBe('chip');
    expect(mindmapKeyAction(key({ selection: 'member', key: 'ArrowLeft' }))).toEqual({
      type: 'navigate',
      direction: 'left',
    });
    expect(mindmapKeyAction(key({ selection: 'projected', key: 'ArrowRight' }))).toBeNull();
    expect(mindmapKeyAction(key({ selection: 'projected', key: 'Tab' }))).toEqual({ type: 'suppress' });
    expect(mindmapKeyAction(key({ selection: 'chip', key: 'ArrowDown' }))).toBeNull();
    expect(mindmapKeyAction(key({ selection: 'edge', key: 'Enter' }))).toBeNull();
  });
});
