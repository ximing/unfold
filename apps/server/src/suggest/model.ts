import { z } from 'zod';
import { validateRelation } from '../services/relation-rules.js';

export const modelSuggestionFailureNotice = '模型建议这次没有生成';

export type ModelCandidate = { id: string; canonicalName: string; coreStatement: string };

export type ModelRequester = (input: {
  canonicalName: string;
  plainText: string;
  slots: number;
  candidates: ModelCandidate[];
}) => Promise<{ ok: true; items: unknown[] } | { ok: false }>;

type MappedSuggestion = {
  fragmentKey: string;
  kind: 'relation' | 'personal_note';
  summary: string;
  acceptLabel: string;
  payload: Record<string, unknown>;
};

const relationItemSchema = z.object({
  kind: z.literal('relation'),
  type: z.enum(['evolves_from', 'implements', 'applies', 'contrasts', 'analogous']),
  fromName: z.string(),
  toName: z.string(),
  whatChanged: z.string().optional(),
  distinction: z.string().optional(),
  boundary: z.string().optional(),
  note: z.string().optional(),
  summary: z.string().optional(),
  acceptLabel: z.string().optional(),
});

const personalNoteItemSchema = z.object({
  kind: z.literal('personal_note'),
  text: z.string().min(1),
  summary: z.string().optional(),
  acceptLabel: z.string().optional(),
});

function nonEmpty(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

export function shouldRequestModel(env: NodeJS.ProcessEnv): boolean {
  if (env.UNFOLD_SUGGEST_MODEL === 'off') return false;
  if (!nonEmpty(env.DASHSCOPE_API_KEY)) return false;
  if (!nonEmpty(env.DASHSCOPE_BASE_URL)) return false;
  return true;
}

export function chatCompletionsUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, '');
  if (trimmed.endsWith('/compatible-mode/v1')) return `${trimmed}/chat/completions`;
  return `${trimmed}/compatible-mode/v1/chat/completions`;
}

function unwrapFence(text: string): string {
  let raw = text.trim();
  if (!raw.startsWith('```')) return raw;
  raw = raw.replace(/^```(?:json)?[ \t]*\r?\n?/, '');
  raw = raw.replace(/\r?\n?```[ \t]*$/, '');
  return raw.trim();
}

export function parseModelContent(text: string): { ok: true; items: unknown[] } | { ok: false } {
  try {
    const parsed: unknown = JSON.parse(unwrapFence(text));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false };
    const items = (parsed as { items?: unknown }).items;
    if (!Array.isArray(items)) return { ok: false };
    return { ok: true, items };
  } catch {
    return { ok: false };
  }
}

function idForName(
  name: string,
  current: { id: string; canonicalName: string },
  candidates: ModelCandidate[],
): string | null {
  const ids = new Set<string>();
  if (name === current.canonicalName) ids.add(current.id);
  for (const candidate of candidates) {
    if (candidate.canonicalName === name) ids.add(candidate.id);
  }
  if (ids.size !== 1) return null;
  const id = [...ids][0];
  return id ?? null;
}

function filled(value: string | undefined, fallback: string): string {
  if (!value || value.trim() === '') return fallback;
  return value.trim();
}

function blank(value: string | undefined): string {
  return value ?? '';
}

export function mapModelItems(args: {
  items: unknown[];
  slots: number;
  current: { id: string; canonicalName: string };
  candidates: ModelCandidate[];
}): MappedSuggestion[] {
  if (args.slots <= 0) return [];
  const mapped: MappedSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of args.items) {
    if (mapped.length >= args.slots) break;
    const relation = relationItemSchema.safeParse(item);
    if (relation.success) {
      const fromId = idForName(relation.data.fromName, args.current, args.candidates);
      const toId = idForName(relation.data.toName, args.current, args.candidates);
      if (!fromId || !toId || fromId === toId) continue;
      const whatChanged = blank(relation.data.whatChanged);
      const distinction = blank(relation.data.distinction);
      const boundary = blank(relation.data.boundary);
      const note = blank(relation.data.note);
      const validated = validateRelation({
        type: relation.data.type,
        fromId,
        toId,
        whatChanged,
        distinction,
        boundary,
        note,
        condition: '',
      });
      if (!validated.ok) continue;
      const fragmentKey = `model:${[fromId, toId].sort().join(':')}:${relation.data.type}`;
      if (seen.has(fragmentKey)) continue;
      seen.add(fragmentKey);
      mapped.push({
        fragmentKey,
        kind: 'relation',
        summary: filled(relation.data.summary, '模型建议'),
        acceptLabel: filled(relation.data.acceptLabel, '接受'),
        payload: {
          type: relation.data.type,
          fromId,
          toId,
          whatChanged,
          distinction,
          boundary,
          note,
        },
      });
      continue;
    }
    const personal = personalNoteItemSchema.safeParse(item);
    if (!personal.success) continue;
    if (!personal.data.text.includes('我')) continue;
    const fragmentKey = `note:${personal.data.text.replace(/\s/g, '')}`;
    if (seen.has(fragmentKey)) continue;
    seen.add(fragmentKey);
    mapped.push({
      fragmentKey,
      kind: 'personal_note',
      summary: filled(personal.data.summary, '个人理解'),
      acceptLabel: filled(personal.data.acceptLabel, '转成个人理解块'),
      payload: { text: personal.data.text },
    });
  }
  return mapped;
}

export async function requestModelSuggestions(
  env: NodeJS.ProcessEnv,
  input: {
    canonicalName: string;
    plainText: string;
    slots: number;
    candidates: ModelCandidate[];
  },
): Promise<{ ok: true; items: unknown[] } | { ok: false }> {
  try {
    const key = env.DASHSCOPE_API_KEY;
    const base = env.DASHSCOPE_BASE_URL;
    if (!nonEmpty(key) || !nonEmpty(base) || !key || !base) return { ok: false };
    const lines =
      input.candidates.length === 0
        ? '（没有候选）'
        : input.candidates.map((candidate) => `${candidate.canonicalName}：${candidate.coreStatement}`).join('\n');
    const userContent = `当前点：${input.canonicalName}
正文：
${input.plainText}

候选点：
${lines}

只输出 JSON：{"items":[ ... ]}
每项要么是 {"kind":"relation","type":"evolves_from"|"implements"|"applies"|"contrasts"|"analogous","fromName":"","toName":"","whatChanged":"","distinction":"","boundary":"","note":"","summary":"","acceptLabel":""}
要么是 {"kind":"personal_note","text":"","summary":"","acceptLabel":""}
不要超过 ${input.slots} 项。`;
    const response = await fetch(chatCompletionsUrl(base), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen-plus',
        temperature: 0,
        messages: [
          { role: 'system', content: '只输出 JSON，不要写解释。不要建议合并，不要建议 part_of。' },
          { role: 'user', content: userContent },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { ok: false };
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') return { ok: false };
    const choices = (body as { choices?: unknown }).choices;
    if (!Array.isArray(choices)) return { ok: false };
    const first = choices[0];
    if (!first || typeof first !== 'object') return { ok: false };
    const message = (first as { message?: unknown }).message;
    if (!message || typeof message !== 'object') return { ok: false };
    const content = (message as { content?: unknown }).content;
    if (typeof content !== 'string') return { ok: false };
    return parseModelContent(content);
  } catch {
    return { ok: false };
  }
}
