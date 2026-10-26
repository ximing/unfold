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

type InlineMark = { type: 'bold' | 'italic' | 'strike' | 'code' } | { type: 'link'; attrs: { href: string } };

type InlineNode =
  | { t: 'text'; s: string }
  | { t: 'code'; s: string }
  | { t: 'math'; latex: string }
  | { t: 'link'; href: string; kids: InlineNode[] }
  | { t: 'mark'; marks: InlineMark[]; kids: InlineNode[] }
  | { t: 'd'; ch: '*' | '_' | '~'; n: number; open: boolean; close: boolean };

const ESCAPES = new Set(['\\', '`', '*', '_', '{', '}', '[', ']', '(', ')', '#', '+', '-', '.', '!', '~', '$', '|']);

function isPunct(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{P}\p{S}]/u.test(ch);
}

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || /\s/u.test(ch);
}

function flank(source: string, start: number, end: number, marker: '*' | '_' | '~'): { open: boolean; close: boolean } {
  const before = source[start - 1];
  const after = source[end];
  const beforeSpace = isSpace(before);
  const afterSpace = isSpace(after);
  const beforePunct = isPunct(before);
  const afterPunct = isPunct(after);
  const left = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
  const right = !beforeSpace && (!beforePunct || afterSpace || afterPunct);
  if (marker === '_') return { open: left && (!right || beforePunct), close: right && (!left || afterPunct) };
  return { open: left, close: right };
}

function readCodeSpan(source: string, i: number): { text: string; next: number } | null {
  let width = 0;
  while (source[i + width] === '`') width += 1;
  if (width === 0) return null;
  let j = i + width;
  while (j < source.length) {
    if (source[j] !== '`') {
      j += 1;
      continue;
    }
    let close = 0;
    while (source[j + close] === '`') close += 1;
    if (close === width) {
      let text = source.slice(i + width, j).replace(/\n/g, ' ');
      if (text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '') text = text.slice(1, -1);
      if (text === '') return null;
      return { text, next: j + close };
    }
    j += close;
  }
  return null;
}

function hrefOf(raw: string): string {
  const trimmed = raw.trim();
  const titled = /^(\S+)\s+["'][^"']*["']$/.exec(trimmed);
  return (titled?.[1] ?? trimmed).slice(0, 2000);
}

function safeHref(href: string): string | null {
  const value = href.trim();
  if (value === '' || value.length > 2000) return null;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const ch = value[i];
    if (code <= 32 || ch === '<' || ch === '>') return null;
  }
  if (/^(javascript|data|vbscript):/i.test(value)) return null;
  return value;
}

function readLink(source: string, i: number): { label: string; href: string; next: number } | null {
  if (source[i] !== '[') return null;
  let j = i + 1;
  let label = '';
  while (j < source.length) {
    if (source[j] === '\\' && j + 1 < source.length) {
      label += source[j + 1] ?? '';
      j += 2;
      continue;
    }
    if (source[j] === '[') return null;
    if (source[j] === ']') break;
    label += source[j] ?? '';
    j += 1;
  }
  if (source[j] !== ']' || source[j + 1] !== '(') return null;
  j += 2;
  let href = '';
  let depth = 0;
  while (j < source.length) {
    const ch = source[j] ?? '';
    if (ch === '\\' && j + 1 < source.length) {
      href += source[j + 1] ?? '';
      j += 2;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      if (depth === 0) break;
      depth -= 1;
    }
    href += ch;
    j += 1;
  }
  if (source[j] !== ')') return null;
  const url = hrefOf(href);
  if (url === '') return null;
  return { label, href: url, next: j + 1 };
}

