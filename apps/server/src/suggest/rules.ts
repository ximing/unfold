export type PointKind = 'concept' | 'principle' | 'method' | 'model' | 'problem';

export type RuleCandidate = {
  id: string;
  type: PointKind;
  domainId: string;
  canonicalName: string;
  aliases: string[];
  coreStatement: string;
};

export type RelationDraft = {
  kind: 'relation';
  fragmentKey: string;
  origin: 'rule';
  acceptLabel: string;
  summary: string;
  payload: {
    type: 'evolves_from' | 'implements' | 'applies' | 'contrasts' | 'analogous';
    fromId: string;
    toId: string;
    whatChanged: string;
    distinction: string;
    boundary: string;
    note: string;
  };
};

export type PersonalNoteDraft = {
  kind: 'personal_note';
  fragmentKey: string;
  origin: 'rule';
  acceptLabel: string;
  summary: string;
  payload: { text: string };
};

export type SuggestionDraft = RelationDraft | PersonalNoteDraft;

type SuggestInput = {
  objectId: string;
  objectType: PointKind;
  domainId: string;
  canonicalName: string;
  plainText: string;
  candidates: RuleCandidate[];
};

const MAX_SUGGESTIONS = 5;
const STATEMENT_GAP = '；';

type Needle = {
  candidate: RuleCandidate;
  sourceIndex: number;
  needle: string;
  canonical: boolean;
};

type Span = {
  start: number;
  end: number;
  ownerId: string;
  needle: string;
};

type Location = {
  candidate: RuleCandidate;
  sourceIndex: number;
  canonicalAt: number | null;
  anyAt: number | null;
};

function orderedPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

function coreStatementOf(input: SuggestInput, id: string): string {
  const found = input.candidates.find((candidate) => candidate.id === id);
  return found?.coreStatement ?? '';
}

function relationDraft(fields: {
  fragmentKey: string;
  acceptLabel: string;
  summary: string;
  type: RelationDraft['payload']['type'];
  fromId: string;
  toId: string;
  whatChanged?: string;
  distinction?: string;
  boundary?: string;
  note?: string;
}): RelationDraft {
  return {
    kind: 'relation',
    fragmentKey: fields.fragmentKey,
    origin: 'rule',
    acceptLabel: fields.acceptLabel,
    summary: fields.summary,
    payload: {
      type: fields.type,
      fromId: fields.fromId,
      toId: fields.toId,
      whatChanged: fields.whatChanged ?? '',
      distinction: fields.distinction ?? '',
      boundary: fields.boundary ?? '',
      note: fields.note ?? '',
    },
  };
}

function paragraphRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const pattern = /\n\s*\n/g;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? start;
    ranges.push({ start, end: at });
    start = at + match[0].length;
  }
  ranges.push({ start, end: text.length });
  return ranges;
}

function needlesFor(candidates: readonly RuleCandidate[], objectId: string): Needle[] {
  const needles: Needle[] = [];
  candidates.forEach((candidate, sourceIndex) => {
    if (candidate.id === objectId) return;
    if (candidate.canonicalName.length >= 2) {
      needles.push({
        candidate,
        sourceIndex,
        needle: candidate.canonicalName,
        canonical: true,
      });
    }
    for (const alias of candidate.aliases) {
      if (alias.length < 2 || alias === candidate.canonicalName) continue;
      needles.push({ candidate, sourceIndex, needle: alias, canonical: false });
    }
  });
  // Longer names claim a span first so a short name cannot match inside them.
  needles.sort(
    (a, b) => b.needle.length - a.needle.length || (a.needle < b.needle ? -1 : a.needle > b.needle ? 1 : 0),
  );
  return needles;
}

