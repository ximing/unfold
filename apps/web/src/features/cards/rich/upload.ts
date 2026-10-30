import type { Editor, JSONContent } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { errorBodySchema } from '@unfold/dto';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 10 * 1024 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FORMAT_MESSAGE = '只能放入 JPEG、PNG、WebP 或 GIF';
const SIZE_MESSAGE = '图片不能超过 10 MB';
const FAIL_MESSAGE = '图片没有放进去';

export function isFileDrag(data: DataTransfer | null): boolean {
  if (!data) return false;
  return Array.from(data.types).includes('Files');
}

export function filesFromTransfer(data: DataTransfer | null): File[] {
  if (!data) return [];
  const listed = Array.from(data.files);
  if (listed.length > 0) return listed;
  const files: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

export function altFrom(name: string): string | undefined {
  const base = name.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const stem = (dot > 0 ? base.slice(0, dot) : base).trim();
  const alt = Array.from(stem).slice(0, 200).join('');
  return alt === '' ? undefined : alt;
}

async function failureMessage(response: Response): Promise<string> {
  try {
    const parsed = errorBodySchema.safeParse(await response.json());
    if (parsed.success && parsed.data.error.message.trim() !== '') return parsed.data.error.message;
  } catch {
    // 响应不是 JSON 时用下面的兜底文案。
  }
  return FAIL_MESSAGE;
}

export async function uploadCardImage(cardId: string, file: File): Promise<string> {
  if (file.type !== '' && !ALLOWED.has(file.type)) throw new Error(FORMAT_MESSAGE);
  if (file.size > MAX_BYTES) throw new Error(SIZE_MESSAGE);
  const body = new FormData();
  body.append('file', file);
  let response: Response;
  try {
    response = await fetch(`/api/cards/${cardId}/assets`, {
      method: 'POST',
      credentials: 'include',
      body,
    });
  } catch {
    throw new Error('网络没有连上');
  }
  if (!response.ok) throw new Error(await failureMessage(response));
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(FAIL_MESSAGE);
  }
  const id = payload && typeof payload === 'object' && 'id' in payload ? payload.id : null;
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error(FAIL_MESSAGE);
  return id.toLowerCase();
}

function imageContent(src: string, alt: string | undefined): JSONContent {
  return { type: 'image', attrs: alt ? { src, alt } : { src } };
}

function replaceUploading(editor: Editor, key: string, attrs: { src: string; alt?: string } | null): boolean {
  if (editor.isDestroyed) return false;
  let found = false;
  editor.commands.command(({ tr, state }) => {
    const hit: { node: PmNode | null; pos: number } = { node: null, pos: -1 };
    state.doc.descendants((node, position) => {
      if (hit.node) return false;
      if (node.type.name === 'uploading' && node.attrs.key === key) {
        hit.node = node;
        hit.pos = position;
        return false;
      }
      return true;
    });
    const node = hit.node;
    const pos = hit.pos;
    if (!node || pos < 0) return false;
    found = true;
    const from = pos;
    const to = pos + node.nodeSize;
    if (attrs) {
      tr.replaceWith(from, to, state.schema.nodeFromJSON(imageContent(attrs.src, attrs.alt)));
      return true;
    }
    const parent = tr.doc.resolve(from).parent;
    const paragraph = state.schema.nodes.paragraph?.create();
    if (parent.type.name === 'doc' && parent.childCount === 1 && paragraph) tr.replaceWith(from, to, paragraph);
    else tr.delete(from, to);
    return true;
  });
  return found;
}

export async function placeImages(
  editor: Editor,
  cardId: string,
  files: File[],
  pos: number | undefined,
  onError: (message: string) => void,
): Promise<void> {
  if (files.length === 0 || editor.isDestroyed) return;
  const spots = files.map((file) => ({ file, key: crypto.randomUUID() }));
  const content = spots.map((spot) => ({ type: 'uploading', attrs: { key: spot.key } }));
  const inserted =
    pos === undefined
      ? editor.chain().focus().insertContent(content).run()
      : editor.chain().insertContentAt(pos, content).run();
  if (!inserted) {
    onError(FAIL_MESSAGE);
    return;
  }
  let message = '';
  for (const spot of spots) {
    try {
      const id = await uploadCardImage(cardId, spot.file);
      if (editor.isDestroyed) return;
      const alt = altFrom(spot.file.name);
      const replaced = replaceUploading(editor, spot.key, alt ? { src: id, alt } : { src: id });
      if (!replaced) editor.chain().focus().insertContent(imageContent(id, alt)).run();
    } catch (error) {
      if (!editor.isDestroyed) replaceUploading(editor, spot.key, null);
      if (message === '') message = error instanceof Error && error.message !== '' ? error.message : FAIL_MESSAGE;
    }
  }
  if (!editor.isDestroyed) onError(message);
}
