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
      collapsed: { default: true },
    };
  },
  parseHTML() {
    return [{ tag: 'section[data-type="tiered-hints"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['section', mergeAttributes(HTMLAttributes, { 'data-type': 'tiered-hints' }), 0];
  },
});

const ObjectRef = refBlock('object_ref', 'object-ref', 'objectId');
const CollectionRef = refBlock('collection_ref', 'collection-ref', 'collectionId');

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
    BlockId,
  ];
}
