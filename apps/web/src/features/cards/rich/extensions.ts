import { Node, mergeAttributes } from '@tiptap/core';
import type { NodeViewRendererProps } from '@tiptap/core';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Mathematics } from '@tiptap/extension-mathematics';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Underline from '@tiptap/extension-underline';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { BackgroundColor, Color, FontSize, TextStyle } from '@tiptap/extension-text-style';
import StarterKit from '@tiptap/starter-kit';
import type { Node as PmNode } from '@tiptap/pm/model';
import { common, createLowlight } from 'lowlight';
import { normalizeColor, normalizeFontSize } from './palette.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const lowlight = createLowlight(common);

export const CODE_LANGUAGES = lowlight.listLanguages().slice().sort((left, right) => left.localeCompare(right));

const ALIGN_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'codeBlock',
  'table',
  'tableRow',
];

const SizedFont = FontSize.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) => normalizeFontSize(element.style.fontSize),
            renderHTML: (attributes: { fontSize?: unknown }) => {
              const size = normalizeFontSize(attributes.fontSize);
              if (!size) return {};
              return { style: `font-size: ${size}px` };
            },
          },
        },
      },
    ];
  },
});

function backgroundAttribute() {
  return {
    default: null as string | null,
    parseHTML: (element: HTMLElement) => normalizeColor(element.style.backgroundColor),
    renderHTML: (attributes: { backgroundColor?: unknown }) => {
      const color = normalizeColor(attributes.backgroundColor);
      if (!color) return {};
      return { style: `background-color: ${color}` };
    },
  };
}

const RichTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), backgroundColor: backgroundAttribute() };
  },
});

const RichTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), backgroundColor: backgroundAttribute() };
  },
});

function assetSrc(id: string): string {
  return UUID.test(id) ? `/api/assets/${id}` : '';
}

function readAssetId(element: HTMLElement): string | null {
  const explicit = element.getAttribute('data-asset') ?? '';
  if (UUID.test(explicit)) return explicit.toLowerCase();
  const match = /\/api\/assets\/([0-9a-f-]{36})/i.exec(element.getAttribute('src') ?? '');
  if (match?.[1] && UUID.test(match[1])) return match[1].toLowerCase();
  return null;
}

/** src 只存资源 id，显示地址在渲染时再拼。 */
const RichImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: false,
  addAttributes() {
    return {
      src: { default: null, rendered: false },
      alt: { default: null, rendered: false },
      width: { default: null, rendered: false },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'img[data-rich-image]',
        getAttrs(dom) {
          if (!(dom instanceof HTMLElement)) return false;
          const src = readAssetId(dom);
          if (!src) return false;
          const alt = (dom.getAttribute('alt') ?? '').trim().slice(0, 200);
          const width = Number(dom.getAttribute('width'));
          const attrs: { src: string; alt?: string; width?: number } = { src };
          if (alt !== '') attrs.alt = alt;
          if (Number.isFinite(width) && width >= 32 && width <= 1200) attrs.width = width;
          return attrs;
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes, node }) {
    const src = typeof node.attrs.src === 'string' ? node.attrs.src : '';
    const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
    const width = node.attrs.width;
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        'data-rich-image': 'true',
        'data-asset': src,
        src: assetSrc(src),
        alt,
        ...(typeof width === 'number' ? { width: String(width) } : {}),
      }),
    ];
  },
});

const Uploading = Node.create({
  name: 'uploading',
  group: 'block',
  atom: true,
  draggable: false,
  addAttributes() {
    return { key: { default: null, rendered: false } };
  },
  parseHTML() {
    return [{ tag: 'div[data-uploading]' }];
  },
  renderHTML() {
    return ['div', { 'data-uploading': 'true', class: 'rich-uploading' }, '正在上传'];
  },
});

let mermaidReady = false;

async function drawMermaid(source: string): Promise<string> {
  const { default: mermaid } = await import('mermaid');
  if (!mermaidReady) {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    mermaidReady = true;
  }
  const parsed = await mermaid.parse(source, { suppressErrors: true });
  if (!parsed) throw new Error('parse');
  const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  try {
    const rendered = await mermaid.render(id, source);
    return rendered.svg;
  } catch (error) {
    document.getElementById(id)?.remove();
    throw error;
  }
}

function mountSvg(figure: HTMLElement, svg: string) {
  const host = document.createElement('div');
  host.innerHTML = svg;
  const node = host.querySelector('svg');
  if (!node) throw new Error('empty');
  figure.replaceChildren(node);
}

