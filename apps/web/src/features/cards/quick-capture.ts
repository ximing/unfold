import { generateJSON } from '@tiptap/core';
import type { RichDoc, RichNode } from '@unfold/dto';
import { createRichExtensions } from './rich/extensions.js';
import { htmlHasFormatting, preparePastedHtml } from './rich/paste-html.js';
import { markdownFromClipboard } from './rich/paste-insert.js';
import { sanitizeDoc } from './rich/sanitize.js';
import { altFrom, uploadCardImage } from './rich/upload.js';

function clipText(data: DataTransfer, type: string): string {
  try {
    return data.getData(type);
  } catch {
    return '';
  }
}

/** 默认用编辑器同一套扩展把 HTML 解析成文稿 JSON；需要 DOM，浏览器里才有。 */
function parseWithEditor(html: string): unknown {
  return generateJSON(html, createRichExtensions());
}

/**
 * 带格式的 HTML 清洗后落成文稿；解析失败或得到空文档时返回 null。
 * toJson 可注入，测试里不必起真实 DOM。
 */
export function docFromHtml(html: string, toJson: (html: string) => unknown = parseWithEditor): RichDoc | null {
  try {
    const json = toJson(preparePastedHtml(html));
    const content = json && typeof json === 'object' ? (json as { content?: unknown }).content : undefined;
    if (!Array.isArray(content) || content.length === 0) return null;
    return sanitizeDoc(json);
  } catch {
    return null;
  }
}

/** 纯文本按空行分段、段内换行保留，落成段落文稿。 */
function docFromPlainText(text: string): RichDoc | null {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks: RichNode[] = [];
  for (const chunk of normalized.split(/\n{2,}/)) {
    const lines = chunk.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) continue;
    const content: RichNode[] = [];
    lines.forEach((line, index) => {
      if (index > 0) content.push({ type: 'hardBreak' });
      content.push({ type: 'text', text: line });
    });
    blocks.push({ type: 'paragraph', content });
  }
  return blocks.length > 0 ? { type: 'doc', content: blocks } : null;
}

/** 剪贴板里的文字内容（带格式 HTML / Markdown / 纯文本）落成富文本文稿；没有可用内容返回 null。 */
export function docFromClipboardData(data: DataTransfer): RichDoc | null {
  if (htmlHasFormatting(clipText(data, 'text/html'))) return docFromHtml(clipText(data, 'text/html'));
  const markdown = markdownFromClipboard(data);
  if (markdown) return markdown;
  return docFromPlainText(clipText(data, 'text/plain'));
}

/** 把图片文件上传到指定卡片，返回由 image 节点组成的文稿；全部失败时 doc 为 null，error 是首条失败原因。 */
export async function docWithImages(
  cardId: string,
  files: File[],
): Promise<{ doc: RichDoc | null; error: string }> {
  const content: RichNode[] = [];
  let error = '';
  for (const file of files) {
    try {
      const src = await uploadCardImage(cardId, file);
      const alt = altFrom(file.name);
      content.push({ type: 'image', attrs: alt ? { src, alt } : { src } });
    } catch (cause) {
      if (error === '') error = cause instanceof Error && cause.message !== '' ? cause.message : '图片没有放进去';
    }
  }
  return { doc: content.length > 0 ? { type: 'doc', content } : null, error };
}
