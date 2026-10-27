import { LanguageDescription } from '@codemirror/language';
import { describe, expect, it } from 'vitest';
import { codeLanguageOptions, codeLanguageValue } from './code-language.js';

const unused = () => Promise.reject(new Error('unused'));

const sample = [
  LanguageDescription.of({ name: 'TypeScript', alias: ['ts'], load: unused }),
  LanguageDescription.of({ name: 'Python', extensions: ['py'], load: unused }),
];

describe('codeLanguageValue', () => {
  it('空语言是纯文本', () => {
    expect(codeLanguageValue('  ', sample)).toBe('');
  });

  it('别名对上语言名', () => {
    expect(codeLanguageValue('ts', sample)).toBe('TypeScript');
    expect(codeLanguageValue('  PYTHON ', sample)).toBe('Python');
  });

  it('认不出的名字原样留下', () => {
    expect(codeLanguageValue(' brainfuck ', sample)).toBe('brainfuck');
  });

  it('常见别名能对上 CodeMirror 自带的语言', () => {
    expect(codeLanguageValue('ts')).toBe('TypeScript');
    expect(codeLanguageValue('py')).toBe('Python');
    expect(codeLanguageValue('js')).toBe('JavaScript');
    expect(codeLanguageValue('')).toBe('');
  });
});

describe('codeLanguageOptions', () => {
  it('纯文本在前，未知语言紧随，其余按名字排', () => {
    expect(codeLanguageOptions('nope', sample)).toEqual([
      { value: '', label: '纯文本' },
      { value: 'nope', label: 'nope' },
      { value: 'Python', label: 'Python', keywords: 'python py' },
      { value: 'TypeScript', label: 'TypeScript', keywords: 'ts typescript' },
    ]);
  });

  it('已知语言不重复出现', () => {
    const values = codeLanguageOptions('ts', sample).map((option) => option.value);
    expect(values.filter((value) => value === 'TypeScript')).toEqual(['TypeScript']);
    expect(values[0]).toBe('');
  });
});
