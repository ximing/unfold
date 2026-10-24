import { describe, expect, it } from 'vitest';
import { BLOCK_TYPES, getBlockType } from '../src/index.js';
import { getExtensions } from '../src/schema.js';
import type { PmNode } from '../src/types.js';

const NAMES = [
  'heading',
  'paragraph',
  'bulletList',
  'orderedList',
  'blockquote',
  'table',
  'codeBlock',
  'blockMath',
  'image',
  'horizontalRule',
  'mermaid',
  'derivation_steps',
  'tiered_hints',
  'personal_note',
  'question',
  'counterexample',
  'decision',
  'object_ref',
  'collection_ref',
  'algo_problem',
  'theorem',
  'lang_pattern',
];

function textOf(node: PmNode | null | undefined): string {
  if (!node) return '';
  if (typeof node.text === 'string' && (node.content?.length ?? 0) === 0) return node.text;
  const own = typeof node.text === 'string' ? node.text : '';
  return own + (node.content ?? []).map((child) => textOf(child)).join('');
}

describe('BLOCK_TYPES', () => {
  it('registers exactly the base, learning, subject, and reference blocks', () => {
    expect(BLOCK_TYPES.map((spec) => spec.name).sort()).toEqual([...NAMES].sort());
    expect(new Set(BLOCK_TYPES.map((spec) => spec.name)).size).toBe(NAMES.length);
  });

  it('gives every block the three handlers and a render hint', () => {
    for (const spec of BLOCK_TYPES) {
      expect(typeof spec.parsePaste).toBe('function');
      expect(typeof spec.toMarkdown).toBe('function');
      expect(typeof spec.searchableText).toBe('function');
      expect(typeof spec.renderHint).toBe('string');
      expect(spec.renderHint.length).toBeGreaterThan(0);
      expect(spec.pmNode).toBe(spec.name);
    }
  });

  it('looks up a block type by name', () => {
    expect(getBlockType('question')?.name).toBe('question');
    expect(getBlockType('nope')).toBeUndefined();
  });

  it('exports reference blocks as wiki links and searches only the label', () => {
    const objectId = '11111111-1111-4111-8111-111111111111';
    const objectRef = getBlockType('object_ref');
    expect(
      objectRef?.toMarkdown({
        type: 'object_ref',
        attrs: { objectId, label: '状态等价' },
      }),
    ).toBe(`[[object:${objectId}|状态等价]]`);
    expect(
      objectRef?.searchableText({
        type: 'object_ref',
        attrs: { objectId, label: '状态等价' },
      }),
    ).toBe('状态等价');
    expect(objectRef?.toMarkdown({ type: 'object_ref', attrs: { objectId } })).toBe(
      `[[object:${objectId}|]]`,
    );

    const collectionId = '22222222-2222-4222-8222-222222222222';
    const collectionRef = getBlockType('collection_ref');
    expect(
      collectionRef?.toMarkdown({
        type: 'collection_ref',
        attrs: { collectionId, label: '线性代数' },
      }),
    ).toBe(`[[collection:${collectionId}|线性代数]]`);
    expect(
      collectionRef?.searchableText({
        type: 'collection_ref',
        attrs: { collectionId, label: '线性代数' },
      }),
    ).toBe('线性代数');
  });

  it('parses a question prefix and rejects other text', () => {
    const question = getBlockType('question');
    const parsed = question?.parsePaste('疑问: 为什么不能合并');
    expect(parsed?.type).toBe('question');
    expect(textOf(parsed)).toBe('为什么不能合并');
    expect(parsed).toEqual({
      type: 'question',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '为什么不能合并' }] },
      ],
    });
    expect(question?.parsePaste('你好')).toBeNull();
    expect(question?.toMarkdown(parsed!)).toBe('疑问: 为什么不能合并');
    expect(question?.parsePaste('疑问：为什么不能合并')).toEqual(parsed);
  });

  it('parses the other single-paragraph learning prefixes', () => {
    expect(getBlockType('personal_note')?.parsePaste('个人理解: 还没对齐')).toEqual({
      type: 'personal_note',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '还没对齐' }] }],
    });
    expect(getBlockType('counterexample')?.parsePaste('反例: 空集')).toEqual({
      type: 'counterexample',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '空集' }] }],
    });
    expect(getBlockType('decision')?.parsePaste('决定：先不做')).toEqual({
      type: 'decision',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '先不做' }] }],
    });
    expect(getBlockType('personal_note')?.toMarkdown({
      type: 'personal_note',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '还没对齐' }] }],
    })).toBe('个人理解: 还没对齐');
  });

  it('parses tiered hints collapsed, one item per non-empty line', () => {
    const hints = getBlockType('tiered_hints');
    const parsed = hints?.parsePaste('提示: 先想不变量');
    expect(parsed?.attrs?.collapsed).toBe(true);
    expect(parsed).toEqual({
      type: 'tiered_hints',
      attrs: { collapsed: true },
      content: [
        {
          type: 'hint_item',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '先想不变量' }] }],
        },
      ],
    });
    const lines = hints?.parsePaste('提示：一级\n\n二级');
    expect(hints?.toMarkdown(lines!)).toBe('提示: 一级\n提示: 二级');
    expect(hints?.searchableText(lines!)).toBe('一级二级');
  });

  it('parses derivation steps and prints one prefixed line each', () => {
    const steps = getBlockType('derivation_steps');
    const parsed = steps?.parsePaste('推导: 先展开\n再合并\n\n最后归纳');
    expect(parsed?.type).toBe('derivation_steps');
    expect(parsed?.content?.map((step) => textOf(step))).toEqual(['先展开', '再合并', '最后归纳']);
    expect(steps?.toMarkdown(parsed!)).toBe('推导: 先展开\n推导: 再合并\n推导: 最后归纳');
    expect(steps?.parsePaste('你好')).toBeNull();
  });

  it('keeps base blocks on the existing markdown path', () => {
    expect(getBlockType('heading')?.parsePaste('# 标题')).toBeNull();
    expect(
      getBlockType('heading')?.toMarkdown({
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: '标题' }],
      }),
    ).toBe('## 标题');
    expect(
      getBlockType('paragraph')?.searchableText({
        type: 'paragraph',
        content: [
          { type: 'text', text: '你好' },
          { type: 'text', text: '世界' },
        ],
      }),
    ).toBe('你好 世界');
    expect(getBlockType('horizontalRule')?.toMarkdown({ type: 'horizontalRule' })).toBe('---');
  });

  it('registers learning and reference nodes before block ids', () => {
    const names = getExtensions().map((extension) => extension.name);
    const blockIdAt = names.indexOf('blockId');
    for (const name of ['object_ref', 'derivation_steps', 'tiered_hints']) {
      expect(names).toContain(name);
      expect(names.indexOf(name)).toBeLessThan(blockIdAt);
    }
  });
});
