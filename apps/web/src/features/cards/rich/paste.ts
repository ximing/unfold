import type { RichDoc, RichNode } from '@unfold/dto';

type ListKind = 'bullet' | 'ordered' | 'task';

type ListItem = {
  indent: number;
  kind: ListKind;
  checked: boolean;
  lines: string[];
};

function isFormula(latex: string): boolean {
  const trimmed = latex.trim();
  if (trimmed === '') return false;
  return !/^[\d,.\s]+$/.test(trimmed);
}

function parseInlines(source: string): { nodes: RichNode[]; matched: boolean } {
  const nodes: RichNode[] = [];
  let buffer = '';
  let matched = false;
  let i = 0;
  const pushText = () => {
    if (buffer === '') return;
    nodes.push({ type: 'text', text: buffer });
    buffer = '';
  };
  while (i < source.length) {
    if (source[i] === '\\' && source[i + 1] === '$') {
      buffer += '$';
      i += 2;
      continue;
    }
    if (source[i] === '$' && source[i + 1] !== '$') {
      const end = source.indexOf('$', i + 1);
      if (end > i + 1) {
        const latex = source.slice(i + 1, end);
        if (isFormula(latex)) {
          pushText();
          nodes.push({ type: 'inlineMath', attrs: { latex: latex.trim() } });
          matched = true;
          i = end + 1;
          continue;
        }
      }
    }
    buffer += source[i] ?? '';
    i += 1;
  }
  pushText();
  return { nodes, matched };
}

function paragraphFromLines(lines: string[]): { node: RichNode; matched: boolean } {
  const content: RichNode[] = [];
  let matched = false;
  lines.forEach((line, index) => {
    if (index > 0) content.push({ type: 'hardBreak' });
    const parsed = parseInlines(line);
    if (parsed.matched) matched = true;
    content.push(...parsed.nodes);
  });
  return { node: content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }, matched };
}

function parseListLine(line: string): ListItem | null {
  const match = /^([ \t]*)([-+*]|\d+[.)])[ \t]+(.*)$/.exec(line);
  if (!match?.[2]) return null;
  const indent = (match[1] ?? '').replace(/\t/g, '    ').length;
  const marker = match[2];
  const rest = match[3] ?? '';
  const task = /^\[([ xX])\][ \t]*(.*)$/.exec(rest);
  if (task && /^[-+*]$/.test(marker)) {
    return { indent, kind: 'task', checked: task[1]?.toLowerCase() === 'x', lines: [task[2] ?? ''] };
  }
  if (/^\d+[.)]$/.test(marker)) return { indent, kind: 'ordered', checked: false, lines: [rest] };
  return { indent, kind: 'bullet', checked: false, lines: [rest] };
}

function blocksFromItems(items: ListItem[], start: number, minIndent: number): { blocks: RichNode[]; next: number; matched: boolean } {
  const blocks: RichNode[] = [];
  let matched = false;
  let index = start;
  while (index < items.length && items[index]!.indent >= minIndent) {
    const indent = items[index]!.indent;
    const kind = items[index]!.kind;
    const children: RichNode[] = [];
    while (index < items.length && items[index]!.indent === indent && items[index]!.kind === kind) {
      const item = items[index]!;
      index += 1;
      const nested = blocksFromItems(items, index, indent + 1);
      index = nested.next;
      if (nested.matched) matched = true;
      const paragraph = paragraphFromLines(item.lines);
      if (paragraph.matched) matched = true;
      const child: RichNode = {
        type: kind === 'task' ? 'taskItem' : 'listItem',
        content: [paragraph.node, ...nested.blocks],
      };
      if (kind === 'task') child.attrs = { checked: item.checked };
      children.push(child);
    }
    blocks.push({
      type: kind === 'task' ? 'taskList' : kind === 'ordered' ? 'orderedList' : 'bulletList',
      content: children,
    });
    matched = true;
  }
  return { blocks, next: index, matched };
}

