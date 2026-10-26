import { describe, expect, it } from 'vitest';
import { isPlainDelete } from './delete-key.js';

const plain = {
  key: 'Backspace',
  repeat: false,
  isComposing: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
};

describe('isPlainDelete', () => {
  it('认 Backspace 和 Delete', () => {
    expect(isPlainDelete(plain)).toBe(true);
    expect(isPlainDelete({ ...plain, key: 'Delete' })).toBe(true);
  });

  it('忽略重复、输入法、修饰键和其他键', () => {
    expect(isPlainDelete({ ...plain, repeat: true })).toBe(false);
    expect(isPlainDelete({ ...plain, isComposing: true })).toBe(false);
    expect(isPlainDelete({ ...plain, metaKey: true })).toBe(false);
    expect(isPlainDelete({ ...plain, ctrlKey: true })).toBe(false);
    expect(isPlainDelete({ ...plain, altKey: true })).toBe(false);
    expect(isPlainDelete({ ...plain, key: 'Enter' })).toBe(false);
  });
});
