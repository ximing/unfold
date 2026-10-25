import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef } from 'react';

function normalize(html: string): string {
  return html === '<p></p>' ? '' : html;
}

/**
 * 笔记的富文本编辑器。快捷键：⌘B 粗体、⌘I 斜体、⌘E 行内代码，
 * 行首输入 # 、- 、1. 、> 会转成对应块。失焦保存为 HTML。
 */
export function NoteEditor(props: { html: string; onSave: (html: string) => void }) {
  const lastHtml = useRef(props.html);
  const editor = useEditor({
    extensions: [StarterKit],
    content: props.html,
    editorProps: {
      attributes: { class: 'note-prose', 'aria-label': '笔记' },
    },
    onBlur({ editor: current }) {
      const html = normalize(current.getHTML());
      if (html !== lastHtml.current) {
        lastHtml.current = html;
        props.onSave(html);
      }
    },
  });

  // 外部内容变化（比如换了点）时替换文档
  useEffect(() => {
    if (!editor) return;
    if (props.html !== lastHtml.current) {
      lastHtml.current = props.html;
      editor.commands.setContent(props.html, { emitUpdate: false });
    }
  }, [editor, props.html]);

  return (
    <div className="note-editor">
      <EditorContent editor={editor} />
    </div>
  );
}
