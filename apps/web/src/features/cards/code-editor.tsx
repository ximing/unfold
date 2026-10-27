import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { findCodeLanguage } from './code-language.js';

const editorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      color: 'var(--ink)',
      fontSize: '12.5px',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'var(--mono)',
      lineHeight: '1.55',
      minHeight: '90px',
    },
    '.cm-content': { padding: '8px 12px 10px', caretColor: 'var(--ink)' },
    '.cm-content:focus-visible': { outline: 'none' },
    '.cm-line': { padding: 0 },
  },
  { dark: false },
);

async function languageExtension(name: string) {
  const found = findCodeLanguage(name);
  if (!found) return [];
  try {
    return await found.load();
  } catch {
    return [];
  }
}

export function CodeEditor(props: {
  source: string;
  language: string;
  autoFocus: boolean;
  onChange: (source: string) => void;
  onBlur: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageConf = useRef(new Compartment());
  const applying = useRef(false);
  const languageGen = useRef(0);
  const onChangeRef = useRef(props.onChange);
  const onBlurRef = useRef(props.onBlur);
  const initialSource = useRef(props.source);
  const autoFocus = useRef(props.autoFocus);
  onChangeRef.current = props.onChange;
  onBlurRef.current = props.onBlur;

  useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initialSource.current,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          indentOnInput(),
          bracketMatching(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          editorTheme,
          languageConf.current.of([]),
          EditorView.contentAttributes.of({ 'aria-label': '代码', spellcheck: 'false' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !applying.current) onChangeRef.current(update.state.doc.toString());
            if (update.focusChanged && !update.view.hasFocus) onBlurRef.current();
          }),
        ],
      }),
    });
    viewRef.current = view;
    if (autoFocus.current) view.focus();
    return () => {
      languageGen.current += 1;
      view.destroy();
      if (viewRef.current === view) viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === props.source) return;
    applying.current = true;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: props.source },
      annotations: Transaction.addToHistory.of(false),
    });
    applying.current = false;
  }, [props.source]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const generation = languageGen.current + 1;
    languageGen.current = generation;
    let cancelled = false;
    void languageExtension(props.language).then((extension) => {
      if (cancelled || generation !== languageGen.current || viewRef.current !== view) return;
      view.dispatch({ effects: languageConf.current.reconfigure(extension) });
    });
    return () => {
      cancelled = true;
    };
  }, [props.language]);

  return <div className="code-editor" ref={hostRef} />;
}
