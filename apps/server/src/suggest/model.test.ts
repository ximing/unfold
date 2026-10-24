import { describe, expect, it } from 'vitest';
import { chatCompletionsUrl, mapModelItems, parseModelContent, shouldRequestModel, type ModelCandidate } from './model.js';

const current = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', canonicalName: '状态等价' };
const other: ModelCandidate = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  canonicalName: '决策树',
  coreStatement: '重复子问题收成同一状态',
};

describe('shouldRequestModel', () => {
  it('is false when the switch is off or a credential is missing', () => {
    expect(
      shouldRequestModel({
        UNFOLD_SUGGEST_MODEL: 'off',
        DASHSCOPE_API_KEY: 'key',
        DASHSCOPE_BASE_URL: 'https://example.test',
      }),
    ).toBe(false);
    expect(
      shouldRequestModel({ UNFOLD_SUGGEST_MODEL: 'on', DASHSCOPE_BASE_URL: 'https://example.test' }),
    ).toBe(false);
    expect(shouldRequestModel({ UNFOLD_SUGGEST_MODEL: 'on', DASHSCOPE_API_KEY: 'key' })).toBe(false);
    expect(
      shouldRequestModel({
        UNFOLD_SUGGEST_MODEL: 'on',
        DASHSCOPE_API_KEY: '  ',
        DASHSCOPE_BASE_URL: 'https://example.test',
      }),
    ).toBe(false);
    expect(
      shouldRequestModel({
        UNFOLD_SUGGEST_MODEL: 'on',
        DASHSCOPE_API_KEY: 'key',
        DASHSCOPE_BASE_URL: '',
      }),
    ).toBe(false);
  });

  it('is true when the switch is not off and both credentials are set', () => {
    expect(
      shouldRequestModel({
        UNFOLD_SUGGEST_MODEL: 'on',
        DASHSCOPE_API_KEY: 'key',
        DASHSCOPE_BASE_URL: 'https://example.test',
      }),
    ).toBe(true);
    expect(
      shouldRequestModel({
        DASHSCOPE_API_KEY: 'key',
        DASHSCOPE_BASE_URL: 'https://example.test',
      }),
    ).toBe(true);
  });
});

describe('chatCompletionsUrl', () => {
  it('appends chat completions onto a compatible-mode base', () => {
    expect(chatCompletionsUrl('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    );
    expect(chatCompletionsUrl('https://dashscope.aliyuncs.com/compatible-mode/v1/')).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    );
  });

  it('inserts compatible-mode when the base does not already end with it', () => {
    expect(chatCompletionsUrl('https://example.test')).toBe(
      'https://example.test/compatible-mode/v1/chat/completions',
    );
    expect(chatCompletionsUrl('https://example.test/')).toBe(
      'https://example.test/compatible-mode/v1/chat/completions',
    );
  });
});

describe('parseModelContent', () => {
  it('reads items from a json fence and rejects broken json', () => {
    const fenced = '```json\n{"items":[{"kind":"personal_note","text":"这是我的"}]}\n```';
    expect(parseModelContent(fenced)).toEqual({
      ok: true,
      items: [{ kind: 'personal_note', text: '这是我的' }],
    });
    expect(parseModelContent('not json')).toEqual({ ok: false });
    expect(parseModelContent('{"items":{}}')).toEqual({ ok: false });
  });
});

describe('mapModelItems', () => {
  const items = [
    { kind: 'relation', type: 'evolves_from', fromName: '状态等价', toName: '决策树' },
    {
      kind: 'relation',
      type: 'analogous',
      fromName: '决策树',
      toName: '状态等价',
      boundary: '只在名字上像',
      summary: '模型类比',
      acceptLabel: '   ',
    },
    { kind: 'personal_note', text: '没有主语的一句' },
    { kind: 'personal_note', text: '这是我 的理解' },
    {
      kind: 'relation',
      type: 'implements',
      fromName: '决策树',
      toName: '状态等价',
      note: '实现',
    },
  ];

  it('keeps a bounded analogy and drops an evolves_from that has no change', () => {
    const mapped = mapModelItems({ items, slots: 5, current, candidates: [other] });
    expect(mapped.some((item) => item.payload.type === 'evolves_from')).toBe(false);
    const analogy = mapped.find((item) => item.kind === 'relation' && item.payload.type === 'analogous');
    expect(analogy).toBeTruthy();
    if (!analogy) return;
    const [left, right] = [current.id, other.id].sort();
    expect(analogy.fragmentKey.startsWith('model:')).toBe(true);
    expect(analogy.fragmentKey).toBe(`model:${left}:${right}:analogous`);
    expect(analogy.acceptLabel).toBe('接受');
    expect(analogy.summary).toBe('模型类比');
  });

  it('drops a personal sentence without 我 and strips whitespace from the note key', () => {
    const mapped = mapModelItems({ items, slots: 5, current, candidates: [other] });
    const notes = mapped.filter((item) => item.kind === 'personal_note');
    expect(notes).toHaveLength(1);
    expect(notes[0]?.fragmentKey.startsWith('note:')).toBe(true);
    expect(notes[0]?.fragmentKey).toBe('note:这是我的理解');
    expect(notes[0]?.fragmentKey.includes(' ')).toBe(false);
    expect(notes[0]?.summary).toBe('个人理解');
    expect(notes[0]?.acceptLabel).toBe('转成个人理解块');
  });

  it('returns at most slots items', () => {
    const mapped = mapModelItems({ items, slots: 1, current, candidates: [other] });
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.payload.type).toBe('analogous');
  });
});
