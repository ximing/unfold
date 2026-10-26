import type { Editor, JSONContent } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import type { RichDoc } from '@unfold/dto';
import { htmlHasFormatting } from './paste-html.js';
import { pasteMarkdown } from './paste.js';

function placeCursor(tr: Transaction, pos: number) {
  const safe = Math.max(1, Math.min(pos, tr.doc.content.size));
  tr.setSelection(TextSelection.near(tr.doc.resolve(safe)));
}

/** 行内内容嵌进当前段落或标题。块级内容从光标处拆开，不盖住两边已有的字。插不进去时返回 false。 */
export function insertPasted(editor: Editor, doc: RichDoc): boolean {
  const blocks = (doc.content ?? []) as JSONContent[];
  const only = blocks.length === 1 ? blocks[0] : undefined;
  const inText = editor.isActive('paragraph') || editor.isActive('heading');
  try {
    if (only?.type === 'paragraph' && inText) {
      const content = (only.content ?? []) as JSONContent[];
      if (content.length === 0) return true;
      return editor.chain().focus().insertContent(content).run();
    }
    return editor
      .chain()
      .focus()
      .command(({ tr, state, dispatch }) => {
        const nodes = blocks.map((block) => state.schema.nodeFromJSON(block));
        const fragment = Fragment.from(nodes);
        const { from, to } = tr.selection;
        if (from !== to) tr.delete(from, to);
        const pos = tr.mapping.map(from);
        const $pos = tr.doc.resolve(pos);
        const parent = $pos.parent;
        let cursor = pos;
        if (parent.isTextblock && !parent.type.spec.code) {
          if (parent.content.size === 0) {
            const start = $pos.before();
            tr.replaceWith(start, $pos.after(), fragment);
            cursor = start + fragment.size;
          } else if ($pos.parentOffset === 0) {
            const at = $pos.before();
            tr.insert(at, fragment);
            cursor = at + fragment.size;
          } else if ($pos.parentOffset === parent.content.size) {
            const at = $pos.after();
            tr.insert(at, fragment);
            cursor = at + fragment.size;
          } else {
            tr.split($pos.pos);
            const mapped = tr.mapping.map($pos.pos);
            const at = tr.doc.resolve(mapped).before();
            tr.insert(at, fragment);
            cursor = at + fragment.size;
          }
        } else {
          const steps = tr.steps.length;
          tr.replaceRange(pos, pos, new Slice(fragment, 0, 0));
          if (tr.steps.length === steps) return false;
          cursor = pos + fragment.size;
        }
        placeCursor(tr, cursor);
        if (dispatch) dispatch(tr);
        return true;
      })
      .run();
  } catch {
    return false;
  }
}

function clipText(data: DataTransfer, type: string): string {
  try {
    return data.getData(type);
  } catch {
    return '';
  }
}

/** 有 HTML 格式时返回 null，交给编辑器按原格式插入。没有 HTML 格式时才解析 Markdown。 */
export function markdownFromClipboard(data: DataTransfer | null): RichDoc | null {
  if (!data) return null;
  if (htmlHasFormatting(clipText(data, 'text/html'))) return null;
  for (const type of ['text/markdown', 'text/x-markdown', 'text/plain']) {
    const value = clipText(data, type);
    if (value.trim() === '') continue;
    const parsed = pasteMarkdown(value);
    if (parsed) return parsed;
  }
  return null;
}
