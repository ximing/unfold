import { describe, expect, it } from 'vitest';
import {
  errorBodySchema,
  loginBodySchema,
  todayResponseSchema,
  type ErrorBody,
  type LoginBody,
  type TodayResponse,
} from './index.js';

const emptyToday = {
  focus: null,
  due: [],
  freeCount: 0,
  pendingSuggestions: 0,
  openQuestions: [],
} satisfies TodayResponse;

const focusId = '550e8400-e29b-41d4-a716-446655440000';

describe('todayResponseSchema', () => {
  it('parses an empty today', () => {
    const parsed: TodayResponse = todayResponseSchema.parse(emptyToday);
    expect(parsed).toEqual(emptyToday);
    expect(parsed.focus).toBeNull();
  });

  it('parses focus, due capabilities, and open questions', () => {
    const today = {
      focus: {
        id: focusId,
        canonicalName: '状态等价',
        coreStatement: '如果两个历史对未来没有影响，它们就是同一状态。',
        domainName: '算法',
        type: 'concept',
      },
      due: [
        {
          capabilityId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
          statement: '独立解释队尾淘汰',
          evidenceNote: '上次没能独立解释队尾淘汰',
          dueAt: '2026-10-24T00:00:00.000Z',
        },
      ],
      freeCount: 2,
      pendingSuggestions: 2,
      openQuestions: [
        {
          blockId: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
          text: '为什么区间 DP 的状态定义容易混乱',
          objectId: '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
          objectName: '区间 DP',
        },
      ],
    } satisfies TodayResponse;
    expect(todayResponseSchema.parse(today)).toEqual(today);
  });

  it('accepts the five knowledge object types', () => {
    for (const type of ['concept', 'principle', 'method', 'model', 'problem'] as const) {
      expect(
        todayResponseSchema.safeParse({
          ...emptyToday,
          focus: {
            id: focusId,
            canonicalName: '状态等价',
            coreStatement: '同一状态',
            domainName: '算法',
            type,
          },
        }).success,
      ).toBe(true);
    }
  });

  it('rejects a today response missing a field', () => {
    for (const key of ['focus', 'due', 'freeCount', 'pendingSuggestions', 'openQuestions'] as const) {
      const payload: Record<string, unknown> = { ...emptyToday };
      delete payload[key];
      expect(todayResponseSchema.safeParse(payload).success).toBe(false);
    }
  });

  it('rejects counts that are not nonnegative integers', () => {
    expect(todayResponseSchema.safeParse({ ...emptyToday, freeCount: -1 }).success).toBe(false);
    expect(todayResponseSchema.safeParse({ ...emptyToday, freeCount: 1.5 }).success).toBe(false);
    expect(todayResponseSchema.safeParse({ ...emptyToday, pendingSuggestions: -1 }).success).toBe(false);
  });

  it('rejects an unknown object type', () => {
    expect(
      todayResponseSchema.safeParse({
        ...emptyToday,
        focus: {
          id: focusId,
          canonicalName: '状态等价',
          coreStatement: '同一状态',
          domainName: '算法',
          type: 'topic',
        },
      }).success,
    ).toBe(false);
  });
});

describe('errorBodySchema', () => {
  it('parses the error envelope', () => {
    const body = { error: { code: 'unauthorized', message: '密码不对' } } satisfies ErrorBody;
    expect(errorBodySchema.parse(body)).toEqual(body);
  });
});

describe('loginBodySchema', () => {
  it('requires a username and a password', () => {
    const body = { username: 'ximing', password: 'secret' } satisfies LoginBody;
    expect(loginBodySchema.parse(body)).toEqual(body);
    expect(loginBodySchema.safeParse({ username: '', password: 'secret' }).success).toBe(false);
    expect(loginBodySchema.safeParse({ username: 'ximing', password: '' }).success).toBe(false);
  });
});
