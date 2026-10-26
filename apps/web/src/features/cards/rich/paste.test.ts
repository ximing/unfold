import { richDocSchema } from '@unfold/dto';
import { describe, expect, it } from 'vitest';
import { normalizeColor, normalizeFontSize } from './palette.js';
import { htmlHasFormatting, preparePastedHtml } from './paste-html.js';
import { markdownFromClipboard } from './paste-insert.js';
import { pasteMarkdown } from './paste.js';

function clip(data: Record<string, string>): DataTransfer {
  return { getData: (type: string) => data[type] ?? '' } as DataTransfer;
}

function doc(source: string) {
  const parsed = pasteMarkdown(source);
  expect(parsed).not.toBeNull();
  expect(richDocSchema.safeParse(parsed).success).toBe(true);
  return parsed!;
}

describe('pasteMarkdown', () => {
  it('普通文本不改写', () => {
    expect(pasteMarkdown('今天没有标记')).toBeNull();
    expect(pasteMarkdown('甲\n乙')).toBeNull();
    expect(pasteMarkdown('花了 $12.50 元')).toBeNull();
    expect(pasteMarkdown('a_b_c')).toBeNull();
    expect(pasteMarkdown('2 * 3 * 4')).toBeNull();
  });

  it('标题去掉井号', () => {
    expect(doc('# 标题').content).toEqual([{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '标题' }] }]);
    expect(doc('### 三级').content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 3 } });
    expect(JSON.stringify(doc('###### 六级'))).not.toContain('#');
  });

  it('列表去掉记号', () => {
    expect(doc('- 甲\n- 乙').content).toEqual([
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '乙' }] }] },
        ],
      },
    ]);
    expect(doc('1. 第一步\n2. 第二步').content?.[0]?.type).toBe('orderedList');
    expect(JSON.stringify(doc('1. 第一步\n2. 第二步'))).not.toContain('1.');
    expect(doc('- [ ] 待办\n- [x] 完成').content).toEqual([
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '待办' }] }],
          },
          {
            type: 'taskItem',
            attrs: { checked: true },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '完成' }] }],
          },
        ],
      },
    ]);
  });

  it('引用去掉大于号', () => {
    const parsed = doc('> 引言\n> 下一句');
    expect(parsed.content?.[0]?.type).toBe('blockquote');
    expect(JSON.stringify(parsed)).not.toContain('>');
    expect(JSON.stringify(parsed)).toContain('引言');
  });

  it('代码块保留源码并去掉围栏', () => {
    expect(doc('```ts\nconst a = 1\n```').content).toEqual([
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const a = 1' }] },
    ]);
    const raw = doc('```\n# 不是标题\n```');
    expect(raw.content?.[0]).toMatchObject({ type: 'codeBlock', content: [{ type: 'text', text: '# 不是标题' }] });
  });

  it('表格变成表头和单元格', () => {
    expect(doc('| 名 | 值 |\n| --- | --- |\n| 甲 | 乙 |').content).toEqual([
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '名' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '值' }] }] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '乙' }] }] },
            ],
          },
        ],
      },
    ]);
  });

  it('公式按块级或行内落点', () => {
    expect(doc('$$a^2+b^2$$').content).toEqual([{ type: 'blockMath', attrs: { latex: 'a^2+b^2' } }]);
    expect(doc('$$\n\\\\int_0^1 x dx\n$$').content).toEqual([{ type: 'blockMath', attrs: { latex: '\\\\int_0^1 x dx' } }]);
    expect(doc('$E=mc^2$').content).toEqual([{ type: 'blockMath', attrs: { latex: 'E=mc^2' } }]);
    expect(doc('能量 $E=mc^2$ 结束').content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '能量 ' },
          { type: 'inlineMath', attrs: { latex: 'E=mc^2' } },
          { type: 'text', text: ' 结束' },
        ],
      },
    ]);
  });

  it('行内记号转成格式，文字留下', () => {
    expect(doc('这是 **粗体**、*斜体*、~~删除~~ 和 `代码`').content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '这是 ' },
          { type: 'text', text: '粗体', marks: [{ type: 'bold' }] },
          { type: 'text', text: '、' },
          { type: 'text', text: '斜体', marks: [{ type: 'italic' }] },
          { type: 'text', text: '、' },
          { type: 'text', text: '删除', marks: [{ type: 'strike' }] },
          { type: 'text', text: ' 和 ' },
          { type: 'text', text: '代码', marks: [{ type: 'code' }] },
        ],
      },
    ]);
    expect(doc('***粗斜***').content?.[0]?.content).toEqual([
      { type: 'text', text: '粗斜', marks: [{ type: 'bold' }, { type: 'italic' }] },
    ]);
    expect(doc('[Unfold](https://example.com/a)').content?.[0]?.content).toEqual([
      { type: 'text', text: 'Unfold', marks: [{ type: 'link', attrs: { href: 'https://example.com/a' } }] },
    ]);
    expect(doc('看 ![图](https://example.com/a.png)').content?.[0]?.content).toEqual([
      { type: 'text', text: '看 ' },
      { type: 'text', text: '图', marks: [{ type: 'link', attrs: { href: 'https://example.com/a.png' } }] },
    ]);
    const unsafe = JSON.stringify(doc('# 标题\n[点](javascript:alert(1))'));
    expect(unsafe).toContain('[点](javascript:alert(1))');
    expect(unsafe).not.toContain('"href":"javascript:alert(1)"');
    expect(unsafe).toContain('"type":"heading"');
  });

  it('整篇粘贴不丢段落', () => {
    const source = ['# 标题', '', '一段 **粗体** 和 [链接](https://example.com)。', '', '- 甲', '- 乙', '', '> 引用', '', '```ts', 'const a = 1', '```', '', '```mermaid', 'graph TD', 'A-->B', '```'].join('\n');
    const parsed = doc(source);
    const flat = JSON.stringify(parsed);
    for (const word of ['标题', '一段 ', '粗体', '链接', '甲', '乙', '引用', 'const a = 1', 'graph TD']) {
      expect(flat).toContain(word);
    }
    expect(flat).not.toContain('**');
    expect(flat).not.toContain('```');
    expect(parsed.content?.some((node) => node.type === 'mermaid')).toBe(true);
    expect(parsed.content?.some((node) => node.type === 'codeBlock')).toBe(true);
  });
});

