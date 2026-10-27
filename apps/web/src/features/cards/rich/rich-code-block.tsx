import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import { common, createLowlight } from 'lowlight';
import { USelect } from '../../../shared/ui/select/select.js';
import { defaultRichCodeLanguage, richCodeLanguageOptions } from './rich-languages.js';

const lowlight = createLowlight(common);

function CodeBlockView(props: ReactNodeViewProps) {
  const raw = props.node.attrs.language;
  const language = typeof raw === 'string' ? raw : '';
  const selected = language === 'plaintext' ? '' : language;

  return (
    <NodeViewWrapper className="rich-code">
      <div className="rich-code-bar" contentEditable={false}>
        <USelect
          ariaLabel="代码语言"
          value={selected}
          options={richCodeLanguageOptions(language)}
          searchable
          searchLabel="搜索语言"
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
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      'Mod-Alt-c': () => this.editor.commands.toggleCodeBlock({ language: defaultRichCodeLanguage }),
    };
  },
}).configure({ lowlight });
