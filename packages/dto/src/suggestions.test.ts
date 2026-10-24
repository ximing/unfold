import { describe, expect, it } from 'vitest';
import {
  relationSuggestionPayloadSchema,
  resolveSuggestionBodySchema,
  suggestionListSchema,
  suggestionSchema,
  type PersonalNotePayload,
  type RelationSuggestionPayload,
  type ResolveSuggestionBody,
  type Suggestion,
  type SuggestionList,
} from './index.js';

const suggestionId = '550e8400-e29b-41d4-a716-446655440000';
const objectId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const fromId = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
const toId = '6ba7b812-9dad-11d1-80b4-00c04fd430c8';

const relationPayload = {
  type: 'evolves_from',
  fromId,
  toId,
  whatChanged: '从状态机收成等价',
  distinction: '',
  boundary: '',
  note: '',
} satisfies RelationSuggestionPayload;

const notePayload = { text: '这是我的理解' } satisfies PersonalNotePayload;

describe('suggestionSchema', () => {
  it('parses relation and personal note payloads', () => {
    const relation = {
      id: suggestionId,
      objectId,
      fragmentKey: 'core',
      kind: 'relation',
      origin: 'rule',
      status: 'pending',
      summary: '可能是演进',
      acceptLabel: '接受关系',
      payload: relationPayload,
    } satisfies Suggestion;
    const note = {
      ...relation,
      kind: 'personal_note',
      origin: 'model',
      summary: '补一句个人笔记',
      acceptLabel: '记下来',
      payload: notePayload,
    } satisfies Suggestion;

    expect(suggestionSchema.parse(relation)).toEqual(relation);
    expect(suggestionSchema.parse(note)).toEqual(note);
    expect(relationSuggestionPayloadSchema.parse(relationPayload)).toEqual(relationPayload);

    const list = { suggestions: [relation, note], notice: '' } satisfies SuggestionList;
    expect(suggestionListSchema.parse(list)).toEqual(list);
  });

  it('rejects a list that omits notice', () => {
    expect(suggestionListSchema.safeParse({ suggestions: [] }).success).toBe(false);
  });

  it('rejects part_of on a relation payload', () => {
    expect(
      relationSuggestionPayloadSchema.safeParse({ ...relationPayload, type: 'part_of' }).success,
    ).toBe(false);
    expect(
      suggestionSchema.safeParse({
        id: suggestionId,
        objectId,
        fragmentKey: 'core',
        kind: 'relation',
        origin: 'rule',
        status: 'pending',
        summary: '可能是部分',
        acceptLabel: '接受关系',
        payload: { ...relationPayload, type: 'part_of' },
      }).success,
    ).toBe(false);
  });
});

describe('resolveSuggestionBodySchema', () => {
  it('rejects pending', () => {
    expect(resolveSuggestionBodySchema.safeParse({ status: 'pending' }).success).toBe(false);
    for (const status of ['accepted', 'deferred', 'rejected'] as const) {
      const body = { status } satisfies ResolveSuggestionBody;
      expect(resolveSuggestionBodySchema.parse(body)).toEqual(body);
    }
  });
});
