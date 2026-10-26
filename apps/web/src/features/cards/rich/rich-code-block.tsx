import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import { common, createLowlight } from 'lowlight';
import { USelect } from '../../../shared/ui/select/select.js';

const lowlight = createLowlight(common);

const CODE_LANGUAGES = lowlight.listLanguages().slice().sort((left, right) => left.localeCompare(right));

function CodeBlockView(props: ReactNodeViewProps) {
  const raw = props.node.attrs.language;
  const language = typeof raw === 'string' ? raw : '';
  const extra = language !== '' && !CODE_LANGUAGES.includes(language) ? language : null;
  const options = [
    { value: '', label: '纯文本' },
    ...(extra ? [{ value: extra, label: extra }] : []),
    ...CODE_LANGUAGES.map((name) => ({ value: name, label: name })),
  ];

  return (
    <NodeViewWrapper className="rich-code">
      <div className="rich-code-bar" contentEditable={false}>
        <USelect
          ariaLabel="代码语言"
          value={language}
          options={options}
          holdFocus
          onChange={(next) => {
            props.updateAttributes({ language: next === '' ? null : next });
          }}
        />
      </div>
      <pre>
        <NodeViewContent<'code'> as="code" />
      </pre>
    </NodeViewWrapper>
  );
}

export const RichCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
}).configure({ lowlight });