function scanInlines(source: string, allowLinks: boolean): InlineNode[] {
  const nodes: InlineNode[] = [];
  let text = '';
  let i = 0;
  const flush = () => {
    if (text === '') return;
    nodes.push({ t: 'text', s: text });
    text = '';
  };
  while (i < source.length) {
    const ch = source[i] ?? '';
    if (ch === '\\' && i + 1 < source.length && ESCAPES.has(source[i + 1] ?? '')) {
      text += source[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (ch === '`') {
      const code = readCodeSpan(source, i);
      if (code) {
        flush();
        nodes.push({ t: 'code', s: code.text });
        i = code.next;
        continue;
      }
    }
    if (ch === '!' && source[i + 1] === '[') {
      const image = readLink(source, i + 1);
      const href = image ? safeHref(image.href) : null;
      if (image && href) {
        flush();
        const kids = scanInlines(image.label, false);
        nodes.push({ t: 'link', href, kids: kids.length > 0 ? kids : [{ t: 'text', s: href }] });
        i = image.next;
        continue;
      }
    }
    if (allowLinks && ch === '[') {
      const link = readLink(source, i);
      const href = link ? safeHref(link.href) : null;
      if (link && href) {
        flush();
        const kids = scanInlines(link.label, false);
        nodes.push({ t: 'link', href, kids: kids.length > 0 ? kids : [{ t: 'text', s: href }] });
        i = link.next;
        continue;
      }
    }
    if (ch === '<' && allowLinks) {
      const auto = /^<((?:https?:\/\/|mailto:)[^>\s]+)>/.exec(source.slice(i));
      const href = auto?.[1] ? safeHref(auto[1]) : null;
      if (auto && href) {
        flush();
        nodes.push({ t: 'link', href, kids: [{ t: 'text', s: href }] });
        i += auto[0].length;
        continue;
      }
    }
    if (ch === '$' && source[i + 1] !== '$') {
      const end = source.indexOf('$', i + 1);
      if (end > i + 1) {
        const latex = source.slice(i + 1, end);
        if (!latex.includes('\n') && isFormula(latex)) {
          flush();
          nodes.push({ t: 'math', latex: latex.trim() });
          i = end + 1;
          continue;
        }
      }
    }
    if (ch === '*' || ch === '_' || ch === '~') {
      let end = i + 1;
      while (source[end] === ch) end += 1;
      const run = end - i;
      const flags = flank(source, i, end, ch);
      if (ch === '~') {
        const pairs = Math.floor(run / 2);
        if (run % 2 === 1) text += '~';
        if (pairs > 0 && (flags.open || flags.close)) {
          flush();
          nodes.push({ t: 'd', ch, n: pairs * 2, open: flags.open, close: flags.close });
        } else text += '~'.repeat(pairs * 2);
      } else if (flags.open || flags.close) {
        flush();
        nodes.push({ t: 'd', ch, n: run, open: flags.open, close: flags.close });
      } else text += ch.repeat(run);
      i = end;
      continue;
    }
    text += ch;
    i += 1;
  }
  flush();
  return nodes;
}

function emphasisForbidden(open: InlineNode & { t: 'd' }, close: InlineNode & { t: 'd' }): boolean {
  if (!(open.close || close.open)) return false;
  if ((open.n + close.n) % 3 !== 0) return false;
  return open.n % 3 !== 0 && close.n % 3 !== 0;
}

function emphasisUsed(open: InlineNode & { t: 'd' }, close: InlineNode & { t: 'd' }): number {
  if (open.ch === '~') return open.n >= 2 && close.n >= 2 ? 2 : 0;
  if (emphasisForbidden(open, close)) return 0;
  if (open.n >= 3 && close.n >= 3) return 3;
  if (open.n >= 2 && close.n >= 2) return 2;
  if (open.n >= 1 && close.n >= 1) return 1;
  return 0;
}

function emphasisMarks(ch: '*' | '_' | '~', used: number): InlineMark[] {
  if (ch === '~') return [{ type: 'strike' }];
  const marks: InlineMark[] = [];
  if (used >= 2) marks.push({ type: 'bold' });
  if (used % 2 === 1) marks.push({ type: 'italic' });
  return marks;
}

function resolveEmphasis(nodes: InlineNode[]): InlineNode[] {
  let current = nodes;
  for (;;) {
    const next = matchOne(current);
    if (!next) {
      return current.map((node) => (node.t === 'link' ? { ...node, kids: resolveEmphasis(node.kids) } : node));
    }
    current = next;
  }
}

function matchOne(nodes: InlineNode[]): InlineNode[] | null {
  const openers: number[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (!node || node.t !== 'd') continue;
    if (node.close) {
      for (let j = openers.length - 1; j >= 0; j -= 1) {
        const at = openers[j]!;
        const open = nodes[at];
        if (!open || open.t !== 'd' || open.ch !== node.ch || !open.open) continue;
        const used = emphasisUsed(open, node);
        if (used === 0) continue;
        const wrapped: InlineNode = {
          t: 'mark',
          marks: emphasisMarks(open.ch, used),
          kids: resolveEmphasis(nodes.slice(at + 1, i)),
        };
        const next: InlineNode[] = nodes.slice(0, at);
        if (open.n - used > 0) next.push({ ...open, n: open.n - used });
        next.push(wrapped);
        if (node.n - used > 0) next.push({ ...node, n: node.n - used });
        next.push(...nodes.slice(i + 1));
        return next;
      }
    }
    if (node.open) openers.push(i);
  }
  return null;
}

function sameMarks(left: InlineMark[], right: InlineMark[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function renderInlines(nodes: InlineNode[], extra: InlineMark[] = []): RichNode[] {
  const out: RichNode[] = [];
  let buffer = '';
  let bufferMarks: InlineMark[] = extra;
  const flush = () => {
    if (buffer === '') return;
    const node: RichNode = { type: 'text', text: buffer };
    if (bufferMarks.length > 0) node.marks = bufferMarks;
    out.push(node);
    buffer = '';
  };
  for (const node of nodes) {
    if (node.t === 'text' || node.t === 'd') {
      const piece = node.t === 'text' ? node.s : node.ch.repeat(node.n);
      if (buffer !== '' && !sameMarks(bufferMarks, extra)) flush();
      bufferMarks = extra;
      buffer += piece;
      continue;
    }
    flush();
    if (node.t === 'code') {
      out.push({ type: 'text', text: node.s, marks: [...extra, { type: 'code' }] });
      continue;
    }
    if (node.t === 'math') {
      out.push({ type: 'inlineMath', attrs: { latex: node.latex } });
      continue;
    }
    if (node.t === 'link') {
      out.push(...renderInlines(node.kids, [...extra, { type: 'link', attrs: { href: node.href } }]));
      continue;
    }
    out.push(...renderInlines(node.kids, [...extra, ...node.marks]));
  }
  flush();
  return out;
}

function inlineText(nodes: RichNode[]): string {
  return nodes.map((node) => (node.type === 'text' ? (node.text ?? '') : '')).join('');
}

function inlineFormatted(nodes: RichNode[]): boolean {
  return nodes.some((node) => node.type !== 'text' || (node.marks?.length ?? 0) > 0);
}

function parseInlines(source: string): { nodes: RichNode[]; matched: boolean } {
  const nodes = renderInlines(resolveEmphasis(scanInlines(source, true)));
  const matched = inlineFormatted(nodes) || inlineText(nodes) !== source;
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
      const text = code.join('\n');
      if (openedFence.language.toLowerCase() === 'mermaid') {
        blocks.push({ type: 'mermaid', attrs: { source: text.slice(0, 20000) } });
      } else {
        const node: RichNode = { type: 'codeBlock' };
        if (openedFence.language !== '') node.attrs = { language: openedFence.language };
        if (code.length > 0 && !(code.length === 1 && code[0] === '')) node.content = [{ type: 'text', text }];
        blocks.push(node);
      }
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

/** 把粘贴进来的 Markdown 转成文稿。普通文本返回 null，交给编辑器自己插入。认得出的记号转成节点，其余文字留下。 */
export function pasteMarkdown(source: string): RichDoc | null {
  const text = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, '');
  if (text.trim() === '') return null;
  const parsed = parseLines(text.split('\n'));
  if (!parsed.matched) return null;
  return { type: 'doc', content: parsed.blocks.length > 0 ? parsed.blocks : [{ type: 'paragraph' }] };
}
