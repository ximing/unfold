import { describe, expect, it } from 'vitest';
import * as dto from './index.js';

describe('public exports', () => {
  it('does not export the retired name helper', () => {
    expect(dto).not.toHaveProperty(['normalize', 'Name'].join(''));
  });

  it('exports the graph and account contracts used by the product', () => {
    expect(dto.cardTypeSchema.parse('rich')).toBe('rich');
    expect(dto.cardTypeSchema.parse('note')).toBe('note');
    expect(dto.loginBodySchema.parse({ username: 'ab', password: 'secret-8' })).toEqual({
      username: 'ab',
      password: 'secret-8',
    });
    expect(dto.createCollectionBodySchema.parse({ title: ' 合集 ' }).title).toBe('合集');
  });
});
