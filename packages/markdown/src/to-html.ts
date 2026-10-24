import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

type MdNode = {
  type: string;
  value?: string;
  depth?: number;
  lang?: string | null;
  ordered?: boolean;
  url?: string;
  alt?: string;
  children?: MdNode[];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isSafeUrl(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url.trim());
}

function inline(nodes: MdNode[] | undefined): string {
  if (!nodes) return '';
  return nodes.map(renderInline).join('');
}

function renderInline(node: MdNode): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value ?? '');
    case 'strong':
      return `<strong>${inline(node.children)}</strong>`;
    case 'emphasis':
      return `<em>${inline(node.children)}</em>`;
    case 'delete':
      return `<del>${inline(node.children)}</del>`;
    case 'inlineCode':
      return `<code>${escapeHtml(node.value ?? '')}</code>`;
    case 'inlineMath':
      return `<span data-type="inline-math" data-latex="${escapeHtml(node.value ?? '')}"></span>`;
    case 'break':
      return '<br>';
    case 'link': {
      const href = node.url ?? '';
      const body = inline(node.children);
      if (!isSafeUrl(href)) return body;
      return `<a href="${escapeHtml(href)}">${body}</a>`;
    }
    case 'image': {
      const src = node.url ?? '';
      if (!isSafeUrl(src)) return escapeHtml(node.alt ?? '');
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(node.alt ?? '')}">`;
    }
    default:
      return inline(node.children);
  }
}

function renderBlock(node: MdNode): string {
  switch (node.type) {
    case 'heading': {
      const depth = Math.min(6, Math.max(1, node.depth ?? 1));
      return `<h${depth}>${inline(node.children)}</h${depth}>`;
    }
    case 'paragraph':
      return `<p>${inline(node.children)}</p>`;
    case 'blockquote':
      return `<blockquote>${blockList(node.children)}</blockquote>`;
    case 'thematicBreak':
      return '<hr>';
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul';
      const items = (node.children ?? [])
        .map((item) => `<li>${blockList(item.children)}</li>`)
        .join('');
      return `<${tag}>${items}</${tag}>`;
    }
    case 'code': {
      const lang = (node.lang ?? '').trim().toLowerCase();
      const code = escapeHtml(node.value ?? '').replace(/\n$/, '');
      if (lang === 'mermaid' || lang === 'mmd') {
        return `<pre data-type="mermaid">${code}</pre>`;
      }
      const klass = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      return `<pre><code${klass}>${code}</code></pre>`;
    }
    case 'math':
      return `<div data-type="block-math" data-latex="${escapeHtml(node.value ?? '')}"></div>`;
    case 'table':
      return renderTable(node);
    default:
      return blockList(node.children);
  }
}

function renderTable(node: MdNode): string {
  const rows = node.children ?? [];
  if (rows.length === 0) return '';
  const head = rows[0];
  const body = rows.slice(1);
  const header = `<thead>${renderRow(head, 'th')}</thead>`;
  const rest =
    body.length > 0 ? `<tbody>${body.map((row) => renderRow(row, 'td')).join('')}</tbody>` : '';
  return `<table>${header}${rest}</table>`;
}

function renderRow(row: MdNode | undefined, cell: 'td' | 'th'): string {
  const cells = (row?.children ?? [])
    .map((item) => `<${cell}>${inline(item.children)}</${cell}>`)
    .join('');
  return `<tr>${cells}</tr>`;
}

function blockList(nodes: MdNode[] | undefined): string {
  if (!nodes) return '';
  return nodes.map(renderBlock).join('');
}

export function markdownToHtml(markdown: string): string {
  const tree = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(markdown) as MdNode;
  return blockList(tree.children);
}