function locateMentions(text: string, candidates: readonly RuleCandidate[], objectId: string): Location[] {
  const spans: Span[] = [];
  const byId = new Map<string, Location>();

  const ensure = (item: Needle): Location => {
    const existing = byId.get(item.candidate.id);
    if (existing) return existing;
    const created: Location = {
      candidate: item.candidate,
      sourceIndex: item.sourceIndex,
      canonicalAt: null,
      anyAt: null,
    };
    byId.set(item.candidate.id, created);
    return created;
  };

  const note = (item: Needle, index: number) => {
    const location = ensure(item);
    if (location.anyAt === null || index < location.anyAt) location.anyAt = index;
    if (item.canonical && (location.canonicalAt === null || index < location.canonicalAt)) {
      location.canonicalAt = index;
    }
  };

  for (const item of needlesFor(candidates, objectId)) {
    let from = 0;
    while (from <= text.length) {
      const index = text.indexOf(item.needle, from);
      if (index < 0) break;
      const end = index + item.needle.length;
      const overlapping = spans.filter((span) => index < span.end && end > span.start);
      if (overlapping.length === 0) {
        spans.push({ start: index, end, ownerId: item.candidate.id, needle: item.needle });
        note(item, index);
        from = end;
        continue;
      }
      const sameText = overlapping.some(
        (span) => span.start === index && span.end === end && span.needle === item.needle,
      );
      if (sameText) {
        note(item, index);
        from = end;
        continue;
      }
      if (item.canonical && overlapping.every((span) => span.ownerId === item.candidate.id)) {
        note(item, index);
      }
      from = index + 1;
    }
  }

  return [...byId.values()];
}

function sentencesOf(text: string): string[] {
  const sentences: string[] = [];
  let current = '';
  const flush = () => {
    const sentence = current.trim();
    current = '';
    if (sentence !== '') sentences.push(sentence);
  };
  for (const char of text) {
    current += char;
    if (char === '。' || char === '！' || char === '？' || char === '\n') flush();
  }
  flush();
  return sentences;
}

function pushAnalogy(input: SuggestInput, drafts: SuggestionDraft[], used: Set<string>): void {
  if (input.canonicalName.length < 2) return;
  for (const candidate of input.candidates) {
    if (drafts.length >= MAX_SUGGESTIONS) return;
    if (candidate.id === input.objectId || used.has(candidate.id)) continue;
    if (candidate.canonicalName.length < 2) continue;
    if (candidate.canonicalName !== input.canonicalName) continue;
    if (candidate.domainId === input.domainId) continue;
    const [fromId, toId] = orderedPair(input.objectId, candidate.id);
    const fromStatement = coreStatementOf(input, fromId);
    const toStatement = coreStatementOf(input, toId);
    const boundary =
      fromStatement !== '' && toStatement !== ''
        ? `${fromStatement}${STATEMENT_GAP}${toStatement}`
        : `「${input.canonicalName}」在两个领域里同名，不合并`;
    drafts.push(
      relationDraft({
        fragmentKey: `analogous:${fromId}:${toId}`,
        acceptLabel: '建成类比',
        summary: `「${input.canonicalName}」在两个领域里同名，建议类比，不提供合并。`,
        type: 'analogous',
        fromId,
        toId,
        boundary,
      }),
    );
    used.add(candidate.id);
  }
}

