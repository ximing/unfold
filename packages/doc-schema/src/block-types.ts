import { documentToMarkdown } from './to-markdown.js';
import type { PmNode } from './types.js';

export type BlockTypeSpec = {
  name: string;
  pmNode: string;
  renderHint: string;
  parsePaste: (text: string) => PmNode | null;
  toMarkdown: (node: PmNode) => string;
  searchableText: (node: PmNode) => string;
};

const COLONS = [':', '：'] as const;

function textParts(node: PmNode): string[] {
  const parts: string[] = [];
  const walk = (current: PmNode): void => {
    if (typeof current.text === 'string') parts.push(current.text);
    for (const child of current.content ?? []) walk(child);
  };
  walk(node);
  return parts;
}

/** Base-block search text: every text field, single-spaced. */
function spacedText(node: PmNode): string {
  return textParts(node).join(' ').trim();
}

/** Descendant text in document order, without extra separators. */
function plainText(node: PmNode): string {
  return textParts(node).join('');
}

function paragraph(text: string): PmNode {
  if (text.length === 0) return { type: 'paragraph' };
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function bodyAfterPrefix(text: string, label: string): string | null {
  const start = text.trimStart();
  for (const colon of COLONS) {
    const prefix = `${label}${colon}`;
    if (!start.startsWith(prefix)) continue;
    return start.slice(prefix.length).trim();
  }
  return null;
}

function contentLines(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function baseBlock(name: string, renderHint: string): BlockTypeSpec {
  return {
    name,
    pmNode: name,
    renderHint,
    parsePaste: () => null,
    toMarkdown: (node) => documentToMarkdown({ type: 'doc', content: [node] }),
    searchableText: spacedText,
  };
}

function simpleLearning(name: string, renderHint: string, label: string): BlockTypeSpec {
  return {
    name,
    pmNode: name,
    renderHint,
    parsePaste(text) {
      const body = bodyAfterPrefix(text, label);
      if (body === null) return null;
      return { type: name, content: [paragraph(body)] };
    },
    toMarkdown: (node) => `${label}: ${plainText(node)}`,
    searchableText: (node) => plainText(node).trim(),
  };
}

function multiLearning(
  name: string,
  renderHint: string,
  label: string,
  childType: string,
  attrs?: Record<string, unknown>,
): BlockTypeSpec {
  return {
    name,
    pmNode: name,
    renderHint,
    parsePaste(text) {
      const body = bodyAfterPrefix(text, label);
      if (body === null) return null;
      const node: PmNode = {
        type: name,
        content: contentLines(body).map((line) => ({
          type: childType,
          content: [paragraph(line)],
        })),
      };
      if (attrs) node.attrs = { ...attrs };
      return node;
    },
    toMarkdown: (node) =>
      (node.content ?? []).map((child) => `${label}: ${plainText(child)}`).join('\n'),
    searchableText: (node) => plainText(node).trim(),
  };
}

function attrText(node: PmNode, key: string): string {
  const value = node.attrs?.[key];
  return typeof value === 'string' ? value : '';
}

type SubjectField = {
  key: string;
  label: string;
};

const ALGO_FIELDS: readonly SubjectField[] = [
  { key: 'statement', label: '题面' },
  { key: 'constraints', label: '约束' },
  { key: 'examples', label: '样例' },
  { key: 'complexity', label: '复杂度' },
];

const THEOREM_FIELDS: readonly SubjectField[] = [
  { key: 'proposition', label: '命题' },
  { key: 'condition', label: '条件' },
  { key: 'proof', label: '证明' },
  { key: 'corollary', label: '推论' },
];

const LANG_FIELDS: readonly SubjectField[] = [
  { key: 'pattern', label: '句型' },
  { key: 'example', label: '例句' },
  { key: 'contrast', label: '对照' },
  { key: 'confusion', label: '易混点' },
];

const SUBJECT_FIELDS: Record<string, readonly SubjectField[]> = {
  algo_problem: ALGO_FIELDS,
  theorem: THEOREM_FIELDS,
  lang_pattern: LANG_FIELDS,
};

function parseSubjectFields(
  text: string,
  fields: readonly SubjectField[],
): Record<string, string> | null {
  const firstField = fields[0];
  if (!firstField) return null;
  const lines = text.trim().split(/\r?\n/);
  const firstLine = lines[0];
  if (firstLine === undefined) return null;
  const firstValue = bodyAfterPrefix(firstLine, firstField.label);
  if (firstValue === null) return null;
  const attrs: Record<string, string> = {};
  for (const field of fields) attrs[field.key] = '';
  attrs[firstField.key] = firstValue;
  for (const line of lines.slice(1)) {
    if (line.trim().length === 0) continue;
    for (const field of fields) {
      const value = bodyAfterPrefix(line, field.label);
      if (value === null) continue;
      attrs[field.key] = value;
      break;
    }
  }
  return attrs;
}

/** Four labeled lines. Half-width colon and one space; empty fields stay. */
export function subjectBlockToMarkdown(node: PmNode): string {
  const fields = SUBJECT_FIELDS[node.type];
  if (!fields) return '';
  return fields.map((field) => `${field.label}: ${attrText(node, field.key)}`).join('\n');
}

function subjectSearchText(node: PmNode, fields: readonly SubjectField[]): string {
  return fields
    .map((field) => attrText(node, field.key).trim())
    .filter((value) => value.length > 0)
    .join(' ');
}

function subjectBlock(name: string, renderHint: string, fields: readonly SubjectField[]): BlockTypeSpec {
  return {
    name,
    pmNode: name,
    renderHint,
    parsePaste(text) {
      const attrs = parseSubjectFields(text, fields);
      if (!attrs) return null;
      return { type: name, attrs };
    },
    toMarkdown: subjectBlockToMarkdown,
    searchableText: (node) => subjectSearchText(node, fields),
  };
}

function refBlock(
  name: string,
  renderHint: string,
  kind: 'object' | 'collection',
  idAttr: string,
): BlockTypeSpec {
  return {
    name,
    pmNode: name,
    renderHint,
    parsePaste: () => null,
    toMarkdown: (node) => `[[${kind}:${attrText(node, idAttr)}|${attrText(node, 'label')}]]`,
    searchableText: (node) => attrText(node, 'label'),
  };
}

export const BLOCK_TYPES: readonly BlockTypeSpec[] = [
  baseBlock('heading', '标题'),
  baseBlock('paragraph', '段落'),
  baseBlock('bulletList', '无序列表'),
  baseBlock('orderedList', '有序列表'),
  baseBlock('blockquote', '引用'),
  baseBlock('table', '表格'),
  baseBlock('codeBlock', '代码'),
  baseBlock('blockMath', '公式'),
  baseBlock('image', '图片'),
  baseBlock('horizontalRule', '分隔线'),
  baseBlock('mermaid', '图'),
  multiLearning('derivation_steps', '推导', '推导', 'derivation_step'),
  multiLearning('tiered_hints', '提示', '提示', 'hint_item', { collapsed: true }),
  simpleLearning('personal_note', '个人理解', '个人理解'),
  simpleLearning('question', '疑问', '疑问'),
  simpleLearning('counterexample', '反例', '反例'),
  simpleLearning('decision', '决定', '决定'),
  refBlock('object_ref', '点', 'object', 'objectId'),
  refBlock('collection_ref', '合集', 'collection', 'collectionId'),
  subjectBlock('algo_problem', '算法题', ALGO_FIELDS),
  subjectBlock('theorem', '定理', THEOREM_FIELDS),
  subjectBlock('lang_pattern', '句型', LANG_FIELDS),
];

const BLOCK_TYPES_BY_NAME = new Map(BLOCK_TYPES.map((spec) => [spec.name, spec]));

export function getBlockType(name: string): BlockTypeSpec | undefined {
  return BLOCK_TYPES_BY_NAME.get(name);
}
