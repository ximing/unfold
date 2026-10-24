import { describe, expect, it } from 'vitest';
import { documentToMarkdown, getBlockType, parsePaste } from '../src/index.js';
import type { PmNode } from '../src/types.js';

const theoremAttrs = {
  proposition: '可导则连续',
  condition: 'f 可导',
  proof: '略',
  corollary: '连续',
};

const theoremMarkdown = `命题: 可导则连续
条件: f 可导
证明: 略
推论: 连续`;

function attrsOf(node: PmNode | null | undefined): Record<string, unknown> | undefined {
  return node?.attrs;
}

describe('subject blocks', () => {
  it('round-trips a theorem pasted with full-width colons', () => {
    const theorem = getBlockType('theorem');
    const parsed = theorem?.parsePaste('命题：可导则连续\n条件：f 可导\n证明：略\n推论：连续');
    expect(attrsOf(parsed)).toEqual(theoremAttrs);
    expect(attrsOf(theorem?.parsePaste(theorem.toMarkdown(parsed!)))).toEqual(theoremAttrs);
    expect(theorem?.searchableText(parsed!)).toBe('可导则连续 f 可导 略 连续');
    const partial = theorem?.parsePaste('命题：可导则连续\n随便\n\n  证明：略');
    expect(attrsOf(partial)).toEqual({
      proposition: '可导则连续',
      condition: '',
      proof: '略',
      corollary: '',
    });
    expect(theorem?.toMarkdown(partial!)).toBe('命题: 可导则连续\n条件: \n证明: 略\n推论: ');
  });

  it('parses theorem markdown as the only block and keeps the proposition', () => {
    const doc = parsePaste('', theoremMarkdown);
    const block = doc.content.content?.[0];
    expect(block?.type).toBe('theorem');
    expect(block?.attrs?.proposition).toBe('可导则连续');
    expect(block?.attrs?.condition).toBe('f 可导');
    expect(block?.attrs?.proof).toBe('略');
    expect(block?.attrs?.corollary).toBe('连续');
    expect(documentToMarkdown(doc.content)).toContain('命题: 可导则连续');
    expect(documentToMarkdown(doc.content)).toBe(theoremMarkdown);

    const withHtml = parsePaste('<p>丢掉这段 html</p>', theoremMarkdown);
    expect(withHtml.content.content?.[0]?.type).toBe('theorem');
    expect(withHtml.content.content?.[0]?.attrs?.proposition).toBe('可导则连续');
  });

  it('round-trips an algorithm problem across four fields', () => {
    const spec = getBlockType('algo_problem');
    const parsed = spec?.parsePaste('题面：两数之和\n约束：n <= 100000\n样例：2 7 9\n复杂度：O(n)');
    const attrs = {
      statement: '两数之和',
      constraints: 'n <= 100000',
      examples: '2 7 9',
      complexity: 'O(n)',
    };
    expect(attrsOf(parsed)).toEqual(attrs);
    expect(attrsOf(spec?.parsePaste(spec.toMarkdown(parsed!)))).toEqual(attrs);
    const doc = parsePaste('', spec!.toMarkdown(parsed!));
    const block = doc.content.content?.[0];
    expect(block?.type).toBe('algo_problem');
    expect(block?.attrs?.statement).toBe('两数之和');
    expect(block?.attrs?.constraints).toBe('n <= 100000');
    expect(block?.attrs?.examples).toBe('2 7 9');
    expect(block?.attrs?.complexity).toBe('O(n)');
    expect(documentToMarkdown(doc.content)).toBe(spec!.toMarkdown(parsed!));
  });

  it('round-trips a language pattern across four fields', () => {
    const spec = getBlockType('lang_pattern');
    const parsed = spec?.parsePaste(
      '句型：the more the more\n例句：The more you read, the more you know.\n对照：as as\n易混点：more 后接形容词',
    );
    const attrs = {
      pattern: 'the more the more',
      example: 'The more you read, the more you know.',
      contrast: 'as as',
      confusion: 'more 后接形容词',
    };
    expect(attrsOf(parsed)).toEqual(attrs);
    expect(attrsOf(spec?.parsePaste(spec.toMarkdown(parsed!)))).toEqual(attrs);
    const doc = parsePaste('', spec!.toMarkdown(parsed!));
    const block = doc.content.content?.[0];
    expect(block?.type).toBe('lang_pattern');
    expect(block?.attrs?.pattern).toBe('the more the more');
    expect(block?.attrs?.example).toBe('The more you read, the more you know.');
    expect(block?.attrs?.contrast).toBe('as as');
    expect(block?.attrs?.confusion).toBe('more 后接形容词');
    expect(documentToMarkdown(doc.content)).toBe(spec!.toMarkdown(parsed!));
  });

  it('does not treat a plain paragraph as a subject block', () => {
    expect(getBlockType('algo_problem')?.parsePaste('普通段落')).toBeNull();
    expect(getBlockType('theorem')?.parsePaste('普通段落')).toBeNull();
    expect(getBlockType('lang_pattern')?.parsePaste('普通段落')).toBeNull();
  });
});
