import { parseHTML } from 'linkedom';
import { findMathInText, isLikelyMath } from './math-text.js';

const DROP_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'form',
  'svg',
]);

function languageFromClass(className: string): string | null {
  const match = /(?:^|\s)(?:language|lang)-([\w#+.-]+)/i.exec(className);
  return match?.[1]?.toLowerCase() ?? null;
}

function replaceKatex(document: Document): void {
  const widgets = Array.from(document.querySelectorAll('.katex-display, .katex'));
  for (const widget of widgets) {
    if (!widget.isConnected) continue;
    if (widget.classList.contains('katex') && widget.closest('.katex-display')) continue;
    const annotation = widget.querySelector('annotation[encoding="application/x-tex"]');
    const latex = annotation?.textContent?.trim() ?? '';
    if (!latex) continue;
    const display = widget.classList.contains('katex-display');
    const node = document.createElement(display ? 'div' : 'span');
    node.setAttribute('data-type', display ? 'block-math' : 'inline-math');
    node.setAttribute('data-latex', latex);
    widget.replaceWith(node);
  }
}

function flattenCode(document: Document): void {
  for (const code of Array.from(document.querySelectorAll('pre code'))) {
    const pre = code.parentElement;
    const fromClass = languageFromClass(code.getAttribute('class') ?? '');
    const fromPre = pre?.getAttribute('data-language')?.trim().toLowerCase() || null;
    const language = fromClass ?? fromPre;
    code.textContent = code.textContent ?? '';
    if (language) code.setAttribute('class', `language-${language}`);
  }
}

function joinSplitDisplayMath(document: Document): void {
  const openers = Array.from(document.querySelectorAll('p')).filter(
    (node) => node.textContent?.trim() === '$$',
  );
  for (const opener of openers) {
    if (!opener.isConnected) continue;
    const parts: Element[] = [];
    let cursor = opener.nextElementSibling;
    let closer: Element | null = null;
    while (cursor) {
      if (cursor.tagName === 'P' && cursor.textContent?.trim() === '$$') {
        closer = cursor;
        break;
      }
      parts.push(cursor);
      cursor = cursor.nextElementSibling;
    }
    if (!closer) continue;
    const latex = parts
      .map((part) => part.textContent ?? '')
      .join('\n')
      .trim();
    if (!isLikelyMath(latex)) continue;
    const node = document.createElement('div');
    node.setAttribute('data-type', 'block-math');
    node.setAttribute('data-latex', latex);
    opener.replaceWith(node);
    for (const part of parts) part.remove();
    closer.remove();
  }
}

function insideSkip(node: Node): boolean {
  let current = node.parentNode;
  while (current && current.nodeType === 1) {
    const element = current as Element;
    const tag = element.tagName.toLowerCase();
    if (tag === 'pre' || tag === 'code') return true;
    const dataType = element.getAttribute('data-type');
    if (dataType === 'inline-math' || dataType === 'block-math') return true;
    current = current.parentNode;
  }
  return false;
}

function rewriteMathText(document: Document): void {
  const walker = document.createTreeWalker(document.body, 4);
  const texts: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    texts.push(current as Text);
    current = walker.nextNode();
  }
  for (const textNode of texts) {
    if (!textNode.isConnected || insideSkip(textNode)) continue;
    const text = textNode.data;
    const spans = findMathInText(text);
    if (spans.length === 0) continue;
    const parent = textNode.parentNode;
    if (!parent) continue;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const span of spans) {
      if (span.index > cursor) fragment.append(text.slice(cursor, span.index));
      const element = document.createElement(span.display ? 'div' : 'span');
      element.setAttribute('data-type', span.display ? 'block-math' : 'inline-math');
      element.setAttribute('data-latex', span.latex);
      fragment.append(element);
      cursor = span.index + span.length;
    }
    if (cursor < text.length) fragment.append(text.slice(cursor));
    parent.replaceChild(fragment, textNode);
  }
}

function stripUnsafe(document: Document): void {
  for (const element of Array.from(document.body.querySelectorAll('*'))) {
    const tag = element.tagName.toLowerCase();
    if (DROP_TAGS.has(tag)) {
      element.remove();
      continue;
    }
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith('on') || name === 'style') element.removeAttribute(attr.name);
      if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(value)) {
        element.removeAttribute(attr.name);
      }
    }
  }
}

/** Make clipboard HTML safe and turn TeX into math nodes before ProseMirror sees it. */
export function prepareHtml(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  stripUnsafe(document);
  replaceKatex(document);
  flattenCode(document);
  joinSplitDisplayMath(document);
  rewriteMathText(document);
  return document.body.innerHTML;
}
