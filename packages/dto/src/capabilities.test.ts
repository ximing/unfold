import { describe, expect, it } from 'vitest';
import {
  capabilitySchema,
  createCapabilityBodySchema,
  createEvidenceBodySchema,
  evidenceSchema,
  type Capability,
  type CreateCapabilityBody,
  type CreateEvidenceBody,
  type Evidence,
} from './index.js';

const primaryObjectId = '550e8400-e29b-41d4-a716-446655440000';
const capabilityId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const objectId = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

describe('createCapabilityBodySchema', () => {
  it('defaults hintThreshold to 3 and leaves prompt, hints, and objectIds empty', () => {
    const parsed = createCapabilityBodySchema.parse({
      statement: '能从定义推出结论',
      kind: 'derive',
      primaryObjectId,
    });
    const body = {
      statement: '能从定义推出结论',
      kind: 'derive',
      primaryObjectId,
      prompt: '',
      referenceNote: '',
      hintThreshold: 3,
      hints: [],
      objectIds: [],
    } satisfies CreateCapabilityBody;
    expect(parsed).toEqual(body);
    expect(parsed.hintThreshold).toBe(3);
    expect(parsed.prompt).toBe('');
    expect(parsed.hints).toEqual([]);
    expect(parsed.objectIds).toEqual([]);
  });

  it('rejects kind part_of and mastery', () => {
    const base = {
      statement: '能从定义推出结论',
      primaryObjectId,
    };
    expect(createCapabilityBodySchema.safeParse({ ...base, kind: 'part_of' }).success).toBe(false);
    expect(createCapabilityBodySchema.safeParse({ ...base, kind: 'mastery' }).success).toBe(false);
  });
});

describe('capabilitySchema', () => {
  it('parses a capability without mastery fields', () => {
    const capability = {
      id: capabilityId,
      statement: '能从定义推出结论',
      kind: 'derive',
      prompt: '',
      hints: [],
      hintThreshold: 3,
      referenceNote: '',
      primaryObjectId,
      objectIds: [objectId],
    } satisfies Capability;
    expect(capabilitySchema.parse(capability)).toEqual(capability);
  });
});

describe('evidenceSchema', () => {
  it('accepts nonnegative hintLevel and rating independent, and rejects hintLevel -1', () => {
    const evidence = {
      id: capabilityId,
      capabilityId,
      mode: 'practice',
      hintLevel: 0,
      rating: 'independent',
      obstacle: '',
      body: '',
      createdAt: '2026-10-24T00:00:00.000Z',
    } satisfies Evidence;
    expect(evidenceSchema.parse(evidence)).toEqual(evidence);
    expect(evidenceSchema.parse({ ...evidence, hintLevel: 2 }).hintLevel).toBe(2);
    expect(evidenceSchema.safeParse({ ...evidence, hintLevel: -1 }).success).toBe(false);
    expect(evidenceSchema.parse({ ...evidence, rating: 'independent' }).rating).toBe('independent');

    const created = createEvidenceBodySchema.parse({
      mode: 'review',
      hintLevel: 0,
      rating: 'independent',
    });
    const body = {
      mode: 'review',
      hintLevel: 0,
      rating: 'independent',
      obstacle: '',
      body: '',
    } satisfies CreateEvidenceBody;
    expect(created).toEqual(body);
    expect(createEvidenceBodySchema.safeParse({ ...body, hintLevel: -1 }).success).toBe(false);
  });
});
