import { describe, expect, it } from 'vitest';
import { clip, likePattern, readable, snippetOf, stripTags } from './search-text.js';

describe('likePattern', () => {
  it('escapes backslash, percent, and underscore, and wraps every other character unchanged', () => {
    expect(likePattern('plain 算.?*[]()\'"')).toBe('%plain 算.?*[]()\'"%');
    expect(likePattern('a\\b%c_d')).toBe('%a\\\\b\\%c\\_d%');
    expect(likePattern('\\%_')).toBe('%\\\\\\%\\_%');
  });
});

describe('clip', () => {
  it('keeps a plain string at 80 characters when it is longer', () => {
    expect(clip('a'.repeat(100))).toBe('a'.repeat(80));
    expect(clip('a'.repeat(100))).toHaveLength(80);
    expect(clip('short')).toBe('short');
  });

  it('counts one emoji as one code point and does not split it', () => {
    const emoji = '😀';
    expect(emoji.length).toBe(2);
    expect([...emoji]).toHaveLength(1);

    const around = `${'a'.repeat(79)}${emoji}z`;
    expect(clip(around)).toBe(`${'a'.repeat(79)}${emoji}`);
    expect([...clip(around)]).toHaveLength(80);
    expect(clip(around)).not.toBe(around.slice(0, 80));

    expect(clip(emoji.repeat(81))).toBe(emoji.repeat(80));
    expect([...clip(emoji.repeat(81))]).toHaveLength(80);
  });
});

describe('readable', () => {
  it('joins only string fields of a JSON object and strips HTML tags', () => {
    const card = JSON.stringify({
      title: '<b>Hello</b>',
      count: 99,
      note: null,
      nested: { inner: 'skip-me' },
      items: ['also-skip'],
      flag: false,
      extra: '<p>World</p>&nbsp;ok',
    });
    expect(readable(card)).toBe('Hello World ok');
    expect(readable(card)).not.toContain('99');
    expect(readable(card)).not.toContain('skip-me');
    expect(readable(card)).not.toContain('also-skip');
  });

  it('returns the original text when a JSON object has no string fields', () => {
    const card = '{"count":1,"ok":false}';
    expect(readable(card)).toBe(card);
  });

  it('returns the original text for invalid JSON', () => {
    expect(readable('not json {')).toBe('not json {');
    expect(readable('<b>raw</b>')).toBe('<b>raw</b>');
  });

  it('returns the original text for arrays and non-objects', () => {
    const arrayText = '["<b>hi</b>","there"]';
    expect(readable(arrayText)).toBe(arrayText);
    expect(readable('"a string"')).toBe('"a string"');
    expect(readable('42')).toBe('42');
    expect(readable('null')).toBe('null');
    expect(readable('true')).toBe('true');
  });
});

describe('stripTags', () => {
  it('replaces tags and named entities with spaces, then trims', () => {
    expect(stripTags('  <b>Hi</b>&nbsp;<i>there</i>  ')).toBe('Hi there');
  });
});

describe('snippetOf', () => {
  it('returns the clipped name on a case-insensitive name hit even when the card contains the query', () => {
    const name = `Memo${'n'.repeat(80)}`;
    const card = JSON.stringify({ body: '<p>memoization lives in the card</p>' });
    expect(snippetOf(name, card, 'MEMO')).toBe(`Memo${'n'.repeat(76)}`);
    expect(snippetOf('Memoization', card, 'memo')).toBe('Memoization');
    expect(snippetOf('Memoization', card, 'memo')).not.toContain('lives in the card');
  });

  it('uses readable card text when the name does not match', () => {
    const card = JSON.stringify({
      title: '<b>算法</b>',
      count: 3,
      note: '<i>笔记</i>',
    });
    expect(snippetOf('Other', card, '算法')).toBe('算法 笔记');

    const longCard = JSON.stringify({ body: `<p>${'字'.repeat(90)}</p>` });
    expect(snippetOf('Other', longCard, '不在点名')).toBe('字'.repeat(80));
  });

  it('falls back to the clipped name when card text is empty', () => {
    const name = `点${'名'.repeat(90)}`;
    expect(snippetOf(name, null, '没有')).toBe(`点${'名'.repeat(79)}`);
    expect(snippetOf('点名', '', '没有')).toBe('点名');
  });
});
