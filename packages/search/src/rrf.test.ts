import { describe, expect, it } from 'vitest';
import { rrf } from './index.js';

describe('rrf', () => {
  it('fuses lists by reciprocal rank', () => {
    const result = rrf([
      ['a', 'b', 'c'],
      ['b', 'd', 'a'],
    ]);
    expect(result.map((row) => row.id)).toEqual(['b', 'a', 'd', 'c']);
    const score = Object.fromEntries(result.map((row) => [row.id, row.score]));
    expect(score.b).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(score.a).toBeCloseTo(1 / 61 + 1 / 63, 10);
    expect(score.d).toBeCloseTo(1 / 62, 10);
    expect(score.c).toBeCloseTo(1 / 63, 10);
  });

  it('orders equal scores by id', () => {
    expect(rrf([['a'], ['b']]).map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('keeps only the best rank when an id repeats in one list', () => {
    const result = rrf([['x', 'x', 'y']]);
    expect(result.map((row) => row.id)).toEqual(['x', 'y']);
    expect(result[0]?.score).toBeCloseTo(1 / 61, 10);
    expect(result[0]?.score).not.toBeCloseTo(1 / 61 + 1 / 62, 10);
  });

  it('returns nothing for empty lists', () => {
    expect(rrf([[], []])).toEqual([]);
  });

  it('rejects k below 1', () => {
    expect(() => rrf([['a']], 0)).toThrow(RangeError);
  });
});
