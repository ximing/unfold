import type { RichDoc, RichNode } from '@unfold/dto';
import { normalizeColor, normalizeFontSize } from './palette.js';

type KeptMark = NonNullable<RichNode['marks']>[number];

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALIGN_NODES = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'blockquote',
  'codeBlock',
  'table',
  'tableRow',
]);

const MARKS = new Set(['bold', 'italic', 'strike', 'code', 'underline', 'subscript', 'superscript', 'link', 'textStyle']);

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function align(value: unknown): 'left' | 'center' | 'right' | undefined {
  return value === 'left' || value === 'center' || value === 'right' ? value : undefined;
}

function intIn(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return undefined;
  return value;
}

function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function marksOf(value: unknown): KeptMark[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const marks: KeptMark[] = [];
  for (const item of value) {
    const mark = record(item);
    const type = mark?.type;
    if (typeof type !== 'string' || !MARKS.has(type)) continue;
    if (type === 'link') {
      const href = clip(record(mark?.attrs)?.href, 2000).trim();
      if (href === '') continue;
      marks.push({ type: 'link', attrs: { href } });
      continue;
    }
    if (type === 'textStyle') {
      const attrs = record(mark?.attrs);
      const next: NonNullable<KeptMark['attrs']> = {};
      const color = normalizeColor(attrs?.color);
      const backgroundColor = normalizeColor(attrs?.backgroundColor);
      const fontSize = normalizeFontSize(attrs?.fontSize);
      if (color) next.color = color;
      if (fontSize) next.fontSize = fontSize;
      if (backgroundColor) next.backgroundColor = backgroundColor;
      if (Object.keys(next).length === 0) continue;
      marks.push({ type: 'textStyle', attrs: next });
      continue;
    }
    marks.push({ type });
  }
  return marks.length > 0 ? marks : undefined;
}

function inline(value: unknown): RichNode | null {
  const node = record(value);
  if (!node) return null;
  if (node.type === 'text') {
    if (typeof node.text !== 'string') return null;
    const marks = marksOf(node.marks);
    return marks ? { type: 'text', text: node.text, marks } : { type: 'text', text: node.text };
  }
  if (node.type === 'hardBreak') return { type: 'hardBreak' };
  if (node.type === 'inlineMath') {
    return { type: 'inlineMath', attrs: { latex: clip(record(node.attrs)?.latex, 8000) } };
  }
  if (node.type === 'image') return image(node);
  return null;
}

function blocksOf(value: unknown): RichNode[] {
  if (!Array.isArray(value)) return [];
  const blocks: RichNode[] = [];
  for (const item of value) {
    const node = block(item);
    if (node) blocks.push(node);
  }
  return blocks;
}

function inlinesOf(value: unknown): RichNode[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const content: RichNode[] = [];
  for (const item of value) {
    const node = record(item);
    if (!node) continue;
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'blockquote') {
      const nested = block(node);
      if (nested) content.push(nested);
      continue;
    }
    const child = inline(item) ?? block(item);
    if (child) content.push(child);
  }
  return content.length > 0 ? content : undefined;
}

function image(node: Record<string, unknown>): RichNode | null {
  const attrs = record(node.attrs);
  const src = typeof attrs?.src === 'string' ? attrs.src : '';
  if (!UUID.test(src)) return null;
  const next: NonNullable<RichNode['attrs']> = { src };
  const alt = clip(attrs?.alt, 200).trim();
  if (alt !== '') next.alt = alt;
  const width = attrs?.width;
  if (typeof width === 'number' && width >= 32 && width <= 1200) next.width = width;
  else if (width === null) next.width = null;
  return { type: 'image', attrs: next };
}

function block(value: unknown): RichNode | null {
  const node = record(value);
  if (!node || typeof node.type !== 'string') return null;
  const attrs = record(node.attrs) ?? undefined;
  if (node.type === 'uploading') return null;
  if (ALIGN_NODES.has(node.type) && node.type !== 'heading' && node.type !== 'codeBlock' && node.type !== 'taskItem') {
    const textAlign = align(attrs?.textAlign);
    const content = blocksOf(node.content);
    const next: RichNode = { type: node.type };
    if (textAlign) next.attrs = { textAlign };
    if (content.length > 0) next.content = content;
    else if (node.type === 'listItem') next.content = [{ type: 'paragraph' }];
    return next;
  }
  if (node.type === 'heading') {
    const level = intIn(attrs?.level, 1, 6) ?? 1;
    const next: RichNode = { type: 'heading', attrs: { level } };
    const textAlign = align(attrs?.textAlign);
    if (textAlign && next.attrs) next.attrs.textAlign = textAlign;
    const content = inlinesOf(node.content);
    if (content) next.content = content;
    return next;
  }
  if (node.type === 'codeBlock') {
    const next: RichNode = { type: 'codeBlock' };
    const language = clip(attrs?.language, 40).trim();
    const textAlign = align(attrs?.textAlign);
    const kept: NonNullable<RichNode['attrs']> = {};
    if (language !== '') kept.language = language;
    if (textAlign) kept.textAlign = textAlign;
    if (Object.keys(kept).length > 0) next.attrs = kept;
    const content = inlinesOf(node.content);
    if (content) next.content = content;
    return next;
  }
  if (node.type === 'taskItem') {
    const next: RichNode = { type: 'taskItem', attrs: { checked: attrs?.checked === true } };
    const textAlign = align(attrs?.textAlign);
    if (textAlign && next.attrs) next.attrs.textAlign = textAlign;
    const content = blocksOf(node.content);
    next.content = content.length > 0 ? content : [{ type: 'paragraph' }];
    return next;
  }
  if (node.type === 'horizontalRule' || node.type === 'hardBreak') return { type: node.type };
  if (node.type === 'image') return image(node);
  if (node.type === 'inlineMath' || node.type === 'blockMath') {
    return { type: node.type, attrs: { latex: clip(attrs?.latex, 8000) } };
  }
  if (node.type === 'mermaid') return { type: 'mermaid', attrs: { source: clip(attrs?.source, 20000) } };
  if (node.type === 'tableCell' || node.type === 'tableHeader') {
    const next: RichNode = { type: node.type };
    const kept: NonNullable<RichNode['attrs']> = {};
    const colspan = intIn(attrs?.colspan, 1, 20);
    const rowspan = intIn(attrs?.rowspan, 1, 20);
    const backgroundColor = normalizeColor(attrs?.backgroundColor);
    if (colspan && colspan !== 1) kept.colspan = colspan;
    if (rowspan && rowspan !== 1) kept.rowspan = rowspan;
    if (backgroundColor) kept.backgroundColor = backgroundColor;
    if (Object.keys(kept).length > 0) next.attrs = kept;
    const content = blocksOf(node.content);
    next.content = content.length > 0 ? content : [{ type: 'paragraph' }];
    return next;
  }
  if (node.type === 'text') return inline(node);
  return null;
}

export function sanitizeDoc(input: unknown): RichDoc {
  const root = record(input);
  const content = blocksOf(root?.content);
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
}

export function sameDoc(left: unknown, right: unknown): boolean {
  return JSON.stringify(sanitizeDoc(left)) === JSON.stringify(sanitizeDoc(right));
}
