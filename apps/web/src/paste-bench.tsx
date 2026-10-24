import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { documentToMarkdown, getExtensions, parsePaste, type PmNode } from '@unfold/doc-schema';
import { useRef, useState } from 'react';
import chatgptHtml from '../../../packages/doc-schema/fixtures/chatgpt-state.html?raw';
import derivationMd from '../../../packages/doc-schema/fixtures/derivation.md?raw';
import 'katex/dist/katex.min.css';

function mermaidSource(doc: PmNode | null): string {
  if (!doc) return '';
  const found: string[] = [];
  const walk = (node: PmNode) => {
    if (node.type === 'mermaid') {
      found.push((node.content ?? []).map((child) => child.text ?? '').join(''));
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return found[0] ?? '';
}

export function PasteBench() {
  const [doc, setDoc] = useState<PmNode | null>(null);
  const [diagram, setDiagram] = useState('');
  const [diagramError, setDiagramError] = useState('');
  const editorRef = useRef<Editor | null>(null);
  const editor = useEditor({
    extensions: getExtensions(),
    content: '<p>把 ChatGPT 的回答贴到这里。表格、代码和公式应留下来。</p>',
    editorProps: {
      handlePaste(_view, event) {
        const html = event.clipboardData?.getData('text/html') ?? '';
        const plain = event.clipboardData?.getData('text/plain') ?? '';
        if (!html && !plain) return false;
        event.preventDefault();
        const parsed = parsePaste(html, plain);
        editorRef.current?.commands.insertContent(parsed.content.content ?? []);
        setDoc(parsed.content);
        void renderDiagram(parsed.content);
        return true;
      },
    },
  });
  editorRef.current = editor;

  async function renderDiagram(content: PmNode) {
    const source = mermaidSource(content);
    setDiagram('');
    setDiagramError('');
    if (!source) return;
    try {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
      const rendered = await mermaid.render(`m${Date.now()}`, source);
      setDiagram(rendered.svg);
    } catch (error) {
      setDiagramError(error instanceof Error ? error.message : '图没有渲染出来');
    }
  }

  function load(html: string, plain: string) {
    const parsed = parsePaste(html, plain);
    editor?.commands.setContent(parsed.content);
    setDoc(parsed.content);
    void renderDiagram(parsed.content);
  }

  const source = mermaidSource(doc);

  return (
    <main className="bench">
      <header>
        <h1>粘贴验证</h1>
        <p>M0 只检查格式能不能留下来。知识对象、关系和复习都还没有。</p>
      </header>
      <div className="actions">
        <button type="button" onClick={() => load(chatgptHtml, '这段纯文本没有标题、围栏或表格。')}>
          载入 HTML 夹具
        </button>
        <button type="button" onClick={() => load('', derivationMd)}>
          载入 Markdown 夹具
        </button>
        <button
          type="button"
          onClick={() => {
            if (!doc) return;
            void navigator.clipboard.writeText(documentToMarkdown(doc));
          }}
        >
          复制 Markdown
        </button>
      </div>
      <EditorContent editor={editor} className="editor" />
      {source ? (
        <section>
          <h2>Mermaid</h2>
          {diagram ? <div dangerouslySetInnerHTML={{ __html: diagram }} /> : null}
          {diagramError ? <p>{diagramError}</p> : null}
          <pre>{source}</pre>
        </section>
      ) : null}
    </main>
  );
}
