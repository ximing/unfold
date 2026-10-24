import { getSchema } from '@tiptap/core';
import { generateJSON } from '@tiptap/html';
import { Node } from '@tiptap/pm/model';
import { looksLikeMarkdown, markdownToHtml } from '@unfold/markdown';
import { getBlockType } from './block-types.js';
import { prepareHtml } from './prepare-html.js';
import { BLOCK_ID_TYPES, getExtensions } from './schema.js';
import { SCHEMA_VERSION, type PmNode, type UnfoldDocument } from './types.js';

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  md: 'markdown',
  yml: 'yaml',
  sh: 'bash',
  shell: 'bash',
};

const extensions = getExtensions();
const schema = getSchema(extensions);
const blockTypes = new Set<string>(BLOCK_ID_TYPES);

export type ParsePasteOptions = {
  id?: () => string;
};

function randomId(): string {
  return crypto.randomUUID();
}

function plainToHtml(plain: string): string {
  return plain
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((part) => `<p>${escapeText(part).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function assignIds(node: PmNode, nextId: () => string): void {
  if (blockTypes.has(node.type)) {
    const current = node.attrs?.id;
    node.attrs = {
      ...node.attrs,
      id: typeof current === 'string' && current.length > 0 ? current : nextId(),
    };
  }
  for (const child of node.content ?? []) assignIds(child, nextId);
}

function canonicalLanguage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

function normalizeNodes(node: PmNode): void {
  if (node.type === 'codeBlock') {
    const language = canonicalLanguage(node.attrs?.language);
    if (language === 'mermaid' || language === 'mmd') {
      node.type = 'mermaid';
      node.attrs = { id: node.attrs?.id ?? null };
    } else {
      node.attrs = { ...node.attrs, language };
    }
  }
  for (const child of node.content ?? []) normalizeNodes(child);
}

function emptyDocument(nextId: () => string): PmNode {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', attrs: { id: nextId() } }],
  };
}

const SUBJECT_PASTE_TYPES = ['algo_problem', 'theorem', 'lang_pattern'] as const;

/**
 * Clipboard HTML + plain text → a validated document.
 * Plain text whose first line is 题面/命题/句型 wins over HTML and Markdown.
 * Otherwise Markdown wins only when the plain text has a block-level Markdown signal,
 * or when there is no rich HTML and the plain text still has inline Markdown.
 */
export function parsePaste(html: string, plainText: string, options: ParsePasteOptions = {}): UnfoldDocument {
  const nextId = options.id ?? randomId;
  const plain = plainText.replace(/\r\n/g, '\n');
  for (const name of SUBJECT_PASTE_TYPES) {
    const subject = getBlockType(name)?.parsePaste(plain);
    if (!subject) continue;
    const content: PmNode = { type: 'doc', content: [subject] };
    assignIds(content, nextId);
    const validated = Node.fromJSON(schema, content);
    return {
      schemaVersion: SCHEMA_VERSION,
      content: validated.toJSON() as PmNode,
    };
  }
  let sourceHtml = '';
  if (looksLikeMarkdown(plain, html)) sourceHtml = markdownToHtml(plain);
  else if (html.trim()) sourceHtml = prepareHtml(html);
  else if (plain.trim()) sourceHtml = prepareHtml(plainToHtml(plain));

  const content = sourceHtml.trim()
    ? (generateJSON(sourceHtml, extensions) as PmNode)
    : emptyDocument(nextId);
  if (!content.content || content.content.length === 0) {
    content.content = emptyDocument(nextId).content;
  }
  normalizeNodes(content);
  assignIds(content, nextId);
  const validated = Node.fromJSON(schema, content);
  return {
    schemaVersion: SCHEMA_VERSION,
    content: validated.toJSON() as PmNode,
  };
}
