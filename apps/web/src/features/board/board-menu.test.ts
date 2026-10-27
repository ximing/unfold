import { describe, expect, it } from 'vitest';
import { boardMenu, inclusionMenu, type BoardMenuTarget } from './board-menu.js';

function target(patch: Partial<BoardMenuTarget> & Pick<BoardMenuTarget, 'kind'>): BoardMenuTarget {
  return {
    tools: false,
    canCreate: false,
    canImage: false,
    canRename: false,
    canOpen: false,
    canGrow: false,
    canConnect: false,
    canRemove: false,
    canDeleteItem: false,
    canRelabel: false,
    canDeleteLink: false,
    canInsert: false,
    ...patch,
  };
}

function labels(patch: Partial<BoardMenuTarget> & Pick<BoardMenuTarget, 'kind'>): string[] {
  return boardMenu(target(patch))
    .filter((item) => item.separator !== true)
    .map((item) => item.label);
}

describe('boardMenu', () => {
  it('合集空白是添加文字和图片', () => {
    expect(labels({ kind: 'canvas', tools: true, canCreate: true, canImage: true })).toEqual([
      '添加文字点',
      '添加图片',
    ]);
  });

  it('全貌空白只新建合集', () => {
    expect(labels({ kind: 'canvas', canCreate: true, canImage: true })).toEqual(['新建合集']);
  });

  it('合集空白可以插入子集合', () => {
    expect(
      labels({ kind: 'canvas', tools: true, canCreate: true, canImage: true, canInsert: true }),
    ).toEqual(['添加文字点', '添加图片', '插入子集合']);
  });

  it('收起的子集合可以展开或移出', () => {
    const items = inclusionMenu(true);
    expect(items.map((item) => (item.separator ? '|' : item.label))).toEqual(['展开', '|', '移出这个合集']);
    expect(items.find((item) => item.action === 'remove-inclusion')).toMatchObject({ danger: true });
  });

  it('展开的子集合可以收起或移出', () => {
    expect(inclusionMenu(false).map((item) => item.label)).toEqual(['收起', '', '移出这个合集']);
  });

  it('合集的点有改名、生长、连线和删除', () => {
    const items = boardMenu(
      target({
        kind: 'node',
        tools: true,
        canRename: true,
        canGrow: true,
        canConnect: true,
        canRemove: true,
        canDeleteItem: true,
      }),
    );
    expect(items.map((item) => item.label)).toEqual([
      '改名',
      '建下级',
      '建同级',
      '从这里连线',
      '',
      '移出这个合集',
      '删除这个点',
    ]);
    expect(items.find((item) => item.label === '删除这个点')).toMatchObject({ danger: true, hint: 'Delete' });
    expect(items.some((item) => item.separator === true)).toBe(true);
  });

  it('全貌的合集是打开和删除，删除没有 Delete 提示', () => {
    const items = boardMenu(target({ kind: 'node', canOpen: true, canDeleteItem: true }));
    expect(items.map((item) => (item.separator ? '|' : item.label))).toEqual(['打开', '|', '删除合集']);
    expect(items.find((item) => item.action === 'delete-item')?.hint).toBeUndefined();
  });

  it('合集的边是改标签和删除', () => {
    expect(labels({ kind: 'edge', canRelabel: true, canDeleteLink: true })).toEqual(['改标签', '删除关系']);
  });

  it('全貌的边只删除', () => {
    expect(labels({ kind: 'edge', canDeleteLink: true })).toEqual(['删除关系']);
  });
});