function showMermaidFailure(figure: HTMLElement, source: string) {
  const raw = document.createElement('pre');
  raw.className = 'rich-mermaid-raw';
  raw.textContent = source;
  const fail = document.createElement('p');
  fail.className = 'rich-mermaid-fail';
  fail.textContent = '这张图没有画出来';
  figure.replaceChildren(raw, fail);
}

function readPos(getPos: NodeViewRendererProps['getPos']): number | undefined {
  if (typeof getPos !== 'function') return undefined;
  try {
    const pos = getPos();
    return typeof pos === 'number' ? pos : undefined;
  } catch {
    return undefined;
  }
}

const Mermaid = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,
  draggable: false,
  addAttributes() {
    return { source: { default: '' } };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-mermaid]',
        getAttrs(dom) {
          if (!(dom instanceof HTMLElement)) return false;
          return { source: dom.getAttribute('data-source') ?? '' };
        },
      },
    ];
  },
  renderHTML({ node }) {
    const source = typeof node.attrs.source === 'string' ? node.attrs.source : '';
    return ['div', { 'data-mermaid': 'true', 'data-source': source }];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let drawn = '';
      let queued = '';
      let token = 0;
      let timer = 0;
      const dom = document.createElement('div');
      dom.className = 'rich-mermaid';
      dom.contentEditable = 'false';
      const input = document.createElement('textarea');
      input.className = 'rich-mermaid-source';
      input.value = String(node.attrs.source ?? '');
      input.placeholder = 'Mermaid';
      input.setAttribute('aria-label', 'Mermaid 源码');
      const figure = document.createElement('div');
      figure.className = 'rich-mermaid-figure';
      dom.append(input, figure);

      const schedule = (source: string) => {
        if (source === queued) return;
        queued = source;
        window.clearTimeout(timer);
        const mine = ++token;
        if (source.trim() === '') {
          drawn = '';
          queued = '';
          figure.replaceChildren();
          return;
        }
        if (source === drawn) return;
        timer = window.setTimeout(() => {
          void drawMermaid(source)
            .then((svg) => {
              if (mine !== token) return;
              mountSvg(figure, svg);
              drawn = source;
              queued = source;
            })
            .catch(() => {
              if (mine !== token) return;
              showMermaidFailure(figure, source);
              drawn = source;
              queued = source;
            });
        }, 300);
      };

      input.addEventListener('input', () => {
        const pos = readPos(getPos);
        if (pos === undefined) return;
        const source = input.value.slice(0, 20000);
        if (input.value !== source) input.value = source;
        editor.commands.command(({ tr }) => {
          const latest = tr.doc.nodeAt(pos);
          if (!latest || latest.type.name !== 'mermaid') return false;
          if (latest.attrs.source === source) return false;
          tr.setNodeMarkup(pos, undefined, { source });
          return true;
        });
      });

      schedule(String(node.attrs.source ?? ''));

      return {
        dom,
        update(next: PmNode) {
          if (next.type.name !== 'mermaid') return false;
          const source = String(next.attrs.source ?? '');
          if (input.value !== source) {
            const start = input.selectionStart;
            const end = input.selectionEnd;
            input.value = source;
            if (document.activeElement === input && start !== null && end !== null) {
              input.setSelectionRange(start, end);
            }
          }
          schedule(source);
          return true;
        },
        stopEvent(event: Event) {
          const target = event.target;
          return target instanceof HTMLElement && Boolean(target.closest('textarea, input'));
        },
        ignoreMutation() {
          return true;
        },
        selectNode() {
          dom.classList.add('is-selected');
        },
        deselectNode() {
          dom.classList.remove('is-selected');
        },
        destroy() {
          token += 1;
          window.clearTimeout(timer);
        },
      };
    };
  },
});

export function createRichExtensions() {
  return [
    // 关掉自动补空段，打开未改过的文稿时不会立刻保存。
    StarterKit.configure({
      codeBlock: false,
      trailingNode: false,
      link: { openOnClick: false, autolink: true, HTMLAttributes: {} },
    }),
    Subscript,
    Superscript,
    Underline,
    TextStyle,
    Color,
    BackgroundColor,
    SizedFont,
    TextAlign.configure({
      types: ALIGN_TYPES,
      alignments: ['left', 'center', 'right'],
      defaultAlignment: null,
    }),
    TaskList,
    TaskItem.configure({
      nested: true,
      a11y: { checkboxLabel: (_node, checked) => (checked ? '已完成' : '未完成') },
    }),
    Table.configure({ resizable: false }),
    TableRow,
    RichTableCell,
    RichTableHeader,
    CodeBlockLowlight.configure({ lowlight }),
    Mathematics,
    RichImage,
    Uploading,
    Mermaid,
  ];
}
