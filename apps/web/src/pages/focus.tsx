import { observer, useService } from '@rabjs/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { SCHEMA_VERSION, getExtensions } from '@unfold/doc-schema';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { LibraryService } from '../services/library.service.js';

export const FocusPage = observer(function FocusPage() {
  const library = useService(LibraryService);
  const { id = '' } = useParams();
  const saveRef = useRef<() => void>(() => {});
  const [saved, setSaved] = useState(false);
  const [seed, setSeed] = useState(false);

  const editor = useEditor({
    extensions: getExtensions(),
    content: { type: 'doc', content: [] },
    editorProps: {
      attributes: { class: 'doc-surface', 'aria-label': '块文档' },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          saveRef.current();
          return true;
        }
        return false;
      },
    },
  });

  useEffect(() => {
    if (!id || !editor) return;
    let alive = true;
    setSaved(false);
    setSeed(false);
    void (async () => {
      await library.loadObject(id);
      const doc = await library.loadDocument(id);
      if (!alive) return;
      editor.commands.setContent(doc?.content ?? { type: 'doc', content: [] }, {
        emitUpdate: false,
      });
      setSeed(doc === null || doc.plainText === '');
    })();
    return () => {
      alive = false;
    };
  }, [editor, id, library]);

  saveRef.current = () => {
    if (!editor || !id) return;
    void (async () => {
      const next = await library.saveDocument(id, {
        schemaVersion: SCHEMA_VERSION,
        content: editor.getJSON(),
        plainText: editor.getText(),
      });
      if (!next) {
        setSaved(false);
        return;
      }
      editor.commands.setContent(next.content, { emitUpdate: false });
      setSeed(next.plainText === '');
      setSaved(true);
    })();
  };

  function insert(content: Record<string, unknown>) {
    editor?.chain().focus().insertContent(content).run();
    setSeed(false);
    setSaved(false);
  }

  if (library.error === '没有这个点') {
    return (
      <main className="shell">
        <p>没有这个点</p>
      </main>
    );
  }

  const current = library.current;
  if (!current || current.id !== id) {
    return (
      <main className="shell">
        <p className="muted">正在读取…</p>
        {library.error ? <p role="alert">{library.error}</p> : null}
      </main>
    );
  }

  return (
    <main className="shell">
      <h1>{current.canonicalName}</h1>
      <p>{current.coreStatement}</p>
      <p className="muted">核心陈述 v{current.coreVersion}</p>
      {seed ? <p>这个点还是种子：只有一句话核心陈述。内容、连接、归位都后补。</p> : null}
      <div className="doc-tools">
        <button
          type="button"
          onClick={() => insert({ type: 'question', content: [{ type: 'paragraph' }] })}
        >
          疑问
        </button>
        <button
          type="button"
          onClick={() =>
            insert({
              type: 'tiered_hints',
              attrs: { collapsed: true },
              content: [{ type: 'hint_item', content: [{ type: 'paragraph' }] }],
            })
          }
        >
          分级提示
        </button>
        <button type="button" onClick={() => saveRef.current()}>
          保存
        </button>
      </div>
      {saved ? <p className="muted">已保存</p> : null}
      {library.error && library.error !== '没有这个点' ? <p role="alert">{library.error}</p> : null}
      <div className="doc">
        <EditorContent editor={editor} />
      </div>
    </main>
  );
});
