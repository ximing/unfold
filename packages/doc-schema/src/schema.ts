import { Extension, Node, mergeAttributes, type AnyExtension } from '@tiptap/core';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Image from '@tiptap/extension-image';
import { Mathematics } from '@tiptap/extension-mathematics';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';

const lowlight = createLowlight(common);

/** Block nodes that expressions can address. Inline math is not a block. */
export const BLOCK_ID_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'bulletList',
  'orderedList',
  'listItem',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'image',
  'horizontalRule',
  'blockMath',
  'mermaid',
  'derivation_steps',
  'derivation_step',
  'tiered_hints',
  'hint_item',
  'personal_note',
  'question',
  'counterexample',
  'decision',
  'object_ref',
  'collection_ref',
  'algo_problem',
  'theorem',
  'lang_pattern',
] as const;

export const BlockId = Extension.create({
  name: 'blockId',
  addGlobalAttributes() {
    return [
      {
        types: [...BLOCK_ID_TYPES],
        attributes: {
          id: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-block-id'),
            renderHTML: (attributes) => {
              const id = attributes.id;
              if (typeof id !== 'string' || id.length === 0) return {};
              return { 'data-block-id': id };
            },
          },
        },
      },
    ];
  },
});

export const MermaidBlock = Node.create({
  name: 'mermaid',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  isolating: true,
  parseHTML() {
    return [{ tag: 'pre[data-type="mermaid"]', preserveWhitespace: 'full' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'pre',
      mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid' }),
      ['code', { class: 'language-mermaid' }, 0],
    ];
  },
});

function asideBlock(name: string, dataType: string) {
  return Node.create({
    name,
    group: 'block',
    content: 'paragraph+',
    defining: true,
    isolating: true,
    parseHTML() {
      return [{ tag: `aside[data-type="${dataType}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ['aside', mergeAttributes(HTMLAttributes, { 'data-type': dataType }), 0];
    },
  });
}

function stepBlock(name: string, dataType: string) {
  return Node.create({
    name,
    content: 'paragraph+',
    defining: true,
    parseHTML() {
      return [{ tag: `div[data-type="${dataType}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes(HTMLAttributes, { 'data-type': dataType }), 0];
    },
  });
}

function refBlock(name: string, dataType: string, idAttribute: string) {
  return Node.create({
    name,
    group: 'block',
    atom: true,
    addAttributes() {
      return {
        [idAttribute]: { default: null },
        label: { default: '' },
      };
    },
    parseHTML() {
      return [{ tag: `div[data-type="${dataType}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes(HTMLAttributes, { 'data-type': dataType })];
    },
  });
}

const PersonalNote = asideBlock('personal_note', 'personal-note');
const Question = asideBlock('question', 'question');
const Counterexample = asideBlock('counterexample', 'counterexample');
const Decision = asideBlock('decision', 'decision');

const DerivationStep = stepBlock('derivation_step', 'derivation-step');
const DerivationSteps = Node.create({
  name: 'derivation_steps',
  group: 'block',
  content: 'derivation_step+',
  defining: true,
  isolating: true,
  parseHTML() {
    return [{ tag: 'section[data-type="derivation-steps"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['section', mergeAttributes(HTMLAttributes, { 'data-type': 'derivation-steps' }), 0];
  },
});

const HintItem = stepBlock('hint_item', 'hint-item');
const TieredHints = Node.create({
  name: 'tiered_hints',
  group: 'block',
  content: 'hint_item+',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      collapsed: {
        default: true,
        parseHTML: (element) => element.getAttribute('data-collapsed') !== 'false',
        renderHTML: (attributes) => ({
          'data-collapsed': attributes.collapsed === false ? 'false' : 'true',
        }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'section[data-type="tiered-hints"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['section', mergeAttributes(HTMLAttributes, { 'data-type': 'tiered-hints' }), 0];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement('section');
      dom.setAttribute('data-type', 'tiered-hints');
      const button = document.createElement('button');
      button.type = 'button';
      const contentDOM = document.createElement('div');

      const sync = (next: typeof node) => {
        current = next;
        const collapsed = next.attrs.collapsed !== false;
        dom.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
        button.textContent = collapsed ? '展开提示' : '折叠提示';
        contentDOM.hidden = collapsed;
      };
      sync(node);

      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
      });
      button.addEventListener('click', () => {
        const pos = getPos();
        if (typeof pos !== 'number') return;
        const collapsed = current.attrs.collapsed === false;
        editor.commands.command(({ tr }) => {
          tr.setNodeMarkup(pos, undefined, { ...current.attrs, collapsed });
          return true;
        });
      });

      dom.append(button, contentDOM);
      return {
        dom,
        contentDOM,
        update(updated) {
          if (updated.type.name !== 'tiered_hints') return false;
          sync(updated);
          return true;
        },
      };
    };
  },
});

const ObjectRef = refBlock('object_ref', 'object-ref', 'objectId');
const CollectionRef = refBlock('collection_ref', 'collection-ref', 'collectionId');

const FIELD_LABELS: Record<string, string> = {
  statement: '题面',
  constraints: '约束',
  examples: '样例',
  complexity: '复杂度',
  proposition: '命题',
  condition: '条件',
  proof: '证明',
  corollary: '推论',
  pattern: '句型',
  example: '例句',
  contrast: '对照',
  confusion: '易混点',
};

function subjectBlock(name: string, dataType: string, fields: readonly string[]) {
  return Node.create({
    name,
    group: 'block',
    atom: true,
    defining: true,
    addAttributes() {
      const attributes: Record<
        string,
        {
          default: string;
          parseHTML: (element: HTMLElement) => string;
          renderHTML: (attrs: Record<string, unknown>) => Record<string, string>;
        }
      > = {};
      for (const field of fields) {
        attributes[field] = {
          default: '',
          parseHTML: (element) => element.getAttribute(`data-${field}`) ?? '',
          renderHTML: (attrs) => ({
            [`data-${field}`]: typeof attrs[field] === 'string' ? attrs[field] : '',
          }),
        };
      }
      return attributes;
    },
    parseHTML() {
      return [{ tag: `section[data-type="${dataType}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ['section', mergeAttributes(HTMLAttributes, { 'data-type': dataType })];
    },
    addNodeView() {
      return ({ node, getPos, editor }) => {
        let current = node;
        const dom = document.createElement('section');
        dom.setAttribute('data-type', dataType);
        const inputs = new Map<string, HTMLInputElement>();

        const sync = (next: typeof node) => {
          current = next;
          for (const field of fields) {
            const input = inputs.get(field);
            if (!input) continue;
            const raw = next.attrs[field];
            const value = typeof raw === 'string' ? raw : '';
            if (input.value !== value) input.value = value;
          }
        };

        for (const field of fields) {
          const label = document.createElement('label');
          label.textContent = FIELD_LABELS[field] ?? field;
          const input = document.createElement('input');
          input.addEventListener('mousedown', (event) => {
            event.stopPropagation();
          });
          input.addEventListener('input', () => {
            const pos = getPos();
            if (typeof pos !== 'number') return;
            editor.commands.command(({ tr }) => {
              tr.setNodeMarkup(pos, undefined, { ...current.attrs, [field]: input.value });
              return true;
            });
          });
          inputs.set(field, input);
          dom.append(label, input);
        }
        sync(node);

        return {
          dom,
          ignoreMutation: () => true,
          update(updated) {
            if (updated.type.name !== name) return false;
            sync(updated);
            return true;
          },
        };
      };
    },
  });
}

const AlgoProblem = subjectBlock('algo_problem', 'algo-problem', [
  'statement',
  'constraints',
  'examples',
  'complexity',
]);
const Theorem = subjectBlock('theorem', 'theorem', [
  'proposition',
  'condition',
  'proof',
  'corollary',
]);
const LangPattern = subjectBlock('lang_pattern', 'lang-pattern', [
  'pattern',
  'example',
  'contrast',
  'confusion',
]);

export function getExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      codeBlock: false,
      link: { openOnClick: false, autolink: false },
    }),
    CodeBlockLowlight.configure({ lowlight }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Image.configure({ inline: false, allowBase64: false }),
    Mathematics,
    MermaidBlock,
    PersonalNote,
    Question,
    Counterexample,
    Decision,
    DerivationSteps,
    DerivationStep,
    TieredHints,
    HintItem,
    ObjectRef,
    CollectionRef,
    AlgoProblem,
    Theorem,
    LangPattern,
    BlockId,
  ];
}
