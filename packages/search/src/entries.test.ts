import { describe, expect, it } from 'vitest';
import { blockEntries, objectEntry } from './index.js';

describe('objectEntry', () => {
  it('sets id, kind, text, and promote, and copies aliases', () => {
    const aliases = ['状态等价', 'state equivalence'];
    const entry = objectEntry({
      userId: 'user-1',
      objectId: 'obj-1',
      domain: '算法',
      title: '状态等价',
      aliases,
      core: '两个状态对后续决策不可区分',
    });

    expect(entry.id).toBe('object:obj-1');
    expect(entry.kind).toBe('object');
    expect(entry.entityId).toBe('obj-1');
    expect(entry.objectId).toBe('obj-1');
    expect(entry.collectionId).toBeNull();
    expect(entry.text).toBe('');
    expect(entry.promote).toBe(false);
    expect(entry.aliases).toEqual(['状态等价', 'state equivalence']);
    expect(entry.aliases).not.toBe(aliases);

    aliases.push('extra');
    expect(entry.aliases).toEqual(['状态等价', 'state equivalence']);
  });
});

describe('blockEntries', () => {
  const base = {
    userId: 'user-1',
    domain: '算法',
    title: '状态等价',
    core: '两个状态对后续决策不可区分',
  };

  it('drops empty text, whitespace, object_ref, and collection_ref', () => {
    const entries = blockEntries({
      ...base,
      ownerType: 'object',
      ownerId: 'obj-1',
      blocks: [
        { blockId: 'empty', blockType: 'paragraph', text: '' },
        { blockId: 'blank', blockType: 'paragraph', text: ' \n\t ' },
        { blockId: 'ref-object', blockType: 'object_ref', text: 'obj-9' },
        { blockId: 'ref-collection', blockType: 'collection_ref', text: 'col-9' },
        { blockId: 'kept', blockType: 'paragraph', text: '  保留这一句  ' },
      ],
    });

    expect(entries.map((entry) => entry.id)).toEqual(['block:kept']);
    expect(entries[0]?.text).toBe('保留这一句');
  });

  it('indexes an object paragraph as a block owned by the object', () => {
    const entries = blockEntries({
      ...base,
      ownerType: 'object',
      ownerId: 'obj-1',
      blocks: [{ blockId: 'para-1', blockType: 'paragraph', text: '一段说明' }],
    });

    expect(entries).toEqual([
      {
        id: 'block:para-1',
        kind: 'block',
        entityId: 'para-1',
        userId: 'user-1',
        objectId: 'obj-1',
        collectionId: null,
        domain: '算法',
        title: '状态等价',
        aliases: [],
        core: '两个状态对后续决策不可区分',
        text: '一段说明',
        promote: false,
      },
    ]);
  });

  it('uses question and decision kinds with their id prefixes', () => {
    const entries = blockEntries({
      ...base,
      ownerType: 'object',
      ownerId: 'obj-1',
      blocks: [
        { blockId: 'q-1', blockType: 'question', text: '为何等价？' },
        { blockId: 'd-1', blockType: 'decision', text: '采用划分法' },
      ],
    });

    expect(entries.map((entry) => ({ id: entry.id, kind: entry.kind }))).toEqual([
      { id: 'question:q-1', kind: 'question' },
      { id: 'decision:d-1', kind: 'decision' },
    ]);
    expect(entries.every((entry) => entry.promote === false)).toBe(true);
    expect(entries.every((entry) => entry.objectId === 'obj-1' && entry.collectionId === null)).toBe(
      true,
    );
  });

  it('promotes a collection paragraph as a collection sentence', () => {
    const entries = blockEntries({
      ...base,
      ownerType: 'collection',
      ownerId: 'col-1',
      title: '状态等价与压缩',
      blocks: [{ blockId: 'sent-1', blockType: 'paragraph', text: '可提升的原句' }],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'collection_sentence:sent-1',
      kind: 'collection_sentence',
      promote: true,
      collectionId: 'col-1',
      objectId: null,
      text: '可提升的原句',
    });
  });

  it('keeps a question inside a collection as a question', () => {
    const entries = blockEntries({
      ...base,
      ownerType: 'collection',
      ownerId: 'col-1',
      title: '状态等价与压缩',
      blocks: [{ blockId: 'q-2', blockType: 'question', text: '合集里还成立吗？' }],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'question:q-2',
      kind: 'question',
      promote: false,
      collectionId: 'col-1',
      objectId: null,
    });
  });
});
