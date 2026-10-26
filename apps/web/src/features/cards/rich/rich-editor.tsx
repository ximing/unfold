import type { Editor, JSONContent } from '@tiptap/core';
import type { EditorProps } from '@tiptap/pm/view';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Card, RichDoc } from '@unfold/dto';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { CardFrame } from '../card-frame.js';
import { createRichExtensions } from './extensions.js';
import { pasteMarkdown } from './paste.js';
import { sanitizeDoc } from './sanitize.js';
import { RichToolbar } from './toolbar.js';
import { filesFromTransfer, isFileDrag, placeImages } from './upload.js';
import './rich-editor.css';

function savedText(value: unknown): string {
  return JSON.stringify(sanitizeDoc(value));
}

function insertPasted(editor: Editor, doc: RichDoc) {
  const blocks = doc.content ?? [];
  const only = blocks.length === 1 ? blocks[0] : undefined;
  if (only?.type === 'paragraph' && editor.isActive('paragraph')) {
    editor.chain().focus().insertContent((only.content ?? []) as JSONContent[]).run();
    return;
  }
  editor.chain().focus().insertContent(blocks as JSONContent[]).run();
}

export function RichCard(props: {
  cardId: string;
  doc: RichDoc;
  onUpdate: (content: Card['content']) => void;
  onDelete: () => void;
}) {
  const initialDoc = useRef(props.doc);
  const editorRef = useRef<Editor | null>(null);
  const saved = useRef('');
  const timer = useRef<number | null>(null);
  const mounted = useRef(true);
  const cardIdRef = useRef(props.cardId);
  const onUpdateRef = useRef(props.onUpdate);
  const flushRef = useRef<() => void>(() => {});
  const [uploadError, setUploadError] = useState('');
  cardIdRef.current = props.cardId;
  onUpdateRef.current = props.onUpdate;

  const extensions = useMemo(() => createRichExtensions(), []);
  const handlers = useRef<{ onPaste: (event: ClipboardEvent) => boolean }>({
    onPaste: () => false,
  });

  const editorProps = useMemo<EditorProps>(
    () => ({
      attributes: { class: 'rich-prose', 'aria-label': '富文本' },
      handlePaste(_view, event) {
        return handlers.current.onPaste(event);
      },
    }),
    [],
  );

  function flush() {
    const current = editorRef.current;
    if (!current || current.isDestroyed) return;
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const doc = sanitizeDoc(current.getJSON());
    const next = JSON.stringify(doc);
    if (next === saved.current) return;
    onUpdateRef.current({ doc } as Card['content']);
  }

  flushRef.current = flush;

  const editor = useEditor({
    extensions,
    content: initialDoc.current as JSONContent,
    editorProps,
    onCreate({ editor: current }) {
      editorRef.current = current;
      // 基线取规范化之后的文稿，和上次成功保存相同则不再请求。
      saved.current = savedText(current.getJSON());
    },
    onUpdate() {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        flushRef.current();
      }, 800);
    },
    onBlur() {
      flushRef.current();
    },
  });

  editorRef.current = editor;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      flushRef.current();
    };
  }, []);

  useEffect(() => {
    const current = editorRef.current;
    if (!current || current.isDestroyed) return;
    const incoming = savedText(props.doc);
    const local = savedText(current.getJSON());
    if (incoming === local) {
      saved.current = incoming;
      return;
    }
    if (local !== saved.current) return;
    current.commands.setContent(sanitizeDoc(props.doc) as JSONContent, { emitUpdate: false });
    saved.current = savedText(current.getJSON());
  }, [props.doc]);

  function report(message: string) {
    if (mounted.current) setUploadError(message);
  }

  handlers.current.onPaste = (event) => {
    const current = editorRef.current;
    if (!current || current.isDestroyed) return false;
    const files = filesFromTransfer(event.clipboardData);
    if (files.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      void placeImages(current, cardIdRef.current, files, undefined, report);
      return true;
    }
    if (current.isActive('codeBlock')) return false;
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const doc = text === '' ? null : pasteMarkdown(text);
    if (!doc) return false;
    event.preventDefault();
    insertPasted(current, doc);
    return true;
  };

  function blockFileDrag(event: DragEvent) {
    if (!isFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'dragover') event.dataTransfer.dropEffect = 'copy';
  }

  function onDrop(event: DragEvent) {
    if (!isFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const files = filesFromTransfer(event.dataTransfer);
    let pos: number | undefined;
    try {
      pos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
    } catch {
      pos = undefined;
    }
    void placeImages(editor, props.cardId, files, pos, report);
  }

  return (
    <CardFrame type="rich" className="kind-rich" onDelete={props.onDelete}>
      <div className="rich-editor" onDragEnterCapture={blockFileDrag} onDragOverCapture={blockFileDrag} onDropCapture={onDrop}>
        <div className="rich-sticky">
          <RichToolbar
            editor={editor}
            onImages={(files) => {
              void placeImages(editor, props.cardId, files, undefined, report);
            }}
          />
          {uploadError !== '' ? (
            <p className="rich-error" role="alert">
              {uploadError}
            </p>
          ) : null}
        </div>
        <EditorContent editor={editor} />
      </div>
    </CardFrame>
  );
}
