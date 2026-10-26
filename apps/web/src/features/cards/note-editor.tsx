import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef } from 'react';
import { createHandoff } from '../../shared/save/handoff.js';
import { noteDraft } from '../../shared/save/save-bus.js';
import { takeServerText } from '../../shared/save/server-text.js';
import { useSaveDraft } from '../../shared/save/use-save-draft.js';
import './note-editor.css';

function normalize(html: string): string {
  return html === '<p></p>' ? '' : html;
}

/**
 * 笔记的富文本编辑器。快捷键：⌘B 粗体、⌘I 斜体、⌘E 行内代码，
 * 行首输入 # 、- 、1. 、> 会转成对应块。失焦或 ⌘S 保存为 HTML。
 */
export function NoteEditor(props: { html: string; onSave: (html: string) => Promise<boolean> | void }) {
  const acked = useRef(props.html);
  const onSaveRef = useRef(props.onSave);
  const editorRef = useRef<Editor | null>(null);
  const hand = useRef(createHandoff()).current;
  onSaveRef.current = props.onSave;

  function commit() {
    const current = editorRef.current;
    if (!current || current.isDestroyed) return;
    const html = normalize(current.getHTML());
    return hand.send(html, acked.current, () => onSaveRef.current(html));
  }

  const commitRef = useRef(commit);
  commitRef.current = commit;

  const editor = useEditor({
    extensions: [StarterKit],
    content: props.html,
    editorProps: {
      attributes: { class: 'note-prose', 'aria-label': '笔记' },
    },
    onCreate({ editor: current }) {
      editorRef.current = current;
    },
    onUpdate() {
      hand.edit();
    },
    onBlur() {
      void commitRef.current();
    },
  });

  editorRef.current = editor;

  useSaveDraft(
    () => {
      const current = editorRef.current;
      if (!current || current.isDestroyed) return false;
      return hand.dirty(normalize(current.getHTML()), acked.current);
    },
    () => {
      void commitRef.current();
    },
  );

  useEffect(() => {
    const current = editorRef.current;
    if (!current || current.isDestroyed) return;
    const local = normalize(current.getHTML());
    const decision = takeServerText(local, acked.current, props.html, false);
    if (decision === 'keep') {
      noteDraft();
      return;
    }
    if (decision === 'echo') {
      acked.current = props.html;
      noteDraft();
      return;
    }
    acked.current = props.html;
    current.commands.setContent(props.html, { emitUpdate: false });
    noteDraft();
  }, [editor, props.html]);

  return (
    <div className="note-editor">
      <EditorContent editor={editor} />
    </div>
  );
}
