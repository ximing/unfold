import { describe, expect, it } from 'vitest';
import { looksLikeMarkdown } from './signals.js';
import { markdownToHtml } from './to-html.js';

describe('looksLikeMarkdown', () => {
  it('treats headings, fences, tables, and display math as markdown', () => {
    expect(looksLikeMarkdown('# 标题\n\n正文', '<p>正文</p>')).toBe(true);
    expect(looksLikeMarkdown('```js\nconst n = 1;\n```', '<pre>const n = 1;</pre>')).toBe(true);
    expect(looksLikeMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |', '<table></table>')).toBe(true);
    expect(looksLikeMarkdown('$$\nE=mc^2\n$$', '')).toBe(true);
  });

  it('keeps rich html when the plain text is only a bold word', () => {
    expect(looksLikeMarkdown('这是 **状态**', '<p>这是 <strong>状态</strong></p>')).toBe(false);
  });

  it('parses inline markdown when there is no rich html', () => {
    expect(looksLikeMarkdown('这是 **状态**', '')).toBe(true);
  });
});

describe('markdownToHtml', () => {
  it('emits a table, a javascript fence, and math nodes', () => {
    const html = markdownToHtml(
      [
        '| 历史 | 未来 |',
        '| --- | --- |',
        '| A | 剩余 |',
        '',
        '```javascript',
        'const n = 1;',
        '```',
        '',
        '能量 $E=mc^2$。',
        '',
        '$$',
        '\\int_0^1 x\\,dx',
        '$$',
        '',
        '```mermaid',
        'flowchart LR',
        '  A-->B',
        '```',
      ].join('\n'),
    );
    expect(html).toContain('<th>历史</th>');
    expect(html).toContain('<td>剩余</td>');
    expect(html).toContain('class="language-javascript"');
    expect(html).toContain('data-latex="E=mc^2"');
    expect(html).toContain('data-latex="\\int_0^1 x\\,dx"');
    expect(html).toContain('data-type="mermaid"');
    expect(html).toContain('A--&gt;B');
  });
});
