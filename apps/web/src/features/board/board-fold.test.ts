import { describe, expect, it } from 'vitest';
import { branchFold, foldSide, linksForFold, toggleFold } from './board-fold.js';

const tree = [
  { id: 'a', parentId: null, layoutSide: null },
  { id: 'b', parentId: 'a', layoutSide: 'left' as const },
  { id: 'c', parentId: 'b', layoutSide: null },
  { id: 'd', parentId: 'a', layoutSide: 'right' as const },
];

const links = [
  { id: 'e1', fromId: 'c', toId: 'd', label: '到兄弟' },
  { id: 'e2', fromId: 'c', toId: 'b', label: '到父' },
  { id: 'e3', fromId: 'a', toId: 'c', label: '到孙' },
  { id: 'e4', fromId: 'c', toId: 'z', label: '到外面' },
  { id: 'e5', fromId: 'b', toId: 'd', label: '父到兄弟' },
];

describe('toggleFold', () => {
  it('不在集合里就加入，已在就移除', () => {
    const once = toggleFold(new Set<string>(), 'b');
    expect(once).toEqual(['b']);
    expect(toggleFold(new Set(once), 'b')).toEqual([]);
  });

  it('只切换选中的点', () => {
    expect(toggleFold(new Set(['a']), 'b')).toEqual(['a', 'b']);
    expect(toggleFold(new Set(['a', 'b']), 'b')).toEqual(['a']);
  });
});

describe('branchFold', () => {
  it('未折叠时收起自己和全部后代，不动旁支', () => {
    expect(branchFold(new Set(['d']), 'b', tree)).toEqual(['d', 'b', 'c']);
  });

  it('已折叠时展开自己和全部后代', () => {
    expect(branchFold(new Set(['b', 'c', 'd']), 'b', tree)).toEqual(['d']);
  });

  it('从根收起再展开会清空这条上的折叠', () => {
    const collapsed = branchFold(new Set<string>(), 'a', tree);
    expect(collapsed).toEqual(['a', 'b', 'd', 'c']);
    expect(branchFold(new Set(collapsed), 'a', tree)).toEqual([]);
  });
});

describe('linksForFold', () => {
  it('没有折叠时端点不变', () => {
    expect(linksForFold(links, new Set<string>(), tree)).toEqual(links);
  });

  it('被折进祖先的一端改接到最近的可见祖先', () => {
    expect(linksForFold(links, new Set(['b']), tree)).toEqual([
      { id: 'e1', fromId: 'b', toId: 'd', label: '到兄弟' },
      { id: 'e3', fromId: 'a', toId: 'b', label: '到孙' },
      { id: 'e4', fromId: 'b', toId: 'z', label: '到外面' },
      { id: 'e5', fromId: 'b', toId: 'd', label: '父到兄弟' },
    ]);
  });

  it('两端落到同一个可见点则不画', () => {
    const collapsed = linksForFold(links, new Set(['a']), tree);
    expect(collapsed.map((link) => link.id)).toEqual(['e4']);
    expect(collapsed[0]).toEqual({ id: 'e4', fromId: 'a', toId: 'z', label: '到外面' });
  });
});

describe('foldSide', () => {
  it('向右在右，向左在左', () => {
    expect(foldSide('right', 'c', tree)).toBe('right');
    expect(foldSide('left', 'c', tree)).toBe('left');
  });

  it('两侧看自己或最近的 layoutSide，根在右', () => {
    expect(foldSide('both', 'a', tree)).toBe('right');
    expect(foldSide('both', 'b', tree)).toBe('left');
    expect(foldSide('both', 'c', tree)).toBe('left');
    expect(foldSide('both', 'd', tree)).toBe('right');
  });
});
