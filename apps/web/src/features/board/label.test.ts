import { describe, expect, it } from 'vitest';
import { BRANCH_LABEL_PAD, branchLevelExtra, shortLabel, shownLabelWidth } from './label.js';

describe('shownLabelWidth', () => {
  it('汉字按字号，英文更窄，超长先截断', () => {
    expect(shownLabelWidth('前提')).toBe(22);
    expect(shownLabelWidth('ab')).toBeCloseTo(13.2);
    expect(shownLabelWidth('范德萨'.repeat(8))).toBe(shownLabelWidth(shortLabel('范德萨'.repeat(8))));
    expect([...shortLabel('范德萨'.repeat(8))]).toHaveLength(12);
  });
});

describe('branchLevelExtra', () => {
  const nodes = [
    { id: 'R', parentId: null },
    { id: 'A', parentId: 'R' },
    { id: 'B', parentId: 'R' },
    { id: 'C', parentId: null },
  ];

  it('父子两个方向都加宽，兄弟取最宽，跨叶子不加', () => {
    const extra = branchLevelExtra(nodes, [
      { fromId: 'R', toId: 'A', label: '前提' },
      { fromId: 'B', toId: 'R', label: '范德萨范德萨' },
      { fromId: 'A', toId: 'C', label: '前提' },
    ]);
    expect(extra.get('R')).toBe(6 * 11 + BRANCH_LABEL_PAD);
    expect(extra.has('A')).toBe(false);
    expect(extra.has('C')).toBe(false);
  });

  it('空标签不加', () => {
    expect(branchLevelExtra(nodes, [{ fromId: 'R', toId: 'A', label: '' }]).size).toBe(0);
  });
});
