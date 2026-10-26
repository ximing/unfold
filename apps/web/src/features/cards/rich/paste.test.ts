import { richDocSchema } from '@unfold/dto';
import { describe, expect, it } from 'vitest';
import { pasteMarkdown } from './paste.js';

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
});
