import { describe, expect, it } from 'vitest';
import { defaultRichCodeLanguage, richCodeLanguageOptions } from './rich-languages.js';

describe('richCodeLanguageOptions', () => {
  it('新建代码块默认是 JavaScript', () => {
    const javascript = richCodeLanguageOptions('').find((option) => option.value === defaultRichCodeLanguage);
    expect(defaultRichCodeLanguage).toBe('javascript');
    expect(javascript?.label).toBe('JavaScript');
    expect(javascript?.keywords).toContain('js');
  });

  it('纯文本在前，不含 plaintext，未知语言留在列表里', () => {
    const options = richCodeLanguageOptions('nope');
    expect(options[0]).toEqual({ value: '', label: '纯文本' });
    expect(options[1]).toEqual({ value: 'nope', label: 'nope' });
    expect(options.some((option) => option.value === 'plaintext')).toBe(false);
  });

  it('plaintext 显示成纯文本', () => {
    expect(richCodeLanguageOptions('plaintext')[0]).toEqual({ value: '', label: '纯文本' });
    expect(richCodeLanguageOptions('plaintext').some((option) => option.value === 'plaintext')).toBe(false);
  });
});
