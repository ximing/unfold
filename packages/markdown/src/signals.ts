/**
 * PRD 5.2：纯文本出现标题、围栏、GFM 表或 $$ 时，按 Markdown 解析。
 * 富 HTML 存在时，单独的加粗不算「明显是 Markdown」，避免盖掉表格和代码。
 */

const BLOCK_SIGNALS: RegExp[] = [
  /^[ \t]{0,3}#{1,6}[ \t]+\S/m,
  /^[ \t]{0,3}(?:```|~~~)/m,
  /^[ \t]{0,3}\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/m,
  /^[ \t]*\$\$/m,
  /^[ \t]*\\\[/m,
];

const INLINE_SIGNALS: RegExp[] = [
  /\*\*\S(?:[^*\n]|\*(?!\*))*\*\*/,
  /(?<!\*)\*(?!\s|\*)([^*\n]+?)\*(?!\*)/,
  /`[^`\n]+`/,
  /\[[^\]\n]{1,500}\]\([^)\s]{1,2000}\)/,
  /\$[^\s$][^$\n]{0,400}\$[^\d]/,
];

const RICH_TAG =
  /<\s*\/?\s*(?:a|b|blockquote|code|h[1-6]|li|ol|pre|strong|table|td|th|tr|ul)\b/i;

export function htmlClipboardIsRich(html: string): boolean {
  return RICH_TAG.test(html);
}

export function looksLikeMarkdown(plain: string, html = ''): boolean {
  const source = plain.replace(/\r\n/g, '\n');
  if (!source.trim()) return false;
  if (BLOCK_SIGNALS.some((pattern) => pattern.test(source))) return true;
  if (htmlClipboardIsRich(html)) return false;
  return INLINE_SIGNALS.some((pattern) => pattern.test(source));
}
