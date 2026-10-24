import { describe, expect, it } from 'vitest';
import { contrastMatrix, type ContrastRelation, type ContrastSide } from './contrast-matrix';

const left: ContrastSide = {
  canonicalName: '甲',
  coreStatement: '左端核心陈述',
};
const right: ContrastSide = {
  canonicalName: '乙',
  coreStatement: '右端核心陈述',
};
const contrasts: ContrastRelation = {
  type: 'contrasts',
  distinction: '两端的区别原文',
};

describe('contrastMatrix', () => {
  it('returns [] when the relation is analogous', () => {
    expect(contrastMatrix(left, right, { type: 'analogous', distinction: '类比不进矩阵' })).toEqual(
      [],
    );
  });

  it('builds core-statement and distinction rows from a contrasts relation', () => {
    expect(contrastMatrix(left, right, contrasts)).toEqual([
      { label: '核心陈述', left: '左端核心陈述', right: '右端核心陈述' },
      { label: '区别', left: '两端的区别原文', right: '两端的区别原文' },
    ]);
  });

  it('changes only the distinction row when distinction changes', () => {
    const next = contrastMatrix(left, right, { ...contrasts, distinction: '新的区别句子' });
    expect(next[0]).toEqual({ label: '核心陈述', left: '左端核心陈述', right: '右端核心陈述' });
    expect(next[1]).toEqual({ label: '区别', left: '新的区别句子', right: '新的区别句子' });
  });

  it('changes only the left cell of the core-statement row when left.coreStatement changes', () => {
    const next = contrastMatrix({ ...left, coreStatement: '改过的左端核心陈述' }, right, contrasts);
    expect(next[0]).toEqual({
      label: '核心陈述',
      left: '改过的左端核心陈述',
      right: '右端核心陈述',
    });
    expect(next[1]).toEqual({ label: '区别', left: '两端的区别原文', right: '两端的区别原文' });
  });
});
