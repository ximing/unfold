const MAX_LATEX = 4000;
const CURRENCY = /^[\d,.\s]+$/;
const MATH_SIGNAL = /[\\^_=+*/<>{}[\]|]/;

export type MathSpan = {
  index: number;
  length: number;
  latex: string;
  display: boolean;
};

/** `$100` stays text. Compact TeX and signal-bearing expressions pass. */
export function isLikelyMath(latex: string): boolean {
  const trimmed = latex.trim();
  if (!trimmed || trimmed.length > MAX_LATEX) return false;
  if (CURRENCY.test(trimmed)) return false;
  if (!/\s/.test(trimmed)) return true;
  return MATH_SIGNAL.test(trimmed);
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function findMarker(text: string, from: number, marker: string): number {
  const at = text.indexOf(marker, from);
  if (at < 0 || at - from > MAX_LATEX) return -1;
  return at;
}

function findSingleDollar(text: string, from: number): number {
  for (let i = from; i < text.length && i - from <= MAX_LATEX; i += 1) {
    if (text[i] !== '$' || isEscaped(text, i)) continue;
    if (text[i - 1] === '$' || text[i + 1] === '$') continue;
    return i;
  }
  return -1;
}

/** `$...$`, `$$...$$`, `\(...\)`, `\[...\]` in a text node. */
export function findMathInText(text: string): MathSpan[] {
  const spans: MathSpan[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('$$', i) && !isEscaped(text, i)) {
      const close = findMarker(text, i + 2, '$$');
      if (close > i) {
        const latex = text.slice(i + 2, close).trim();
        if (latex && isLikelyMath(latex)) {
          spans.push({ index: i, length: close + 2 - i, latex, display: true });
          i = close + 2;
          continue;
        }
      }
    }
    if (text.startsWith('\\[', i)) {
      const close = findMarker(text, i + 2, '\\]');
      if (close > i) {
        const latex = text.slice(i + 2, close).trim();
        if (latex && isLikelyMath(latex)) {
          spans.push({ index: i, length: close + 2 - i, latex, display: true });
          i = close + 2;
          continue;
        }
      }
    }
    if (text.startsWith('\\(', i)) {
      const close = findMarker(text, i + 2, '\\)');
      if (close > i) {
        const inner = text.slice(i + 2, close);
        if (inner === inner.trim() && inner && !inner.includes('\n') && isLikelyMath(inner)) {
          spans.push({ index: i, length: close + 2 - i, latex: inner, display: false });
          i = close + 2;
          continue;
        }
      }
    }
    if (text[i] === '$' && !isEscaped(text, i) && text[i + 1] !== '$') {
      const close = findSingleDollar(text, i + 1);
      if (close > i) {
        const inner = text.slice(i + 1, close);
        if (inner === inner.trim() && inner && !inner.includes('\n') && isLikelyMath(inner)) {
          spans.push({ index: i, length: close + 1 - i, latex: inner, display: false });
          i = close + 1;
          continue;
        }
      }
    }
    i += 1;
  }
  return spans;
}
