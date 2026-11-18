import { describe, expect, it } from 'vitest';
import { NODE_H, NODE_W } from './board-layout.js';
import {
  MINDMAP_LEVEL_GAP,
  MINDMAP_ORIGIN_X,
  MINDMAP_ORIGIN_Y,
  MINDMAP_SIBLING_GAP,
  layoutMindmap,
} from './mindmap-layout.js';
import { MINDMAP_GROW_ID, previewMindmapGrow, type PreviewMember } from './mindmap-preview.js';

const draft = { w: NODE_W, h: NODE_H };

function placed(
  nodes: { id: string; parentId: string | null; order: number; side?: 'left' | 'right' | null }[],
  levelExtra?: ReadonlyMap<string, number>,
): PreviewMember[] {
  const boxes = layoutMindmap({
    nodes: nodes.map((node) => ({
      id: node.id,
      parentId: node.parentId,
      order: node.order,
      side: node.side ?? null,
      w: NODE_W,
      h: NODE_H,
    })),
    folded: new Set(),
    direction: 'right',
    anchors: new Map([['root', { x: MINDMAP_ORIGIN_X, y: MINDMAP_ORIGIN_Y }]]),
    rootGap: 96,
    levelGap: MINDMAP_LEVEL_GAP,
    siblingGap: MINDMAP_SIBLING_GAP,
    originX: MINDMAP_ORIGIN_X,
    originY: MINDMAP_ORIGIN_Y,
    levelExtra,
  });
  return boxes.map((box) => {
    const node = nodes.find((item) => item.id === box.id);
    return {
      id: box.id,
      parentId: node?.parentId ?? null,
      order: node?.order ?? 0,
      side: node?.side ?? null,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
    };
  });
}

describe('previewMindmapGrow', () => {
  it('第一个子主题在父级右侧，父级不动', () => {
    const preview = previewMindmapGrow({
      members: placed([{ id: 'root', parentId: null, order: 0 }]),
      folded: new Set(),
      direction: 'right',
      role: 'child',
      nodeId: 'root',
      draft,
    });
    const root = preview?.boxes.find((box) => box.id === 'root');
    const child = preview?.boxes.find((box) => box.id === MINDMAP_GROW_ID);
    expect(root).toMatchObject({ x: MINDMAP_ORIGIN_X, y: MINDMAP_ORIGIN_Y });
    expect(child).toMatchObject({ x: MINDMAP_ORIGIN_X + NODE_W + MINDMAP_LEVEL_GAP, y: MINDMAP_ORIGIN_Y });
    expect(preview?.parentId).toBe('root');
    expect(preview?.reparentId).toBeNull();
  });

  it('父级已因联系加宽时，新子主题仍进这一列', () => {
    const extra = new Map([['root', 40]]);
    const members = placed(
      [
        { id: 'root', parentId: null, order: 0 },
        { id: 'child', parentId: 'root', order: 0 },
      ],
      extra,
    );
    const preview = previewMindmapGrow({
      members,
      folded: new Set(),
      direction: 'right',
      role: 'child',
      nodeId: 'root',
      draft,
      levelExtra: extra,
    });
    const existing = members.find((member) => member.id === 'child');
    const grown = preview?.boxes.find((box) => box.id === MINDMAP_GROW_ID);
    expect(grown?.x).toBe(existing?.x);
    expect(preview?.boxes.find((box) => box.id === 'root')?.x).toBe(MINDMAP_ORIGIN_X);
  });

  it('再加一个子主题时，父级下移，新点排在已有子级下面', () => {
    const members = placed([
      { id: 'root', parentId: null, order: 0 },
      { id: 'kid', parentId: 'root', order: 0 },
    ]);
    const preview = previewMindmapGrow({
      members,
      folded: new Set(),
      direction: 'right',
      role: 'child',
      nodeId: 'root',
      draft,
    });
    const root = preview?.boxes.find((box) => box.id === 'root');
    const kid = preview?.boxes.find((box) => box.id === 'kid');
    const child = preview?.boxes.find((box) => box.id === MINDMAP_GROW_ID);
    expect(root?.y).toBe(MINDMAP_ORIGIN_Y + (NODE_H + MINDMAP_SIBLING_GAP) / 2);
    expect(kid).toMatchObject({ x: MINDMAP_ORIGIN_X + NODE_W + MINDMAP_LEVEL_GAP, y: MINDMAP_ORIGIN_Y });
    expect(child).toMatchObject({
      x: MINDMAP_ORIGIN_X + NODE_W + MINDMAP_LEVEL_GAP,
      y: MINDMAP_ORIGIN_Y + NODE_H + MINDMAP_SIBLING_GAP,
    });
  });

  it('同级之前排在选中点上面，并接到同一个父级', () => {
    const members = placed([
      { id: 'root', parentId: null, order: 0 },
      { id: 'kid', parentId: 'root', order: 0 },
    ]);
    const preview = previewMindmapGrow({
      members,
      folded: new Set(),
      direction: 'right',
      role: 'before',
      nodeId: 'kid',
      draft,
    });
    const kid = preview?.boxes.find((box) => box.id === 'kid');
    const older = preview?.boxes.find((box) => box.id === MINDMAP_GROW_ID);
    expect(older?.y).toBeLessThan(kid?.y ?? 0);
    expect(older?.x).toBe(kid?.x);
    expect(preview?.parentId).toBe('root');
  });
});
