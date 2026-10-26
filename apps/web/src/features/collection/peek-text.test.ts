import type { Card } from '@unfold/dto';
import { describe, expect, it } from 'vitest';
import { peekText } from './peek-text.js';

const id = '550e8400-e29b-41d4-a716-446655440000';

function richCard(plain: string): Card {
  return {
    id,
    ownerKind: 'node',
    ownerId: id,
    type: 'rich',
    position: 0,
    content: {
      doc: { type: 'doc', content: [{ type: 'paragraph' }] },
      plain,
    },
  };
}

describe('peekText', () => {
  it('只用 plain，不把 doc 摊开', () => {
    const text = peekText([richCard('正文甲')]);
    expect(text).toBe('正文甲');
    expect(text.includes('doc')).toBe(false);
    expect(text.includes('type')).toBe(false);
  });

  it('笔记仍取字符串并去掉标签', () => {
    const note: Card = {
      id,
      ownerKind: 'node',
      ownerId: id,
      type: 'note',
      position: 0,
      content: { body: '<p>甲</p>' },
    };
    expect(peekText([note])).toBe('甲');
  });
});