function isSeparator(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitRow(line: string): string[] {
  let text = line.trim();
  if (!text.includes('|')) return [];
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|')) text = text.slice(0, -1);
  return text.split('|').map((cell) => cell.trim());
}

function cell(text: string, header: boolean): { node: RichNode; matched: boolean } {
  const parsed = paragraphFromLines([text]);
  return { node: { type: header ? 'tableHeader' : 'tableCell', content: [parsed.node] }, matched: parsed.matched };
}

function isHr(line: string): boolean {
  return /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line);
}

function headingOf(line: string): { level: number; text: string } | null {
  const match = /^(#{1,6})[ \t]+(.+?)\s*$/.exec(line);
  if (!match?.[1] || !match[2]) return null;
  return { level: match[1].length, text: match[2].replace(/\s+#+$/, '') };
}

function quoteBody(line: string): string | null {
  const match = /^[ \t]*>[ \t]?(.*)$/.exec(line);
  return match ? (match[1] ?? '') : null;
}

function fence(line: string): { language: string } | null {
  const match = /^[ \t]{0,3}```[ \t]*([^`\s]*)[ \t]*$/.exec(line);
  if (!match) return null;
  return { language: (match[1] ?? '').slice(0, 40) };
}

function dollarLine(line: string): { mode: 'single' | 'open'; latex: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('$$')) return null;
  const body = trimmed.slice(2);
  if (body.trim() === '') return { mode: 'open', latex: '' };
  if (body.endsWith('$$')) return { mode: 'single', latex: body.slice(0, -2).trim() };
  return { mode: 'open', latex: body.trim() };
}

function soloMath(line: string): string | null {
  const match = /^\$(.+)\$$/.exec(line.trim());
  if (!match?.[1] || match[1].includes('$') || !isFormula(match[1])) return null;
  return match[1].trim();
}

function splitDollar(line: string): Array<{ type: 'text'; text: string } | { type: 'math'; latex: string }> {
  const parts: Array<{ type: 'text'; text: string } | { type: 'math'; latex: string }> = [];
  const re = /\$\$([^$]+?)\$\$/g;
  let last = 0;
  for (const match of line.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ type: 'text', text: line.slice(last, index) });
    const latex = (match[1] ?? '').trim();
    if (latex !== '') parts.push({ type: 'math', latex });
    last = index + match[0].length;
  }
  if (last < line.length) parts.push({ type: 'text', text: line.slice(last) });
  if (parts.length === 0) parts.push({ type: 'text', text: line });
  return parts;
}

