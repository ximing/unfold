import type { RichDoc, RichNode } from '@unfold/dto';

const inlineParents = new Set(['paragraph', 'heading', 'codeBlock']);

export const MAX_RICH_DOC_BYTES = 1024 * 1024;

export function richDocTooBig(doc: RichDoc): boolean {
  return Buffer.byteLength(JSON.stringify(doc), 'utf8') > MAX_RICH_DOC_BYTES;
}

/** 块与块之间一个换行。段落、标题、代码块内部直接拼接。 */
export function richPlain(doc: RichDoc): string {
  return render(doc);
}

export function richImageIds(doc: RichDoc): string[] {
  const ids: string[] = [];
  const walk = (node: RichNode): void => {
    if (node.type === 'image' && typeof node.attrs?.src === 'string') ids.push(node.attrs.src);
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return ids;
}

function render(node: RichNode): string {
  switch (node.type) {
    case 'text':
      return node.text ?? '';
    case 'image':
      return attrText(node, 'alt');
    case 'inlineMath':
    case 'blockMath':
      return attrText(node, 'latex');
    case 'mermaid':
      return attrText(node, 'source');
    default: {
      const parts = (node.content ?? []).map(render);
      return inlineParents.has(node.type) ? parts.join('') : parts.join('\n');
    }
  }
}

function attrText(node: RichNode, key: 'alt' | 'latex' | 'source'): string {
  const value = node.attrs?.[key];
  return typeof value === 'string' ? value : '';
}
