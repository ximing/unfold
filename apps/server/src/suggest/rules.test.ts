import { describe, expect, it } from 'vitest';
import { suggestByRules, type RuleCandidate, type SuggestionDraft } from './rules.js';

function point(
  partial: Pick<RuleCandidate, 'id' | 'type' | 'canonicalName'> & Partial<RuleCandidate>,
): RuleCandidate {
  return {
    domainId: 'algo',
    aliases: [],
    coreStatement: '',
    ...partial,
  };
}

function run(
  partial: Partial<Parameters<typeof suggestByRules>[0]> &
    Pick<Parameters<typeof suggestByRules>[0], 'plainText' | 'candidates'>,
): SuggestionDraft[] {
  return suggestByRules({
    objectId: 'eq',
    objectType: 'concept',
    domainId: 'algo',
    canonicalName: '状态等价',
    ...partial,
  });
}

function keysDeep(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...keysDeep(child)]);
}

function expectNoBookkeeping(drafts: SuggestionDraft[]): void {
  const keys = new Set(keysDeep(drafts));
  expect(keys.has('merge')).toBe(false);
  expect(keys.has('alias')).toBe(false);
  expect(keys.has('percent')).toBe(false);
  expect(keys.has('part_of')).toBe(false);
  expect(JSON.stringify(drafts)).not.toContain('part_of');
  for (const draft of drafts) {
    if (draft.kind !== 'relation') continue;
    const type: string = draft.payload.type;
    expect(type).not.toBe('part_of');
    expect(draft.payload.fromId).not.toBe(draft.payload.toId);
  }
}

