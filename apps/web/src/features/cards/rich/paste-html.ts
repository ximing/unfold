import { normalizeColor, normalizeFontSize } from './palette.js';

const FORMAT_TAG =
  /<(?:strong|b|em|i|u|s|del|strike|ins|sub|sup|h[1-6]|ul|ol|li|blockquote|pre|code|table|thead|tbody|tr|td|th|a|font|mark|hr|img)\b|data-(?:mermaid|type\s*=\s*["'](?:block-math|inline-math)["'])/i;

const FORMAT_DECL =
  /font-weight\s*:|font-style\s*:|text-decoration\s*:|font-size\s*:|text-align\s*:|background-color\s*:|(?<![\w-])color\s*:/i;

const FORMAT_STYLE = new RegExp(
  `style\\s*=\\s*(?:"[^"]*(?:${FORMAT_DECL.source})[^"]*"|'[^']*(?:${FORMAT_DECL.source})[^']*')`,
  'i',
);

const ATTR = (name: string) => new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');

/** HTML 里已经有编辑器认得出的格式时，不再用纯文本覆盖。 */
export function htmlHasFormatting(html: string): boolean {
  return FORMAT_TAG.test(html) || FORMAT_STYLE.test(html);
}

function attr(source: string, name: string): string {
  const match = ATTR(name).exec(source);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
}

const FONT_SIZE_ATTR: Record<string, string> = {
  '1': '12',
  '2': '13',
  '3': '16',
  '4': '18',
  '5': '24',
  '6': '32',
  '7': '36',
};

function fontOpen(attrs: string): string {
  const styles: string[] = [];
  const color = normalizeColor(attr(attrs, 'color'));
  const size = FONT_SIZE_ATTR[attr(attrs, 'size')];
  const existing = attr(attrs, 'style');
  if (color) styles.push(`color: ${color}`);
  if (size) styles.push(`font-size: ${size}px`);
  if (existing) styles.push(existing);
  if (styles.length === 0) return '<span>';
  return `<span style="${styles.join(';')}">`;
}

function cleanCss(css: string): string {
  return css.replace(/!important/gi, '').replace(/font-size\s*:\s*([^;"'}]+)/gi, (all, raw: string) => {
    const size = normalizeFontSize(raw);
    return size ? `font-size: ${size}px` : all;
  });
}

/** 把 Word、网页常用的 font 标签和 pt 字号收成编辑器能解析的行内样式。正文里的同样字样不动。 */
export function preparePastedHtml(html: string): string {
  const styled = html
    .replace(/style\s*=\s*"([^"]*)"/gi, (_all, css: string) => `style="${cleanCss(css)}"`)
    .replace(/style\s*=\s*'([^']*)'/gi, (_all, css: string) => `style='${cleanCss(css)}'`)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (block) => cleanCss(block));
  return styled.replace(/<font\b([^>]*)>/gi, (_all, attrs: string) => fontOpen(attrs)).replace(/<\/font>/gi, '</span>');
}
