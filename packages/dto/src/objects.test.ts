import { describe, expect, it } from 'vitest';
import {
  createDomainBodySchema,
  createObjectBodySchema,
  documentBodySchema,
  documentResponseSchema,
  domainListSchema,
  domainSchema,
  objectSummarySchema,
  updateObjectBodySchema,
  type CreateDomainBody,
  type CreateObjectBody,
  type DocumentBody,
  type DocumentResponse,
  type Domain,
  type DomainList,
  type ObjectSummary,
  type UpdateObjectBody,
} from './index.js';

const domainId = '550e8400-e29b-41d4-a716-446655440000';
const objectId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('createObjectBodySchema', () => {
  it('accepts an empty core statement', () => {
    const body = {
      domainId,
      type: 'concept',
      canonicalName: '状态等价',
      coreStatement: '',
    } satisfies CreateObjectBody;
    expect(createObjectBodySchema.parse(body)).toEqual(body);
  });
});

describe('updateObjectBodySchema', () => {
  it('rejects an empty object', () => {
    expect(updateObjectBodySchema.safeParse({}).success).toBe(false);
  });

  it('accepts one field and rejects an empty alias', () => {
    const body = { coreStatement: '' } satisfies UpdateObjectBody;
    expect(updateObjectBodySchema.parse(body)).toEqual(body);
    expect(updateObjectBodySchema.safeParse({ aliases: [''] }).success).toBe(false);
  });
});

describe('domainSchema', () => {
  it('rejects a negative free count', () => {
    const domain = { id: domainId, name: '算法', freeCount: 0 } satisfies Domain;
    expect(domainSchema.parse(domain)).toEqual(domain);
    expect(domainSchema.safeParse({ ...domain, freeCount: -1 }).success).toBe(false);
    expect(domainSchema.safeParse({ ...domain, freeCount: 1.5 }).success).toBe(false);
  });
});

describe('createDomainBodySchema', () => {
  it('requires a name', () => {
    const body = { name: '算法' } satisfies CreateDomainBody;
    expect(createDomainBodySchema.parse(body)).toEqual(body);
    expect(createDomainBodySchema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('domainListSchema', () => {
  it('parses a domain list', () => {
    const list = {
      domains: [{ id: domainId, name: '算法', freeCount: 2 }],
    } satisfies DomainList;
    expect(domainListSchema.parse(list)).toEqual(list);
  });
});

describe('objectSummarySchema', () => {
  it('parses an active object', () => {
    const summary = {
      id: objectId,
      type: 'principle',
      domainId,
      domainName: '算法',
      canonicalName: '状态等价',
      normalizedName: '状态等价',
      coreStatement: '',
      coreVersion: 0,
      status: 'active',
      aliases: ['同一状态'],
    } satisfies ObjectSummary;
    expect(objectSummarySchema.parse(summary)).toEqual(summary);
  });
});

describe('documentBodySchema', () => {
  it('rejects content that is missing type', () => {
    const body = {
      schemaVersion: 1,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { id: objectId },
            content: [{ type: 'text', text: '同一状态' }],
          },
        ],
      },
      plainText: '同一状态',
    } satisfies DocumentBody;
    expect(documentBodySchema.parse(body)).toEqual(body);
    expect(documentBodySchema.safeParse({ ...body, content: { content: [] } }).success).toBe(false);
    expect(documentBodySchema.safeParse({ ...body, schemaVersion: 0 }).success).toBe(false);

    const response = { ...body, savedAt: '2026-10-24T00:00:00.000Z' } satisfies DocumentResponse;
    expect(documentResponseSchema.parse(response)).toEqual(response);
  });
});
