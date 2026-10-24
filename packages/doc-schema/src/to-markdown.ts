import type { PmMark, PmNode } from './types.js';

function marksAround(text: string, marks: PmMark[] | undefined): string {
  let out = text;
  for (const mark of marks ?? []) {
    if (mark.type === 'bold') out = `**${out}**`;
    else if (mark.type === 'italic') out = `*${out}*`;
    else if (mark.type === 'code') out = `\`${out}\``;
    else if (mark.type === 'strike') out = `~~${out}~~`;
  }
  return out;
}

function inline(nodes: PmNode[] | undefined): string {
  if (!nodes) return '';
  return nodes
    .map((node) => {
      if (node.type === 'text') return marksAround(node.text ?? '', node.marks);
      if (node.type === 'hardBreak') return '\n';
      if (node.type === 'inlineMath') {
        const latex = typeof node.attrs?.latex === 'string' ? node.attrs.latex : '';
        return `$${latex}$`;
      }
      return inline(node.content);
    })
    .join('');
}

function cellText(node: PmNode): string {
  return inline(node.content).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function table(node: PmNode): string {
  const rows = node.content ?? [];
  if (rows.length === 0) return '';
  const render = (row: PmNode) => `| ${(row.content ?? []).map(cellText).join(' | ')} |`;
  const width = rows[0]?.content?.length ?? 0;
  const divider = `| ${Array.from({ length: width }, () => '---').join(' | ')} |`;
  return [render(rows[0]!), divider, ...rows.slice(1).map(render)].join('\n');
}

function block(node: PmNode): string {
  switch (node.type) {
    case 'heading': {
      const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1;
      return `${'#'.repeat(level)} ${inline(node.content)}`;
    }
    case 'paragraph':
      return inline(node.content);
    case 'blockquote':
      return (node.content ?? [])
        .map(block)
        .join('\n\n')
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    case 'codeBlock': {
      const language = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
      return `\`\`\`${language}\n${inline(node.content)}\n\`\`\``;
    }
    case 'mermaid':
      return `\`\`\`mermaid\n${inline(node.content)}\n\`\`\``;
    case 'blockMath': {
      const latex = typeof node.attrs?.latex === 'string' ? node.attrs.latex : '';
      return `$$\n${latex}\n$$`;
    }
    case 'bulletList':
      return (node.content ?? []).map((item) => `- ${inline(item.content)}`).join('\n');
    case 'orderedList':
      return (node.content ?? [])
        .map((item, index) => `${index + 1}. ${inline(item.content)}`)
        .join('\n');
    case 'table':
      return table(node);
    case 'horizontalRule':
      return '---';
    default:
      return (node.content ?? []).map(block).filter(Boolean).join('\n\n');
  }
}

/** Lossy Markdown for export and round-trip checks. The JSON document stays authoritative. */
export function documentToMarkdown(content: PmNode): string {
  return (content.content ?? [])
    .map(block)
    .filter((part) => part.length > 0)
    .join('\n\n');
}
