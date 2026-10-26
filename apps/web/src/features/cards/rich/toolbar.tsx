import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { CODE_LANGUAGES } from './extensions.js';
import { BACKGROUND_COLORS, FONT_SIZES, TEXT_COLORS, normalizeColor, normalizeFontSize, parseCustomColor } from './palette.js';

const TOOLS = [
  'undo',
  'redo',
  'bold',
  'italic',
  'strike',
  'clear',
  'size',
  'color',
  'background',
  'left',
  'center',
  'right',
  'heading',
  'quote',
  'bullet',
  'ordered',
  'task',
  'code',
  'link',
  'image',
  'table',
  'rule',
  'formula',
  'mermaid',
] as const;

type ToolId = (typeof TOOLS)[number];
type ColorKind = 'text' | 'back' | 'cell';

const GAP = 4;

function readActive(editor: Editor) {
  let heading = '0';
  for (let level = 1; level <= 6; level += 1) {
    if (editor.isActive('heading', { level })) {
      heading = String(level);
      break;
    }
  }
  const language = editor.getAttributes('codeBlock').language;
  const link = editor.getAttributes('link').href;
  const cell =
    normalizeColor(editor.getAttributes('tableCell').backgroundColor) ??
    normalizeColor(editor.getAttributes('tableHeader').backgroundColor) ??
    '';
  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    strike: editor.isActive('strike'),
    align: editor.isActive({ textAlign: 'center' })
      ? 'center'
      : editor.isActive({ textAlign: 'right' })
        ? 'right'
        : editor.isActive({ textAlign: 'left' })
          ? 'left'
          : '',
    heading,
    fontSize: normalizeFontSize(editor.getAttributes('textStyle').fontSize) ?? '',
    bullet: editor.isActive('bulletList'),
    ordered: editor.isActive('orderedList'),
    task: editor.isActive('taskList'),
    quote: editor.isActive('blockquote'),
    code: editor.isActive('codeBlock'),
    language: typeof language === 'string' ? language : '',
    link: typeof link === 'string' ? link : '',
    inTable: editor.isActive('table'),
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
    color: normalizeColor(editor.getAttributes('textStyle').color) ?? '',
    background: normalizeColor(editor.getAttributes('textStyle').backgroundColor) ?? '',
    cell,
  };
}