describe('富文本粘贴保留格式', () => {
  it('HTML 已有格式时不用纯文本覆盖', () => {
    const html = '<ul><li><span style="color:#b3402a;font-weight:700">红色</span></li></ul>';
    expect(htmlHasFormatting(html)).toBe(true);
    expect(htmlHasFormatting('<img data-rich-image src="/api/assets/x">')).toBe(true);
    expect(htmlHasFormatting('<div data-type="block-math" data-latex="a"></div>')).toBe(true);
    expect(markdownFromClipboard(clip({ 'text/html': html, 'text/plain': '- 红色', 'text/markdown': '- 红色' }))).toBeNull();
  });

  it('没有 HTML 格式时仍解析 Markdown', () => {
    expect(htmlHasFormatting('<p>**甲**</p>')).toBe(false);
    const parsed = markdownFromClipboard(clip({ 'text/html': '<p>**甲**</p>', 'text/plain': '**甲**' }));
    expect(parsed?.content?.[0]).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'text', text: '甲', marks: [{ type: 'bold' }] }],
    });
    expect(markdownFromClipboard(clip({ 'text/markdown': '# 标题' }))?.content?.[0]).toMatchObject({
      type: 'heading',
      attrs: { level: 1 },
    });
  });

  it('font 标签和 pt 字号收成编辑器能认的样式', () => {
    const html = preparePastedHtml('<font color="red" size="4">红</font><span style="font-size: 14pt !important">大</span>');
    expect(html).toContain('color: #ff0000');
    expect(html).toContain('font-size: 18px');
    expect(html).not.toContain('<font');
    expect(html).not.toContain('!important');
    expect(preparePastedHtml('<p>font-size: 14pt</p>')).toContain('font-size: 14pt');
    expect(normalizeFontSize('11pt')).toBe('15');
    expect(normalizeFontSize('18px')).toBe('18');
    expect(normalizeFontSize('14.666px')).toBe('15');
    expect(normalizeColor('red')).toBe('#ff0000');
    expect(normalizeColor('rgb(179, 64, 42)')).toBe('#b3402a');
  });
});