function pushContrasts(input: SuggestInput, drafts: SuggestionDraft[], used: Set<string>): void {
  for (const range of paragraphRanges(input.plainText)) {
    if (drafts.length >= MAX_SUGGESTIONS) return;
    const paragraph = input.plainText.slice(range.start, range.end);
    const hits = locateMentions(paragraph, input.candidates, input.objectId)
      .filter((location) => location.candidate.type === 'principle')
      .filter((location) => location.canonicalAt !== null)
      .filter((location) => !used.has(location.candidate.id))
      .sort((a, b) => (a.canonicalAt ?? 0) - (b.canonicalAt ?? 0) || a.sourceIndex - b.sourceIndex);
    const first = hits[0];
    const second = hits[1];
    if (first === undefined || second === undefined) continue;
    if (first.candidate.id === second.candidate.id) continue;
    const from = first.candidate.id <= second.candidate.id ? first.candidate : second.candidate;
    const to = from.id === first.candidate.id ? second.candidate : first.candidate;
    const distinction =
      from.coreStatement !== '' && to.coreStatement !== ''
        ? `${from.coreStatement}${STATEMENT_GAP}${to.coreStatement}`
        : `「${from.canonicalName}」和「${to.canonicalName}」保持独立`;
    drafts.push(
      relationDraft({
        fragmentKey: `contrast:${from.id}:${to.id}`,
        acceptLabel: '建成对比',
        summary: `「${first.candidate.canonicalName}」和「${second.candidate.canonicalName}」同段出现，是两个原理。建议对比，不提供合并，也不互为别名。`,
        type: 'contrasts',
        fromId: from.id,
        toId: to.id,
        distinction,
      }),
    );
    used.add(first.candidate.id);
    used.add(second.candidate.id);
  }
}

function pushHits(input: SuggestInput, drafts: SuggestionDraft[], used: Set<string>): void {
  const hits = locateMentions(input.plainText, input.candidates, input.objectId)
    .filter((location) => location.anyAt !== null)
    .filter((location) => !used.has(location.candidate.id))
    .filter(
      (location) =>
        location.candidate.type === 'model' ||
        location.candidate.type === 'method' ||
        location.candidate.type === 'problem',
    )
    .sort((a, b) => (a.anyAt ?? 0) - (b.anyAt ?? 0) || a.sourceIndex - b.sourceIndex);

  for (const hit of hits) {
    if (drafts.length >= MAX_SUGGESTIONS) return;
    const candidate = hit.candidate;
    const fragmentKey = `hit:${candidate.id}`;
    if (candidate.type === 'model') {
      drafts.push(
        relationDraft({
          fragmentKey,
          acceptLabel: '接受',
          summary: `认出已有「${candidate.canonicalName}」，建议演化关系。`,
          type: 'evolves_from',
          fromId: input.objectId,
          toId: candidate.id,
          whatChanged: candidate.coreStatement !== '' ? candidate.coreStatement : candidate.canonicalName,
        }),
      );
    } else if (candidate.type === 'method') {
      drafts.push(
        relationDraft({
          fragmentKey,
          acceptLabel: '接受',
          summary: `认出已有「${candidate.canonicalName}」，建议实现关系。`,
          type: 'implements',
          fromId: candidate.id,
          toId: input.objectId,
          note: candidate.coreStatement,
        }),
      );
    } else {
      drafts.push(
        relationDraft({
          fragmentKey,
          acceptLabel: '接受',
          summary: `认出已有「${candidate.canonicalName}」，建议应用关系。`,
          type: 'applies',
          fromId: input.objectId,
          toId: candidate.id,
          note: candidate.coreStatement,
        }),
      );
    }
    used.add(candidate.id);
  }
}

function pushNotes(input: SuggestInput, drafts: SuggestionDraft[]): void {
  const seen = new Set<string>();
  for (const sentence of sentencesOf(input.plainText)) {
    if (drafts.length >= MAX_SUGGESTIONS) return;
    if (!sentence.includes('我')) continue;
    const fragmentKey = `note:${sentence.replace(/\s/g, '')}`;
    if (seen.has(fragmentKey)) continue;
    seen.add(fragmentKey);
    drafts.push({
      kind: 'personal_note',
      fragmentKey,
      origin: 'rule',
      acceptLabel: '转成个人理解块',
      summary: `「${sentence}」转成个人理解块，不新建点。`,
      payload: { text: sentence },
    });
  }
}

export function suggestByRules(input: SuggestInput): SuggestionDraft[] {
  const drafts: SuggestionDraft[] = [];
  const used = new Set<string>();
  pushAnalogy(input, drafts, used);
  pushContrasts(input, drafts, used);
  pushHits(input, drafts, used);
  pushNotes(input, drafts);
  return drafts.slice(0, MAX_SUGGESTIONS);
}