function parseLines(lines: string[]): { blocks: RichNode[]; matched: boolean } {
  const blocks: RichNode[] = [];
  let matched = false;
  let index = 0;
  const paragraphLines: string[] = [];

  function flushParagraph() {
    if (paragraphLines.length === 0) return;
    const paragraph = paragraphFromLines(paragraphLines);
    paragraphLines.length = 0;
    if (paragraph.matched) matched = true;
    blocks.push(paragraph.node);
  }

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const openedFence = fence(line);
    if (openedFence) {
      flushParagraph();
      index += 1;
      const code: string[] = [];
      while (index < lines.length && !/^[ \t]{0,3}```[ \t]*$/.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      const node: RichNode = { type: 'codeBlock' };
      if (openedFence.language !== '') node.attrs = { language: openedFence.language };
      if (code.length > 0 && !(code.length === 1 && code[0] === '')) node.content = [{ type: 'text', text: code.join('\n') }];
      blocks.push(node);
      matched = true;
      continue;
    }

    const dollars = dollarLine(line);
    if (dollars) {
      flushParagraph();
      index += 1;
      let latex = dollars.latex;
      if (dollars.mode === 'open') {
        const chunk: string[] = latex === '' ? [] : [latex];
        while (index < lines.length) {
          const current = lines[index] ?? '';
          index += 1;
          const trimmed = current.trim();
          if (trimmed === '$$') break;
          if (trimmed.endsWith('$$')) {
            const piece = trimmed.slice(0, -2).trimEnd();
            if (piece !== '') chunk.push(piece);
            break;
          }
          chunk.push(current);
        }
        latex = chunk.join('\n').trim();
      }
      if (latex !== '') {
        blocks.push({ type: 'blockMath', attrs: { latex } });
        matched = true;
      }
      continue;
    }

    if (index + 1 < lines.length && splitRow(line).length > 0 && isSeparator(lines[index + 1] ?? '')) {
      flushParagraph();
      const header = splitRow(line).map((text) => cell(text, true));
      index += 2;
      const rows: RichNode[] = [{ type: 'tableRow', content: header.map((item) => item.node) }];
      if (header.some((item) => item.matched)) matched = true;
      while (index < lines.length && splitRow(lines[index] ?? '').length >= 1 && !isSeparator(lines[index] ?? '')) {
        const row = splitRow(lines[index] ?? '').map((text) => cell(text, false));
        if (row.some((item) => item.matched)) matched = true;
        rows.push({ type: 'tableRow', content: row.map((item) => item.node) });
        index += 1;
      }
      blocks.push({ type: 'table', content: rows });
      matched = true;
      continue;
    }

    const heading = headingOf(line);
    if (heading) {
      flushParagraph();
      const parsed = parseInlines(heading.text);
      const node: RichNode = { type: 'heading', attrs: { level: heading.level } };
      if (parsed.nodes.length > 0) node.content = parsed.nodes;
      blocks.push(node);
      matched = true;
      index += 1;
      continue;
    }

    if (isHr(line)) {
      flushParagraph();
      blocks.push({ type: 'horizontalRule' });
      matched = true;
      index += 1;
      continue;
    }

    if (quoteBody(line) !== null) {
      flushParagraph();
      const inner: string[] = [];
      while (index < lines.length) {
        const body = quoteBody(lines[index] ?? '');
        if (body === null) break;
        inner.push(body);
        index += 1;
      }
      const quoted = parseLines(inner);
      blocks.push({
        type: 'blockquote',
        content: quoted.blocks.length > 0 ? quoted.blocks : [{ type: 'paragraph' }],
      });
      matched = true;
      continue;
    }

    if (parseListLine(line)) {
      flushParagraph();
      const items: ListItem[] = [];
      while (index < lines.length) {
        const marker = parseListLine(lines[index] ?? '');
        if (marker) {
          items.push(marker);
          index += 1;
          continue;
        }
        if (items.length > 0 && /^[ \t]+\S/.test(lines[index] ?? '')) {
          items[items.length - 1]!.lines.push((lines[index] ?? '').trim());
          index += 1;
          continue;
        }
        break;
      }
      const lists = blocksFromItems(items, 0, 0);
      blocks.push(...lists.blocks);
      matched = true;
      continue;
    }

    const solo = soloMath(line);
    if (solo) {
      flushParagraph();
      blocks.push({ type: 'blockMath', attrs: { latex: solo } });
      matched = true;
      index += 1;
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      index += 1;
      continue;
    }

    const parts = splitDollar(line);
    if (parts.some((part) => part.type === 'math')) {
      flushParagraph();
      for (const part of parts) {
        if (part.type === 'math') {
          blocks.push({ type: 'blockMath', attrs: { latex: part.latex } });
          matched = true;
          continue;
        }
        if (part.text.trim() === '') continue;
        const paragraph = paragraphFromLines([part.text]);
        if (paragraph.matched) matched = true;
        blocks.push(paragraph.node);
      }
      index += 1;
      continue;
    }

    paragraphLines.push(line);
    index += 1;
  }
  flushParagraph();
  return { blocks, matched };
}

/** 把粘贴进来的 Markdown 转成文稿。普通文本返回 null，交给编辑器自己插入。 */
export function pasteMarkdown(source: string): RichDoc | null {
  const text = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, '');
  if (text.trim() === '') return null;
  const parsed = parseLines(text.split('\n'));
  if (!parsed.matched) return null;
  return { type: 'doc', content: parsed.blocks.length > 0 ? parsed.blocks : [{ type: 'paragraph' }] };
}