function keepSelection(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

function clearFormat(editor: Editor) {
  editor
    .chain()
    .focus()
    .command(({ tr, state }) => {
      for (const type of Object.values(state.schema.marks)) {
        tr.removeStoredMark(type);
        tr.removeMark(tr.selection.from, tr.selection.to, type);
      }
      return true;
    })
    .run();
}

function applyLink(editor: Editor, raw: string) {
  const href = raw.trim().slice(0, 2000);
  if (href === '') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  if (editor.state.selection.empty && !editor.isActive('link')) {
    editor
      .chain()
      .focus()
      .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
      .run();
    return;
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
}

/** 含换行或被 $$ 包住则成块级，否则行内。 */
export function classifyLatex(raw: string): { block: boolean; latex: string } | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const wrapped = /^\$\$([\s\S]*)\$\$$/.exec(trimmed);
  const latex = (wrapped ? (wrapped[1] ?? '') : trimmed).trim().slice(0, 8000);
  if (latex === '') return null;
  return { block: Boolean(wrapped) || latex.includes('\n'), latex };
}

function insertLatex(editor: Editor, raw: string) {
  const next = classifyLatex(raw);
  if (!next) return;
  editor
    .chain()
    .focus()
    .insertContent({ type: next.block ? 'blockMath' : 'inlineMath', attrs: { latex: next.latex } })
    .run();
}

function ColorPop(props: {
  colors: readonly { name: string; value: string }[];
  current: string;
  onPick: (hex: string | null) => void;
}) {
  const [custom, setCustom] = useState('');
  return (
    <div className="rich-pop">
      <div className="rich-swatches">
        {props.colors.map((color) => (
          <button
            key={color.value}
            type="button"
            className={props.current === color.value ? 'rich-swatch is-on' : 'rich-swatch'}
            style={{ background: color.value }}
            aria-label={color.name}
            title={color.name}
            onMouseDown={keepSelection}
            onClick={() => props.onPick(color.value)}
          />
        ))}
      </div>
      <input
        aria-label="颜色"
        placeholder="#RRGGBB"
        value={custom}
        onChange={(event) => setCustom(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const color = parseCustomColor(custom);
          if (color) props.onPick(color);
        }}
        onBlur={() => {
          const color = parseCustomColor(custom);
          if (color) props.onPick(color);
        }}
      />
      <button type="button" className="rich-pop-clear" onMouseDown={keepSelection} onClick={() => props.onPick(null)}>
        清除
      </button>
    </div>
  );
}

export function RichToolbar(props: { editor: Editor; onImages: (files: File[]) => void }) {
  const editor = props.editor;
  const active = useEditorState({ editor, selector: ({ editor: current }) => readActive(current) });
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [visibleCount, setVisibleCount] = useState<number>(TOOLS.length);
  const [ready, setReady] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState<ColorKind | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState('');
  const [mathOpen, setMathOpen] = useState(false);
  const [latex, setLatex] = useState('');
  const [rememberedLanguage, setRememberedLanguage] = useState('');

  const languageValue = active.code ? active.language : rememberedLanguage;
  const measureKey = `${active.language}|${active.fontSize}|${active.heading}|${languageValue}`;

  useLayoutEffect(() => {
    const bar = barRef.current;
    const measure = measureRef.current;
    if (!bar || !measure) return undefined;
    const fit = () => {
      const tools = Array.from(measure.querySelectorAll<HTMLElement>('[data-tool]'));
      const moreWidth = measure.querySelector<HTMLElement>('[data-more]')?.offsetWidth ?? 0;
      const limit = bar.clientWidth;
      let used = 0;
      let count = tools.length;
      for (let index = 0; index < tools.length; index += 1) {
        const width = tools[index]?.offsetWidth ?? 0;
        const nextUsed = used + (index > 0 ? GAP : 0) + width;
        const hidden = tools.length - index - 1;
        const reserve = hidden > 0 ? GAP + moreWidth : 0;
        if (nextUsed + reserve > limit + 0.5) {
          count = index;
          break;
        }
        used = nextUsed;
      }
      setVisibleCount((current) => (current === count ? current : count));
      setReady(true);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [measureKey]);

  useEffect(() => {
    if (!moreOpen && colorOpen === null) return undefined;
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || rootRef.current?.contains(target)) return;
      setMoreOpen(false);
      setColorOpen(null);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [moreOpen, colorOpen]);

  function button(
    label: string,
    on: boolean,
    disabled: boolean,
    live: boolean,
    command: () => void,
    hold?: { more?: boolean; color?: boolean },
  ) {
    return (
      <button
        type="button"
        className={on ? 'rich-tool is-on' : 'rich-tool'}
        disabled={disabled}
        tabIndex={live ? undefined : -1}
        aria-pressed={on}
        onMouseDown={live ? keepSelection : undefined}
        onClick={() => {
          if (!live) return;
          command();
          if (!hold?.more) setMoreOpen(false);
          if (!hold?.color) setColorOpen(null);
        }}
      >
        {label}
      </button>
    );
  }

  function pickColor(kind: ColorKind, hex: string | null) {
    const chain = editor.chain().focus();
    if (kind === 'text') {
      if (hex) chain.setColor(hex).run();
      else chain.unsetColor().run();
    } else if (kind === 'back') {
      if (hex) chain.setBackgroundColor(hex).run();
      else chain.unsetBackgroundColor().run();
    } else {
      chain.setCellAttribute('backgroundColor', hex).run();
    }
    setColorOpen(null);
  }

  function renderTool(id: ToolId, live: boolean, inMore = false): ReactNode {
    switch (id) {
      case 'undo':
        return button('撤销', false, !active.canUndo, live, () => editor.chain().focus().undo().run());
      case 'redo':
        return button('重做', false, !active.canRedo, live, () => editor.chain().focus().redo().run());
      case 'bold':
        return button('粗体', active.bold, false, live, () => editor.chain().focus().toggleBold().run());
      case 'italic':
        return button('斜体', active.italic, false, live, () => editor.chain().focus().toggleItalic().run());
      case 'strike':
        return button('删除线', active.strike, false, live, () => editor.chain().focus().toggleStrike().run());
      case 'clear':
        return button('清除格式', false, false, live, () => clearFormat(editor));
      case 'size':
        return (
          <span className="rich-tool-slot">
            <span className="rich-tool-label">字号</span>
            <select
              className="rich-select"
              aria-label="字号"
              tabIndex={live ? undefined : -1}
              value={active.fontSize}
              onChange={(event) => {
                const next = event.target.value;
                if (next === '') editor.chain().focus().unsetFontSize().run();
                else editor.chain().focus().setFontSize(next).run();
              }}
            >
              <option value="">默认</option>
              {FONT_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </span>
        );
      case 'color':
        return (
          <span className="rich-color-wrap">
            {button('字色', colorOpen === 'text', false, live, () => setColorOpen((current) => (current === 'text' ? null : 'text')), {
              more: inMore,
              color: true,
            })}
            {live && colorOpen === 'text' ? (
              <ColorPop colors={TEXT_COLORS} current={active.color} onPick={(hex) => pickColor('text', hex)} />
            ) : null}
          </span>
        );
      case 'background':
        return (
          <span className="rich-color-wrap">
            {button(
              '字的底色',
              colorOpen === 'back',
              false,
              live,
              () => setColorOpen((current) => (current === 'back' ? null : 'back')),
              { more: inMore, color: true },
            )}
            {live && colorOpen === 'back' ? (
              <ColorPop colors={BACKGROUND_COLORS} current={active.background} onPick={(hex) => pickColor('back', hex)} />
            ) : null}
          </span>
        );
      case 'left':
        return button('居左', active.align === 'left', false, live, () => {
          if (active.align === 'left') editor.chain().focus().unsetTextAlign().run();
          else editor.chain().focus().setTextAlign('left').run();
        });
      case 'center':
        return button('居中', active.align === 'center', false, live, () => {
          if (active.align === 'center') editor.chain().focus().unsetTextAlign().run();
          else editor.chain().focus().setTextAlign('center').run();
        });
      case 'right':
        return button('居右', active.align === 'right', false, live, () => {
          if (active.align === 'right') editor.chain().focus().unsetTextAlign().run();
          else editor.chain().focus().setTextAlign('right').run();
        });
      case 'heading':
        return (
          <select
            className="rich-select"
            aria-label="标题"
            tabIndex={live ? undefined : -1}
            value={active.heading}
            onChange={(event) => {
              const level = Number(event.target.value);
              if (!Number.isInteger(level) || level < 1 || level > 6) {
                editor.chain().focus().setParagraph().run();
                return;
              }
              editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
            }}
          >
            <option value="0">正文</option>
            <option value="1">标题 1</option>
            <option value="2">标题 2</option>
            <option value="3">标题 3</option>
            <option value="4">标题 4</option>
            <option value="5">标题 5</option>
            <option value="6">标题 6</option>
          </select>
        );
      case 'quote':
        return button('引用', active.quote, false, live, () => editor.chain().focus().toggleBlockquote().run());
      case 'bullet':
        return button('无序列表', active.bullet, false, live, () => editor.chain().focus().toggleBulletList().run());
      case 'ordered':
        return button('有序列表', active.ordered, false, live, () => editor.chain().focus().toggleOrderedList().run());
      case 'task':
        return button('任务列表', active.task, false, live, () => editor.chain().focus().toggleTaskList().run());
      case 'code': {
        const extra = languageValue !== '' && !CODE_LANGUAGES.includes(languageValue) ? languageValue : null;
        return (
          <span className="rich-tool-slot">
            {button('代码块', active.code, false, live, () => {
              if (active.code) {
                editor.chain().focus().toggleCodeBlock().run();
                return;
              }
              const chain = editor.chain().focus().toggleCodeBlock();
              if (rememberedLanguage !== '') chain.updateAttributes('codeBlock', { language: rememberedLanguage });
              chain.run();
            })}
            <select
              className="rich-select rich-select-lang"
              aria-label="代码语言"
              tabIndex={live ? undefined : -1}
              value={languageValue}
              onChange={(event) => {
                const next = event.target.value;
                setRememberedLanguage(next);
                if (editor.isActive('codeBlock')) {
                  editor.chain().focus().updateAttributes('codeBlock', { language: next === '' ? null : next }).run();
                }
              }}
            >
              <option value="">纯文本</option>
              {extra ? <option value={extra}>{extra}</option> : null}
              {CODE_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </select>
          </span>
        );
      }
      case 'link':
        return button('链接', linkOpen || active.link !== '', false, live, () => {
          setLinkHref(active.link);
          setLinkOpen((open) => !open);
          setMathOpen(false);
        });
      case 'image':
        return button('图片', false, false, live, () => fileRef.current?.click());
      case 'table':
        return button('表格', false, false, live, () =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
        );
      case 'rule':
        return button('分割线', false, false, live, () => editor.chain().focus().setHorizontalRule().run());
      case 'formula':
        return button('公式', mathOpen, false, live, () => {
          setMathOpen((open) => !open);
          setLinkOpen(false);
        });
      case 'mermaid':
        return button('Mermaid', false, false, live, () =>
          editor.chain().focus().insertContent({ type: 'mermaid', attrs: { source: '' } }).run(),
        );
      default:
        return null;
    }
  }

  const hidden = TOOLS.slice(visibleCount);

  return (
    <div
      className="rich-toolbar"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || (!moreOpen && colorOpen === null && !linkOpen && !mathOpen)) return;
        event.preventDefault();
        event.stopPropagation();
        setMoreOpen(false);
        setColorOpen(null);
        setLinkOpen(false);
        setMathOpen(false);
      }}
    >
      <div className={ready ? 'rich-bar is-ready' : 'rich-bar'} ref={barRef}>
        {TOOLS.slice(0, visibleCount).map((id) => (
          <span key={id} data-tool={id} className="rich-tool-slot">
            {renderTool(id, true)}
          </span>
        ))}
        {hidden.length > 0 ? (
          <span className="rich-more-wrap">
            <button
              type="button"
              className={moreOpen ? 'rich-tool is-on' : 'rich-tool'}
              aria-expanded={moreOpen}
              onMouseDown={keepSelection}
              onClick={() => setMoreOpen((open) => !open)}
            >
              更多
            </button>
            {moreOpen ? (
              <div className="rich-more">
                {hidden.map((id) => (
                  <span key={id} className="rich-tool-slot">
                    {renderTool(id, true, true)}
                  </span>
                ))}
              </div>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className="rich-measure" ref={measureRef} aria-hidden="true">
        {TOOLS.map((id) => (
          <span key={id} data-tool={id} className="rich-tool-slot">
            {renderTool(id, false)}
          </span>
        ))}
        <button type="button" data-more="" className="rich-tool" tabIndex={-1}>
          更多
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length > 0) props.onImages(files);
        }}
      />
      {active.inTable ? (
        <div className="rich-table-bar">
          {button('上加行', false, false, true, () => editor.chain().focus().addRowBefore().run())}
          {button('下加行', false, false, true, () => editor.chain().focus().addRowAfter().run())}
          {button('左加列', false, false, true, () => editor.chain().focus().addColumnBefore().run())}
          {button('右加列', false, false, true, () => editor.chain().focus().addColumnAfter().run())}
          {button('删行', false, false, true, () => editor.chain().focus().deleteRow().run())}
          {button('删列', false, false, true, () => editor.chain().focus().deleteColumn().run())}
          {button('合并', false, false, true, () => editor.chain().focus().mergeCells().run())}
          {button('拆分', false, false, true, () => editor.chain().focus().splitCell().run())}
          {button('表头行', false, false, true, () => editor.chain().focus().toggleHeaderRow().run())}
          {button('表头列', false, false, true, () => editor.chain().focus().toggleHeaderColumn().run())}
          <span className="rich-color-wrap">
            {button(
              '单元格底色',
              colorOpen === 'cell',
              false,
              true,
              () => setColorOpen((current) => (current === 'cell' ? null : 'cell')),
              { color: true },
            )}
            {colorOpen === 'cell' ? (
              <ColorPop colors={BACKGROUND_COLORS} current={active.cell} onPick={(hex) => pickColor('cell', hex)} />
            ) : null}
          </span>
          {button('删除表格', false, false, true, () => editor.chain().focus().deleteTable().run())}
        </div>
      ) : null}
      {linkOpen ? (
        <form
          className="rich-extra"
          onSubmit={(event) => {
            event.preventDefault();
            applyLink(editor, linkHref);
            setLinkOpen(false);
          }}
        >
          <input
            aria-label="链接地址"
            placeholder="链接地址"
            value={linkHref}
            onChange={(event) => setLinkHref(event.target.value)}
          />
          <button type="submit" onMouseDown={keepSelection}>
            确定
          </button>
        </form>
      ) : null}
      {mathOpen ? (
        <form
          className="rich-extra"
          onSubmit={(event) => {
            event.preventDefault();
            insertLatex(editor, latex);
            setLatex('');
            setMathOpen(false);
          }}
        >
          <textarea aria-label="LaTeX" placeholder="LaTeX" rows={2} value={latex} onChange={(event) => setLatex(event.target.value)} />
          <button type="submit" onMouseDown={keepSelection}>
            插入
          </button>
        </form>
      ) : null}
    </div>
  );
}
