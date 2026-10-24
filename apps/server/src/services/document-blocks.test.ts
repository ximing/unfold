import type { PmNode } from '@unfold/doc-schema';
import { describe, expect, it } from 'vitest';
import { assignBlockIds, collectBlockIndex, documentNodesAllowed } from './document-blocks.js';

const externalId = '11111111-1111-4111-8111-111111111111';

function twoParagraphs(): PmNode {
  return {
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { id: externalId }, content: [{ type: 'text', text: '甲' }] },
      { type: 'paragraph', attrs: { id: externalId }, content: [{ type: 'text', text: '乙' }] },
    ],
  };
}

function paragraphIds(content: PmNode): [string, string] {
  const first = content.content?.[0]?.attrs?.id;
  const second = content.content?.[1]?.attrs?.id;
  if (typeof first !== 'string' || typeof second !== 'string') throw new Error('missing id');
  return [first, second];
}

describe('assignBlockIds', () => {
  it('replaces both copies of an external id when keep is empty', () => {
    const [first, second] = paragraphIds(assignBlockIds(twoParagraphs(), new Set()));
    expect(first).not.toBe(externalId);
    expect(second).not.toBe(externalId);
    expect(first).not.toBe(second);
  });

  it('keeps the first id and replaces the duplicate when the id is in keep', () => {
    const [first, second] = paragraphIds(assignBlockIds(twoParagraphs(), new Set([externalId])));
    expect(first).toBe(externalId);
    expect(second).not.toBe(externalId);
    expect(second).not.toBe(first);
  });

  it('does not give a text node an id', () => {
    const next = assignBlockIds(
      {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '你好' }] }],
      },
      new Set(),
    );
    const text = next.content?.[0]?.content?.[0];
    expect(text?.type).toBe('text');
    expect(text?.attrs).toBeUndefined();
  });
});

describe('collectBlockIndex', () => {
  it('uses objectId, not label, as the object_ref preview', () => {
    const rows = collectBlockIndex({
      type: 'doc',
      content: [
        {
          type: 'object_ref',
          attrs: { id: externalId, objectId: 'obj-1', label: '状态等价' },
        },
      ],
    });
    expect(rows[0]?.textPreview).toBe('obj-1');
    expect(rows[0]?.textPreview).not.toBe('状态等价');
  });

  it('previews a theorem from its proposition', () => {
    const rows = collectBlockIndex({
      type: 'doc',
      content: [
        {
          type: 'theorem',
          attrs: { id: externalId, proposition: '可导则连续' },
        },
      ],
    });
    expect(rows[0]?.textPreview).toContain('可导则连续');
  });

  it('uses the paragraph text as the preview', () => {
    const rows = collectBlockIndex({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: externalId },
          content: [{ type: 'text', text: '你好' }],
        },
      ],
    });
    expect(rows[0]?.textPreview).toBe('你好');
  });
});

describe('documentNodesAllowed', () => {
  it('rejects a script node and a script mark, and allows bold', () => {
    expect(documentNodesAllowed({ type: 'script' })).toBe(false);
    expect(documentNodesAllowed({ type: 'paragraph', marks: [{ type: 'script' }] })).toBe(false);
    expect(documentNodesAllowed({ type: 'paragraph', marks: [{ type: 'bold' }] })).toBe(true);
    expect(
      documentNodesAllowed({
        type: 'paragraph',
        content: [{ type: 'text', text: '你好', marks: [{ type: 'bold' }] }],
      }),
    ).toBe(true);
  });

  it('allows a theorem node', () => {
    expect(documentNodesAllowed({ type: 'theorem', attrs: { proposition: '可导则连续' } })).toBe(true);
  });
});
