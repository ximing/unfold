import { BLOCK_ID_TYPES, getBlockType, type PmNode } from '@unfold/doc-schema';
import { randomUUID } from 'node:crypto';

const ALLOWED_NODE_TYPES: ReadonlySet<string> = new Set([
  'doc',
  'text',
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'bulletList',
  'orderedList',
  'listItem',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'image',
  'horizontalRule',
  'blockMath',
  'inlineMath',
  'mermaid',
  'hardBreak',
  'derivation_steps',
  'derivation_step',
  'tiered_hints',
  'hint_item',
  'personal_note',
  'question',
  'counterexample',
  'decision',
  'object_ref',
  'collection_ref',
]);

const ALLOWED_MARK_TYPES: ReadonlySet<string> = new Set(['bold', 'italic', 'strike', 'code', 'link']);

const BLOCK_ID_TYPE_SET: ReadonlySet<string> = new Set(BLOCK_ID_TYPES);

export function documentNodesAllowed(content: PmNode): boolean {
  if (!ALLOWED_NODE_TYPES.has(content.type)) return false;
  if (content.marks !== undefined) {
    if (!Array.isArray(content.marks)) return false;
    for (const mark of content.marks) {
      if (!mark || typeof mark !== 'object' || typeof mark.type !== 'string') return false;
      if (!ALLOWED_MARK_TYPES.has(mark.type)) return false;
    }
  }
  if (content.content !== undefined) {
    if (!Array.isArray(content.content)) return false;
    for (const child of content.content) {
      if (!child || typeof child !== 'object' || typeof child.type !== 'string') return false;
      if (!documentNodesAllowed(child)) return false;
    }
  }
  return true;
}

function cloneNode(node: PmNode): PmNode {
  const copy: PmNode = { type: node.type };
  if (typeof node.text === 'string') copy.text = node.text;
  if (node.attrs) copy.attrs = structuredClone(node.attrs);
  if (node.marks) {
    copy.marks = node.marks.map((mark) =>
      mark.attrs ? { type: mark.type, attrs: structuredClone(mark.attrs) } : { type: mark.type },
    );
  }
  if (node.content) copy.content = node.content.map((child) => cloneNode(child));
  return copy;
}

function freshId(used: ReadonlySet<string>): string {
  let id = randomUUID();
  while (used.has(id)) id = randomUUID();
  return id;
}

export function assignBlockIds(content: PmNode, keep: ReadonlySet<string>): PmNode {
  const copy = cloneNode(content);
  const used = new Set<string>();
  const visit = (node: PmNode): void => {
    if (BLOCK_ID_TYPE_SET.has(node.type)) {
      const current = node.attrs?.id;
      const reusable =
        typeof current === 'string' && current.length > 0 && keep.has(current) && !used.has(current);
      const id = reusable ? current : freshId(used);
      used.add(id);
      node.attrs = { ...node.attrs, id };
    }
    if (!node.content) return;
    for (const child of node.content) visit(child);
  };
  visit(copy);
  return copy;
}

export type BlockIndexRow = {
  blockId: string;
  parentBlockId: string | null;
  position: number;
  blockType: string;
  textPreview: string;
};

function attrString(node: PmNode, key: string): string {
  const value = node.attrs?.[key];
  return typeof value === 'string' ? value : '';
}

function textPreviewOf(node: PmNode): string {
  if (node.type === 'object_ref') return attrString(node, 'objectId');
  if (node.type === 'collection_ref') return attrString(node, 'collectionId');
  return (getBlockType(node.type)?.searchableText(node) ?? '').slice(0, 200);
}

function blockIdOf(node: PmNode): string | null {
  if (!BLOCK_ID_TYPE_SET.has(node.type)) return null;
  const id = node.attrs?.id;
  if (typeof id !== 'string' || id.length === 0) return null;
  return id;
}

export function collectBlockIndex(content: PmNode): BlockIndexRow[] {
  const rows: BlockIndexRow[] = [];
  const visit = (node: PmNode, parentBlockId: string | null, position: number): void => {
    const blockId = blockIdOf(node);
    if (blockId) {
      rows.push({
        blockId,
        parentBlockId,
        position,
        blockType: node.type,
        textPreview: textPreviewOf(node),
      });
    }
    if (!node.content) return;
    const nextParent = blockId ?? parentBlockId;
    for (let index = 0; index < node.content.length; index += 1) {
      const child = node.content[index];
      if (child) visit(child, nextParent, index);
    }
  };
  visit(content, null, 0);
  return rows;
}
