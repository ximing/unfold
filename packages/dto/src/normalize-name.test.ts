import { describe, expect, it } from 'vitest';
import { normalizeName } from './index.js';

describe('normalizeName', () => {
  it('maps an ideographic space to a single space after NFKC', () => {
    expect(normalizeName('  状态\u3000等价  ')).toBe('状态 等价');
  });

  it('lowercases a plain name', () => {
    expect(normalizeName('Memoization')).toBe('memoization');
  });

  it('folds tabs and newlines into single spaces', () => {
    expect(normalizeName('A\tB\nC')).toBe('a b c');
  });
});
