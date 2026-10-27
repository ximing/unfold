import { describe, expect, it } from 'vitest';
import { filterSelectOptions } from './select-filter.js';

const options = [
  { value: '', label: '纯文本' },
  { value: 'javascript', label: 'JavaScript', keywords: 'javascript js jsx' },
  { value: 'python', label: 'Python', keywords: 'python py' },
  { value: 'cobol', label: 'Cobol', keywords: 'cobol copybook' },
];

describe('filterSelectOptions', () => {
  it('空查询返回全部', () => {
    expect(filterSelectOptions(options, '  ')).toEqual(options);
  });

  it('按名称、值和别名匹配，忽略大小写', () => {
    expect(filterSelectOptions(options, 'JAVA').map((option) => option.value)).toEqual(['javascript']);
    expect(filterSelectOptions(options, 'py').map((option) => option.value)).toEqual(['python']);
    expect(filterSelectOptions(options, 'js').map((option) => option.value)).toEqual(['javascript']);
    expect(filterSelectOptions(options, 'jsx').map((option) => option.value)).toEqual(['javascript']);
  });

  it('没有匹配时为空', () => {
    expect(filterSelectOptions(options, 'brainfuck')).toEqual([]);
  });
});
