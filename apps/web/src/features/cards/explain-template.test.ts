import type { RichDoc, RichNode } from '@unfold/dto';
import { describe, expect, it } from 'vitest';
import { explainTemplateDoc } from './explain-template.js';

function texts(doc: RichDoc): string[] {
  const found: string[] = [];
  const walk = (node: RichNode | RichDoc) => {
    if ('text' in node && typeof node.text === 'string') found.push(node.text);
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return found;
}

describe('explain templates', () => {
  it('概念解释含自己的解释和边界与不适用', () => {
    const lines = texts(explainTemplateDoc('concept'));
    expect(lines).toContain('自己的解释');
    expect(lines).toContain('边界与不适用');
  });

  it('出处把原文摘录和自己的说明分成两个标题', () => {
    const lines = texts(explainTemplateDoc('source'));
    expect(lines).toContain('原文摘录');
    expect(lines).toContain('自己的说明');
    expect(lines.filter((line) => line === '原文摘录' || line === '自己的说明')).toEqual(['原文摘录', '自己的说明']);
    expect(lines.some((line) => line.includes('原文摘录') && line.includes('自己的说明'))).toBe(false);
  });
});