describe('suggestByRules', () => {
  it('suggests exactly one contrast for two principles in the same paragraph', () => {
    const result = run({
      plainText: '最优子结构说的是局部最优能拼成全局最优。重叠子问题说的是同一个状态会被反复遇到。',
      candidates: [
        point({
          id: 'opt',
          type: 'principle',
          canonicalName: '最优子结构',
          coreStatement: '局部最优能拼成全局最优',
        }),
        point({
          id: 'over',
          type: 'principle',
          canonicalName: '重叠子问题',
          coreStatement: '同一个状态会被反复遇到',
        }),
      ],
    });

    expect(result).toEqual([
      {
        kind: 'relation',
        fragmentKey: 'contrast:opt:over',
        origin: 'rule',
        acceptLabel: '建成对比',
        summary:
          '「最优子结构」和「重叠子问题」同段出现，是两个原理。建议对比，不提供合并，也不互为别名。',
        payload: {
          type: 'contrasts',
          fromId: 'opt',
          toId: 'over',
          whatChanged: '',
          distinction: '局部最优能拼成全局最优；同一个状态会被反复遇到',
          boundary: '',
          note: '',
        },
      },
    ]);
    expect(result[0]?.summary).toContain('不提供合并');
    expect(result[0]?.summary).toContain('不互为别名');
    expect(result[0]).not.toHaveProperty('merge');
    expectNoBookkeeping(result);
  });

  it('suggests an analogy when another domain has the same name', () => {
    const result = run({
      objectId: 'point-b',
      domainId: 'algo',
      canonicalName: '状态',
      plainText: '正文没有出现这个名字。',
      candidates: [
        point({
          id: 'point-a',
          type: 'concept',
          domainId: 'agent',
          canonicalName: '状态',
          coreStatement: '',
        }),
      ],
    });

    expect(result).toEqual([
      {
        kind: 'relation',
        fragmentKey: 'analogous:point-a:point-b',
        origin: 'rule',
        acceptLabel: '建成类比',
        summary: '「状态」在两个领域里同名，建议类比，不提供合并。',
        payload: {
          type: 'analogous',
          fromId: 'point-a',
          toId: 'point-b',
          whatChanged: '',
          distinction: '',
          boundary: '「状态」在两个领域里同名，不合并',
          note: '',
        },
      },
    ]);
    expect(result[0]?.kind).toBe('relation');
    if (result[0]?.kind === 'relation') expect(result[0].payload.boundary).not.toBe('');
    expect(result[0]?.summary).toContain('类比');
    expect(result[0]?.summary).toContain('不提供合并');
  });

  it('fills an analogy boundary from both core statements', () => {
    const result = run({
      objectId: 'point-b',
      domainId: 'algo',
      canonicalName: '状态',
      plainText: '',
      candidates: [
        point({
          id: 'point-b',
          type: 'concept',
          domainId: 'algo',
          canonicalName: '状态',
          coreStatement: '未来决策不变',
        }),
        point({
          id: 'point-a',
          type: 'concept',
          domainId: 'agent',
          canonicalName: '状态',
          coreStatement: '不能重放副作用',
        }),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'relation',
      payload: {
        type: 'analogous',
        fromId: 'point-a',
        toId: 'point-b',
        boundary: '不能重放副作用；未来决策不变',
      },
    });
  });

  it('suggests evolves_from when the text hits a model', () => {
    const result = run({
      objectId: 'eq',
      plainText: '重复子问题被合并之后，决策树变成状态等价。',
      candidates: [
        point({
          id: 'tree',
          type: 'model',
          canonicalName: '决策树',
          coreStatement: '重复子问题被合并成同一状态',
        }),
        point({
          id: 'short',
          type: 'method',
          canonicalName: '无关方法',
          aliases: ['树'],
        }),
      ],
    });

    expect(result).toEqual([
      {
        kind: 'relation',
        fragmentKey: 'hit:tree',
        origin: 'rule',
        acceptLabel: '接受',
        summary: '认出已有「决策树」，建议演化关系。',
        payload: {
          type: 'evolves_from',
          fromId: 'eq',
          toId: 'tree',
          whatChanged: '重复子问题被合并成同一状态',
          distinction: '',
          boundary: '',
          note: '',
        },
      },
    ]);
    expect(result[0]?.summary).toContain('决策树');
    expect(result[0]?.summary).toContain('演化');
    if (result[0]?.kind === 'relation') expect(result[0].payload.whatChanged).not.toBe('');
  });

  it('uses the model name when its core statement is empty', () => {
    const result = run({
      plainText: '这里写了决策树。',
      candidates: [point({ id: 'tree', type: 'model', canonicalName: '决策树', coreStatement: '' })],
    });

    expect(result[0]).toMatchObject({
      payload: { type: 'evolves_from', whatChanged: '决策树', distinction: '', boundary: '', note: '' },
    });
  });

  it('suggests implements when the text hits a method', () => {
    const result = run({
      objectId: 'eq',
      plainText: '可以用记忆化搜索把结果存下来。',
      candidates: [
        point({
          id: 'memo',
          type: 'method',
          canonicalName: '记忆化搜索',
          coreStatement: '同一个状态第一次算完就记住',
        }),
      ],
    });

    expect(result).toEqual([
      {
        kind: 'relation',
        fragmentKey: 'hit:memo',
        origin: 'rule',
        acceptLabel: '接受',
        summary: '认出已有「记忆化搜索」，建议实现关系。',
        payload: {
          type: 'implements',
          fromId: 'memo',
          toId: 'eq',
          whatChanged: '',
          distinction: '',
          boundary: '',
          note: '同一个状态第一次算完就记住',
        },
      },
    ]);
    expect(result[0]?.summary).toContain('记忆化搜索');
    expect(result[0]?.summary).toContain('实现');
  });

  it('suggests applies when the text hits a problem', () => {
    const result = run({
      objectId: 'eq',
      plainText: '这道题是 LC140，要输出全部拆分。',
      candidates: [
        point({
          id: 'lc140',
          type: 'problem',
          canonicalName: 'LC140',
          coreStatement: 'i 上存全部拆法',
        }),
        point({ id: 'lc', type: 'method', canonicalName: 'LC' }),
      ],
    });

    expect(result).toEqual([
      {
        kind: 'relation',
        fragmentKey: 'hit:lc140',
        origin: 'rule',
        acceptLabel: '接受',
        summary: '认出已有「LC140」，建议应用关系。',
        payload: {
          type: 'applies',
          fromId: 'eq',
          toId: 'lc140',
          whatChanged: '',
          distinction: '',
          boundary: '',
          note: 'i 上存全部拆法',
        },
      },
    ]);
    expect(result[0]?.summary).toContain('LC140');
    expect(result[0]?.summary).toContain('应用');
  });

  it('turns a first-person sentence into one personal note', () => {
    const result = run({
      plainText: '我认为这两个历史对未来没有影响。',
      candidates: [],
    });

    expect(result).toEqual([
      {
        kind: 'personal_note',
        fragmentKey: 'note:我认为这两个历史对未来没有影响。',
        origin: 'rule',
        acceptLabel: '转成个人理解块',
        summary: '「我认为这两个历史对未来没有影响。」转成个人理解块，不新建点。',
        payload: { text: '我认为这两个历史对未来没有影响。' },
      },
    ]);
    expect(result[0]?.summary).toContain('个人理解块');
    expect(result[0]?.summary).toContain('不新建点');
    if (result[0]?.kind === 'personal_note') expect(result[0].payload.text).toContain('我');
  });

  it('does not turn a sentence without 我 into a personal note', () => {
    const result = run({
      plainText: '如果两个历史对未来没有影响，它们就是同一状态。',
      candidates: [],
    });

    expect(result).toEqual([]);
    expect(result.some((draft) => draft.kind === 'personal_note')).toBe(false);
  });

  it('keeps only the first-person sentence when both sentences are present', () => {
    const result = run({
      plainText: '我认为这两个历史对未来没有影响。如果两个历史对未来没有影响，它们就是同一状态。',
      candidates: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'personal_note',
      payload: { text: '我认为这两个历史对未来没有影响。' },
    });
    expect(JSON.stringify(result)).not.toContain('如果两个历史');
  });

  it('does not repeat the same first-person sentence', () => {
    const result = run({
      plainText: '我认为这两个历史对未来没有影响。\n我认为这两个历史对未来没有影响。',
      candidates: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('personal_note');
  });

  it('does not relate a point to itself', () => {
    const result = run({
      objectId: 'eq',
      plainText: '状态等价用决策树表达。',
      candidates: [
        point({
          id: 'eq',
          type: 'model',
          domainId: 'agent',
          canonicalName: '状态等价',
          coreStatement: '自己的陈述',
        }),
        point({
          id: 'tree',
          type: 'model',
          canonicalName: '决策树',
          coreStatement: '合并重复子问题',
        }),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      payload: { type: 'evolves_from', fromId: 'eq', toId: 'tree' },
    });
    for (const draft of result) {
      if (draft.kind !== 'relation') continue;
      expect(draft.payload.fromId).not.toBe(draft.payload.toId);
      expect(draft.payload.toId).not.toBe('eq');
    }
  });

  it('stops at five analogies before later rules', () => {
    const candidates = ['n6', 'n5', 'n4', 'n3', 'n2', 'n1'].map((id) =>
      point({ id, type: 'concept', domainId: `domain-${id}`, canonicalName: '状态' }),
    );
    const result = run({
      objectId: 'n9',
      domainId: 'algo',
      canonicalName: '状态',
      plainText: '我认为不该出现。',
      candidates,
    });

    expect(result).toHaveLength(5);
    expect(result.map((draft) => draft.fragmentKey)).toEqual([
      'analogous:n6:n9',
      'analogous:n5:n9',
      'analogous:n4:n9',
      'analogous:n3:n9',
      'analogous:n2:n9',
    ]);
    expect(result.some((draft) => draft.kind === 'personal_note')).toBe(false);
  });

  it('fills remaining slots in rule order and still stops at five', () => {
    const result = run({
      plainText: '模型甲、模型乙和模型丙。我认为第一句。我认为第二句。我认为第三句。',
      candidates: [
        point({ id: 'm1', type: 'model', canonicalName: '模型甲' }),
        point({ id: 'm2', type: 'model', canonicalName: '模型乙' }),
        point({ id: 'm3', type: 'model', canonicalName: '模型丙' }),
      ],
    });

    expect(result).toHaveLength(5);
    expect(result.slice(0, 3).map((draft) => draft.fragmentKey)).toEqual(['hit:m1', 'hit:m2', 'hit:m3']);
    expect(result.slice(3).every((draft) => draft.kind === 'personal_note')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('我认为第三句');
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('never suggests part_of', () => {
    const result = run({
      objectId: 'eq',
      canonicalName: '状态等价',
      plainText: '最优子结构和重叠子问题。决策树。记忆化搜索。LC140。',
      candidates: [
        point({ id: 'ana', type: 'concept', domainId: 'agent', canonicalName: '状态等价' }),
        point({ id: 'opt', type: 'principle', canonicalName: '最优子结构', coreStatement: '能拼' }),
        point({ id: 'over', type: 'principle', canonicalName: '重叠子问题', coreStatement: '会重复' }),
        point({ id: 'tree', type: 'model', canonicalName: '决策树', coreStatement: '合并' }),
        point({ id: 'memo', type: 'method', canonicalName: '记忆化搜索', coreStatement: '记住' }),
        point({ id: 'lc140', type: 'problem', canonicalName: 'LC140', coreStatement: '全部拆法' }),
      ],
    });

    expect(result.map((draft) => (draft.kind === 'relation' ? draft.payload.type : draft.kind))).toEqual([
      'analogous',
      'contrasts',
      'evolves_from',
      'implements',
      'applies',
    ]);
    expectNoBookkeeping(result);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('does not let a shorter name match inside a longer one', () => {
    const buried = run({
      plainText: '决策树模型',
      candidates: [
        point({ id: 'long', type: 'model', canonicalName: '决策树模型', coreStatement: '长名' }),
        point({ id: 'short', type: 'method', canonicalName: '别的方法', aliases: ['决策树'] }),
      ],
    });
    expect(buried.map((draft) => draft.fragmentKey)).toEqual(['hit:long']);

    const separate = run({
      plainText: '决策树模型之外还有决策树',
      candidates: [
        point({ id: 'long', type: 'model', canonicalName: '决策树模型', coreStatement: '长名' }),
        point({ id: 'short', type: 'method', canonicalName: '别的方法', aliases: ['决策树'] }),
      ],
    });
    expect(separate.map((draft) => draft.fragmentKey)).toEqual(['hit:long', 'hit:short']);
    expect(separate[1]).toMatchObject({ payload: { type: 'implements', fromId: 'short', toId: 'eq' } });
  });

  it('pairs only the first two principles when a paragraph has more', () => {
    const result = run({
      plainText: '甲原理、乙原理、丙原理、丁原理',
      candidates: [
        point({ id: 'm2', type: 'principle', canonicalName: '甲原理' }),
        point({ id: 'm1', type: 'principle', canonicalName: '乙原理' }),
        point({ id: 'm4', type: 'principle', canonicalName: '丙原理' }),
        point({ id: 'm3', type: 'principle', canonicalName: '丁原理' }),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      fragmentKey: 'contrast:m1:m2',
      payload: {
        type: 'contrasts',
        fromId: 'm1',
        toId: 'm2',
        distinction: '「乙原理」和「甲原理」保持独立',
        boundary: '',
        whatChanged: '',
        note: '',
      },
    });
    expect(JSON.stringify(result)).not.toContain('m3');
    expect(JSON.stringify(result)).not.toContain('m4');
  });

  it('does not contrast an id that already became an analogy', () => {
    const result = run({
      objectId: 'eq',
      canonicalName: '甲原理',
      plainText: '甲原理、乙原理、丙原理、丁原理',
      candidates: [
        point({ id: 'p0', type: 'principle', domainId: 'agent', canonicalName: '甲原理' }),
        point({ id: 'p1', type: 'principle', canonicalName: '乙原理' }),
        point({ id: 'p2', type: 'principle', canonicalName: '丙原理' }),
        point({ id: 'p3', type: 'principle', canonicalName: '丁原理' }),
      ],
    });

    expect(result.map((draft) => draft.fragmentKey)).toEqual(['analogous:eq:p0', 'contrast:p1:p2']);
    const contrast = result[1];
    if (contrast?.kind === 'relation') {
      expect(contrast.payload.fromId).not.toBe('p0');
      expect(contrast.payload.toId).not.toBe('p0');
      expect(contrast.payload.toId).not.toBe('p3');
    }
  });

  it('splits paragraphs on a blank line and not on a single newline', () => {
    const principles = [
      point({ id: 'a', type: 'principle', canonicalName: '甲原理' }),
      point({ id: 'b', type: 'principle', canonicalName: '乙原理' }),
    ];

    expect(run({ plainText: '甲原理\n乙原理', candidates: principles })).toHaveLength(1);
    expect(run({ plainText: '甲原理\n\n乙原理', candidates: principles })).toEqual([]);
    expect(run({ plainText: '甲原理\n \n乙原理', candidates: principles })).toEqual([]);

    const two = run({
      plainText: '甲原理与乙原理\n\n丙原理与丁原理',
      candidates: [
        ...principles,
        point({ id: 'c', type: 'principle', canonicalName: '丙原理' }),
        point({ id: 'd', type: 'principle', canonicalName: '丁原理' }),
      ],
    });
    expect(two.map((draft) => draft.fragmentKey)).toEqual(['contrast:a:b', 'contrast:c:d']);

    const again = run({
      plainText: '甲原理\n\n甲原理与乙原理',
      candidates: principles,
    });
    expect(again.map((draft) => draft.fragmentKey)).toEqual(['contrast:a:b']);
  });

  it('matches an alias and ignores names shorter than 2', () => {
    const result = run({
      plainText: '使用记忆化搜索，旁边有一个 A 和搜。',
      candidates: [
        point({
          id: 'memo',
          type: 'method',
          canonicalName: '别的方法',
          aliases: ['记忆化搜索', 'A'],
          coreStatement: '记住',
        }),
        point({ id: 'tiny', type: 'model', canonicalName: '搜' }),
      ],
    });

    expect(result).toEqual([
      {
        kind: 'relation',
        fragmentKey: 'hit:memo',
        origin: 'rule',
        acceptLabel: '接受',
        summary: '认出已有「别的方法」，建议实现关系。',
        payload: {
          type: 'implements',
          fromId: 'memo',
          toId: 'eq',
          whatChanged: '',
          distinction: '',
          boundary: '',
          note: '记住',
        },
      },
    ]);
  });

  it('does not suggest a concept or a lone principle from a title hit', () => {
    const result = run({
      plainText: '另一个概念和最优子结构都出现了。',
      candidates: [
        point({ id: 'concept-1', type: 'concept', canonicalName: '另一个概念' }),
        point({ id: 'only', type: 'principle', canonicalName: '最优子结构' }),
      ],
    });

    expect(result).toEqual([]);
  });
});
