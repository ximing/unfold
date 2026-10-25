import { describe, expect, it } from 'vitest';
import { createCardBodySchema, createCollectionBodySchema } from './index.js';

const ownerId = '550e8400-e29b-41d4-a716-446655440000';

describe('createCollectionBodySchema', () => {
  it('rejects an empty title', () => {
    expect(createCollectionBodySchema.safeParse({ title: '' }).success).toBe(false);
    expect(createCollectionBodySchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(createCollectionBodySchema.safeParse({ title: 'a'.repeat(81) }).success).toBe(false);
    expect(createCollectionBodySchema.safeParse({}).success).toBe(false);
  });

  it('trims a title down to 80 characters', () => {
    expect(createCollectionBodySchema.parse({ title: '  合集  ' }).title).toBe('合集');
    expect(createCollectionBodySchema.parse({ title: `  ${'a'.repeat(80)}  ` }).title).toBe('a'.repeat(80));
  });
});

describe('createCardBodySchema', () => {
  const samples = [
    { type: 'note', content: { body: '' } },
    { type: 'code', content: { language: 'ts', source: '' } },
    { type: 'formula', content: { latex: '' } },
    { type: 'person', content: { identity: '', note: '' } },
    { type: 'event', content: { when: '', where: '', summary: '' } },
    { type: 'place', content: { note: '' } },
    { type: 'period', content: { start: '', end: '', note: '' } },
    { type: 'group', content: { note: '' } },
  ] as const;

  it('accepts all eight card types, including empty strings', () => {
    for (const sample of samples) {
      expect(createCardBodySchema.parse({ ownerKind: 'node', ownerId, ...sample })).toEqual({
        ownerKind: 'node',
        ownerId,
        ...sample,
      });
    }
  });

  it('rejects card content with the wrong fields', () => {
    expect(
      createCardBodySchema.safeParse({
        ownerKind: 'node',
        ownerId,
        type: 'note',
        content: { body: 'x', extra: 'nope' },
      }).success,
    ).toBe(false);
    expect(
      createCardBodySchema.safeParse({
        ownerKind: 'edge',
        ownerId,
        type: 'event',
        content: { when: '昨天' },
      }).success,
    ).toBe(false);
    expect(
      createCardBodySchema.safeParse({
        ownerKind: 'node',
        ownerId,
        type: 'formula',
        content: { latex: 1 },
      }).success,
    ).toBe(false);
    expect(
      createCardBodySchema.safeParse({
        ownerKind: 'node',
        ownerId,
        type: 'topic',
        content: {},
      }).success,
    ).toBe(false);
  });
});
