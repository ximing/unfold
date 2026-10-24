import { describe, expect, it } from 'vitest';
import {
  createRelationBodySchema,
  relationStatusSchema,
  relationTypeSchema,
  updateRelationStatusSchema,
  type CreateRelationBody,
  type UpdateRelationStatus,
} from './index.js';

const fromId = '550e8400-e29b-41d4-a716-446655440000';
const toId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('createRelationBodySchema', () => {
  it('accepts all eight relation types', () => {
    for (const type of relationTypeSchema.options) {
      const body = { fromId, toId, type, note: '' } satisfies CreateRelationBody;
      expect(createRelationBodySchema.parse(body)).toEqual(body);
    }
    expect(relationTypeSchema.options).toHaveLength(8);
    expect(createRelationBodySchema.safeParse({ fromId, toId, type: 'part_of' }).success).toBe(false);
  });

  it('rejects a body missing fromId', () => {
    expect(createRelationBodySchema.safeParse({ toId, type: 'prerequisite' }).success).toBe(false);
  });
});

describe('updateRelationStatusSchema', () => {
  it('rejects suggested', () => {
    expect(relationStatusSchema.parse('suggested')).toBe('suggested');
    expect(updateRelationStatusSchema.safeParse({ status: 'suggested' }).success).toBe(false);
    for (const status of ['accepted', 'deferred', 'rejected'] as const) {
      const body = { status } satisfies UpdateRelationStatus;
      expect(updateRelationStatusSchema.parse(body)).toEqual(body);
    }
  });
});
