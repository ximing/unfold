import { describe, expect, it } from 'vitest';
import {
  cardContentSchemas,
  cardSchema,
  createCardBodySchema,
  createCollectionBodySchema,
  createEdgeBodySchema,
  graphNodeSchema,
  placementsBodySchema,
  richDocSchema,
} from './index.js';

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

describe('createEdgeBodySchema', () => {
  const toId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

  it('rejects a blank label', () => {
    const blank = createEdgeBodySchema.safeParse({ fromId: ownerId, toId, label: '   ' });
    expect(blank.success).toBe(false);
    if (!blank.success) {
      expect(blank.error.issues.some((issue) => issue.message === '关系说明不能是空的')).toBe(true);
    }
    expect(createEdgeBodySchema.safeParse({ fromId: ownerId, toId, label: '' }).success).toBe(false);
  });

  it('trims a non-empty label', () => {
    expect(createEdgeBodySchema.parse({ fromId: ownerId, toId, label: '  前提  ' })).toEqual({
      fromId: ownerId,
      toId,
      label: '前提',
    });
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

describe('placementsBodySchema', () => {
  const nodeId = ownerId;

  it('rejects non-finite coordinates', () => {
    const body = (x: unknown, y: unknown = 0, z: unknown = 0) => ({
      placements: [{ nodeId, x, y, z }],
    });
    expect(placementsBodySchema.safeParse(body(Number.NaN)).success).toBe(false);
    expect(placementsBodySchema.safeParse(body(Number.POSITIVE_INFINITY)).success).toBe(false);
    expect(placementsBodySchema.safeParse(body(1, Number.NEGATIVE_INFINITY)).success).toBe(false);
    expect(placementsBodySchema.safeParse(body('1')).success).toBe(false);
    expect(placementsBodySchema.safeParse(body(1, 2, 1.5)).success).toBe(false);
  });

  it('accepts finite coordinates without a width', () => {
    expect(
      placementsBodySchema.parse({
        placements: [{ nodeId, x: 1.5, y: -2, z: 3 }],
      }),
    ).toEqual({
      placements: [{ nodeId, x: 1.5, y: -2, z: 3 }],
    });
  });
});

describe('graphNodeSchema', () => {
  it('accepts kind and an empty placement', () => {
    expect(
      graphNodeSchema.parse({
        id: ownerId,
        name: '点',
        description: '',
        kind: 'text',
        x: null,
        y: null,
        z: null,
        imageWidth: null,
        assetId: null,
        cardCount: 0,
        cardTypes: [],
      }),
    ).toMatchObject({
      kind: 'text',
      x: null,
      y: null,
      z: null,
      imageWidth: null,
      assetId: null,
    });
    expect(
      graphNodeSchema.parse({
        id: ownerId,
        name: '点',
        description: '',
        kind: 'image',
        x: 1.5,
        y: -2,
        z: 4,
        imageWidth: 220,
        assetId: ownerId,
        cardCount: 0,
        cardTypes: ['note', 'rich'],
      }),
    ).toMatchObject({ kind: 'image', x: 1.5, y: -2, z: 4, imageWidth: 220, assetId: ownerId });
  });
});

const emptyDoc = { type: 'doc' as const, content: [{ type: 'paragraph' as const }] };
const assetId = '550e8400-e29b-41d4-a716-446655440001';

describe('rich doc', () => {
  const valid = {
    type: 'doc' as const,
    content: [
      {
        type: 'heading' as const,
        attrs: { level: 2, textAlign: 'center' as const },
        content: [
          {
            type: 'text' as const,
            text: '题',
            marks: [
              { type: 'bold' as const },
              { type: 'italic' as const },
              { type: 'strike' as const },
              { type: 'code' as const },
              { type: 'underline' as const },
              { type: 'subscript' as const },
              { type: 'superscript' as const },
              {
                type: 'textStyle' as const,
                attrs: { color: '#AaBbCc', fontSize: '16' as const, backgroundColor: '' },
              },
              { type: 'link' as const, attrs: { href: 'https://example.com' } },
            ],
          },
        ],
      },
      {
        type: 'bulletList' as const,
        content: [
          {
            type: 'listItem' as const,
            content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: '一' }] }],
          },
        ],
      },
      {
        type: 'orderedList' as const,
        attrs: { textAlign: 'left' as const },
        content: [{ type: 'listItem' as const, content: [{ type: 'paragraph' as const }] }],
      },
      {
        type: 'taskList' as const,
        content: [
          {
            type: 'taskItem' as const,
            attrs: { checked: false },
            content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: '待办' }] }],
          },
        ],
      },
      {
        type: 'blockquote' as const,
        content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: '引' }] }],
      },
      {
        type: 'table' as const,
        content: [
          {
            type: 'tableRow' as const,
            content: [
              {
                type: 'tableHeader' as const,
                attrs: { colspan: 1, rowspan: 2, backgroundColor: '#d6e6f7' },
                content: [{ type: 'paragraph' as const }],
              },
              { type: 'tableCell' as const, content: [{ type: 'paragraph' as const }] },
            ],
          },
        ],
      },
      {
        type: 'codeBlock' as const,
        attrs: { language: 'ts' },
        content: [{ type: 'text' as const, text: 'const a = 1' }],
      },
      { type: 'blockMath' as const, attrs: { latex: 'x^2' } },
      { type: 'mermaid' as const, attrs: { source: 'graph TD' } },
      { type: 'image' as const, attrs: { src: assetId, alt: '图', width: null } },
      { type: 'horizontalRule' as const },
      {
        type: 'paragraph' as const,
        attrs: { textAlign: 'right' as const },
        content: [
          { type: 'text' as const, text: '甲' },
          { type: 'hardBreak' as const },
          { type: 'inlineMath' as const, attrs: { latex: 'y' } },
        ],
      },
    ],
  };

  it('accepts an empty document and a document that stays inside the whitelist', () => {
    expect(richDocSchema.parse(emptyDoc)).toEqual(emptyDoc);
    expect(richDocSchema.parse(valid)).toEqual(valid);
    expect(
      createCardBodySchema.parse({
        ownerKind: 'node',
        ownerId,
        type: 'rich',
        content: { doc: emptyDoc },
      }),
    ).toEqual({ ownerKind: 'node', ownerId, type: 'rich', content: { doc: emptyDoc } });
    expect(cardContentSchemas.rich.parse({ doc: emptyDoc, plain: '不要' })).toEqual({ doc: emptyDoc });
    expect(
      cardSchema.parse({
        id: ownerId,
        ownerKind: 'node',
        ownerId,
        type: 'rich',
        position: 0,
        content: { doc: emptyDoc, plain: '' },
      }),
    ).toMatchObject({ type: 'rich', content: { plain: '' } });
    expect(
      cardSchema.parse({
        id: ownerId,
        ownerKind: 'node',
        ownerId,
        type: 'note',
        position: 0,
        content: { body: '甲' },
      }),
    ).toMatchObject({ type: 'note', content: { body: '甲' } });
  });

  it('rejects plain on create, unknown nodes, unknown marks, and extra attributes', () => {
    expect(
      createCardBodySchema.safeParse({
        ownerKind: 'node',
        ownerId,
        type: 'rich',
        content: { doc: emptyDoc, plain: '' },
      }).success,
    ).toBe(false);
    expect(richDocSchema.safeParse({ type: 'paragraph' }).success).toBe(false);
    expect(richDocSchema.safeParse({ type: 'doc', content: [{ type: 'foo' }] }).success).toBe(false);
    expect(
      richDocSchema.safeParse({
        type: 'doc',
        content: [{ type: 'paragraph', attrs: { textAlign: 'left', indent: 1 } }],
      }).success,
    ).toBe(false);
    expect(
      richDocSchema.safeParse({
        type: 'doc',
        content: [{ type: 'orderedList', attrs: { start: 1 } }],
      }).success,
    ).toBe(false);
    expect(
      richDocSchema.safeParse({
        type: 'doc',
        content: [{ type: 'tableCell', attrs: { colwidth: [100] } }],
      }).success,
    ).toBe(false);
    expect(
      richDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'a', marks: [{ type: 'link', attrs: { href: 'x', target: '_blank' } }] }],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      richDocSchema.safeParse({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a', marks: [{ type: 'highlight' }] }] }],
      }).success,
    ).toBe(false);
    expect(richDocSchema.safeParse({ type: 'doc', content: [{ type: 'heading', attrs: { level: 7 } }] }).success).toBe(
      false,
    );
    expect(richDocSchema.safeParse({ type: 'doc', content: [{ type: 'heading', attrs: { level: 0 } }] }).success).toBe(
      false,
    );
    expect(
      richDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'a', marks: [{ type: 'textStyle', attrs: { color: '#abc', fontSize: '17' } }] }],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      richDocSchema.safeParse({
        type: 'doc',
        content: [{ type: 'image', attrs: { src: assetId, alt: '图', width: 31 } }],
      }).success,
    ).toBe(false);
    expect(
      richDocSchema.safeParse({
        type: 'doc',
        content: [{ type: 'image', attrs: { src: assetId, width: 1200 } }],
      }).success,
    ).toBe(true);
    expect(
      richDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'a', marks: [{ type: 'link', attrs: { href: 'x'.repeat(2001) } }] }],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      richDocSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'a', marks: [{ type: 'link', attrs: { href: 'x'.repeat(2000) } }] }],
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      cardSchema.safeParse({
        id: ownerId,
        ownerKind: 'node',
        ownerId,
        type: 'rich',
        position: 0,
        content: { doc: emptyDoc },
      }).success,
    ).toBe(false);
  });
});
