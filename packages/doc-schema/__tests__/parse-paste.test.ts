import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { documentToMarkdown, parsePaste, type PmNode } from '../src/index.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../fixtures');
const chatgptHtml = readFileSync(join(fixtures, 'chatgpt-state.html'), 'utf8');
const derivationMd = readFileSync(join(fixtures, 'derivation.md'), 'utf8');

const JS_SOURCE = `function memo(i, w) {
  if (i < 0) return 0;
  return Math.max(memo(i - 1, w), memo(i - 1, w - wt[i]) + val[i]);
}`;

function walk(node: PmNode, visit: (node: PmNode) => void): void {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

function nodesOf(doc: PmNode, type: string): PmNode[] {
  const found: PmNode[] = [];
  walk(doc, (node) => {
    if (node.type === type) found.push(node);
  });
  return found;
}

function textOf(node: PmNode): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(textOf).join('');
}

function idsOf(doc: PmNode): string[] {
  const ids: string[] = [];
  walk(doc, (node) => {
    const id = node.attrs?.id;
    if (typeof id === 'string') ids.push(id);
  });
  return ids;
}

describe('parsePaste HTML fixture', () => {
  const parsed = parsePaste(chatgptHtml, '这段纯文本没有标题、围栏或表格。', {
    id: sequence(),
  });

  it('keeps a 2 by 3 table', () => {
    const tables = nodesOf(parsed.content, 'table');
    expect(tables).toHaveLength(1);
    const rows = tables[0]?.content ?? [];
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => (row.content ?? []).map(textOf))).toEqual([
      ['历史', '未来', '是否等价'],
      ['选了 A', '剩余容量', '是'],
    ]);
  });

  it('keeps the javascript block, including indentation and decoded angle brackets', () => {
    const code = nodesOf(parsed.content, 'codeBlock');
    expect(code).toHaveLength(1);
    expect(code[0]?.attrs?.language).toBe('javascript');
    expect(textOf(code[0]!)).toBe(JS_SOURCE);
  });

  it('keeps inline and display tex', () => {
    expect(nodesOf(parsed.content, 'inlineMath').map((node) => node.attrs?.latex)).toEqual(['E=mc^2']);
    expect(nodesOf(parsed.content, 'blockMath').map((node) => node.attrs?.latex)).toEqual([
      '\\int_0^1 x\\,dx',
    ]);
  });

  it('keeps the heading level and drops active content', () => {
    const headings = nodesOf(parsed.content, 'heading');
    expect(headings.map((node) => [node.attrs?.level, textOf(node)])).toEqual([
      [2, '从决策树到状态'],
    ]);
    const encoded = JSON.stringify(parsed);
    expect(encoded).not.toContain('alert');
    expect(encoded).not.toContain('onclick');
    expect(encoded).not.toContain('<script');
    expect(textOf(parsed.content)).toContain('个人思考：等价不是字符串相同。');
  });

  it('stores mermaid source on a mermaid block', () => {
    const diagrams = nodesOf(parsed.content, 'mermaid');
    expect(diagrams).toHaveLength(1);
    expect(textOf(diagrams[0]!)).toBe('flowchart LR\n  A-->B');
  });

  it('assigns stable unique block ids', () => {
    const ids = idsOf(parsed.content);
    expect(ids.length).toBeGreaterThan(3);
    expect(new Set(ids).size).toBe(ids.length);
    expect(nodesOf(parsed.content, 'codeBlock')[0]?.attrs?.id).toBeTruthy();
  });
});

describe('parsePaste markdown round trip', () => {
  it('prefers markdown when the plain text has a fence, and preserves tex', () => {
    const first = parsePaste('<p>丢掉这段 html</p><script>alert(1)</script>', derivationMd, {
      id: sequence(),
    });
    expect(textOf(first.content)).not.toContain('丢掉这段 html');
    expect(JSON.stringify(first)).not.toContain('alert');
    const exported = documentToMarkdown(first.content);
    const second = parsePaste('', exported, { id: sequence() });
    expect(nodesOf(second.content, 'inlineMath').map((node) => node.attrs?.latex)).toEqual(['E=mc^2']);
    expect(nodesOf(second.content, 'blockMath').map((node) => node.attrs?.latex)).toEqual([
      '\\int_0^1 x\\,dx',
    ]);
    expect(nodesOf(second.content, 'codeBlock').map((node) => [node.attrs?.language, textOf(node)])).toEqual([
      ['javascript', 'const n = 1;'],
    ]);
    expect(nodesOf(second.content, 'heading').map((node) => textOf(node))).toEqual(['状态等价']);
  });
});

function sequence(): () => string {
  let n = 0;
  return () => `b${++n}`;
}
