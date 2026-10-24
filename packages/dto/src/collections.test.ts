import { describe, expect, it } from 'vitest';
import {
  collectionDetailSchema,
  collectionListSchema,
  collectionRefBodySchema,
  collectionSchema,
  createCollectionBodySchema,
  type Collection,
  type CollectionDetail,
  type CollectionList,
  type CollectionRefBody,
  type CreateCollectionBody,
} from './index.js';

const domainId = '550e8400-e29b-41d4-a716-446655440000';
const collectionId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const parentId = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

describe('createCollectionBodySchema', () => {
  it('rejects a blank or overlong title and defaults a missing intent to an empty string', () => {
    expect(createCollectionBodySchema.safeParse({ domainId, title: '   ' }).success).toBe(false);
    expect(createCollectionBodySchema.safeParse({ domainId, title: '' }).success).toBe(false);
    expect(
      createCollectionBodySchema.safeParse({ domainId, title: 'a'.repeat(201) }).success,
    ).toBe(false);

    const parsed = createCollectionBodySchema.parse({
      domainId,
      title: `  ${'a'.repeat(200)}  `,
      parentCollectionId: parentId,
    });
    const body = {
      domainId,
      title: 'a'.repeat(200),
      intent: '',
      parentCollectionId: parentId,
    } satisfies CreateCollectionBody;
    expect(parsed).toEqual(body);
  });

  it('accepts a null parentCollectionId', () => {
    const parsed = createCollectionBodySchema.parse({
      domainId,
      title: '线性代数',
      intent: '  复习主线  ',
      parentCollectionId: null,
    });
    const body = {
      domainId,
      title: '线性代数',
      intent: '复习主线',
      parentCollectionId: null,
    } satisfies CreateCollectionBody;
    expect(parsed).toEqual(body);
  });
});

describe('collectionRefBodySchema', () => {
  it('parses add, rejects a move without position, and rejects merge', () => {
    const objectId = '6ba7b812-9dad-11d1-80b4-00c04fd430c8';
    const parsed = collectionRefBodySchema.parse({ op: 'add', objectId });
    const body = { op: 'add', objectId } satisfies CollectionRefBody;
    expect(parsed).toEqual(body);
    expect(collectionRefBodySchema.safeParse({ op: 'move', objectId }).success).toBe(false);
    expect(collectionRefBodySchema.safeParse({ op: 'merge', objectId }).success).toBe(false);
  });
});

describe('collectionSchema', () => {
  it('parses a collection whose parent is null', () => {
    const collection = {
      id: collectionId,
      domainId,
      title: '线性代数',
      intent: '',
      parentCollectionId: null,
      position: 0,
      documentId: null,
    } satisfies Collection;
    expect(collectionSchema.parse(collection)).toEqual(collection);
    expect(collectionSchema.safeParse({ ...collection, position: -1 }).success).toBe(false);

    const list = { collections: [collection] } satisfies CollectionList;
    expect(collectionListSchema.parse(list)).toEqual(list);
  });
});

describe('collectionDetailSchema', () => {
  it('parses a pending confirmation and rejects any other message', () => {
    const objectId = '6ba7b812-9dad-11d1-80b4-00c04fd430c8';
    const detail = {
      id: collectionId,
      domainId,
      title: '线性代数',
      intent: '',
      parentCollectionId: null,
      position: 0,
      documentId: null,
      pending: [{ objectId, message: '核心定义已更新，待确认' }],
    } satisfies CollectionDetail;
    expect(collectionDetailSchema.parse(detail)).toEqual(detail);
    expect(
      collectionDetailSchema.safeParse({
        ...detail,
        pending: [{ objectId, message: '定义改了' }],
      }).success,
    ).toBe(false);
  });
});
