import { normalizeName, searchResponseSchema, type SearchGroup, type SearchResponse } from '@unfold/dto';
import { rrf } from '@unfold/search';
import { sql } from 'drizzle-orm';
import type { createDb } from '../db/client.js';

type Database = ReturnType<typeof createDb>;

const TIMEOUT_MS = 8000;
const MEILI_INDEX = 'unfold';
const QDRANT_COLLECTION = 'unfold_chunks';
const DEGRADED_NOTICE = '检索降级中';
const SEARCH_KINDS = ['object', 'block', 'question', 'decision', 'collection_sentence'] as const;
const LIKE_ESCAPE = sql.raw("escape e'\\\\'");

type SearchKind = (typeof SEARCH_KINDS)[number];

type Hit = {
  id: string;
  kind: SearchKind;
  text: string;
  core: string;
  title: string;
  domain: string;
  objectId: string | null;
};

export type SearchClientOverride = {
  meiliSearch?: (q: string, userId: string) => Promise<Hit[]>;
  embedQuery?: (q: string) => Promise<number[]>;
  qdrantSearch?: (vector: number[], userId: string) => Promise<Hit[]>;
  rerank?: (q: string, documents: { id: string; text: string }[]) => Promise<string[]>;
};

type EmbeddingSetup = {
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
};

type RerankSetup = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

type RerankRow = {
  index?: number;
  relevance_score?: number;
  score?: number;
};

type IlikeRow = {
  object_id: string;
  title: string;
  domain: string;
  core: string;
  kind: string;
  entity_id: string;
  snippet: string;
};

function isKind(value: string): value is SearchKind {
  return (SEARCH_KINDS as readonly string[]).includes(value);
}

function requiredRoot(name: 'MEILI_URL' | 'QDRANT_URL'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value.replace(/\/$/, '');
}

async function responseText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

async function postJson(
  url: string,
  body: unknown,
  headers: Headers,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await responseText(res);
  if (!res.ok) return { status: res.status, json: null };
  try {
    return { status: res.status, json: text ? (JSON.parse(text) as unknown) : null };
  } catch {
    throw new Error('response is not json');
  }
}

function readDimensions(): number | null {
  const raw = process.env.EMBEDDING_DIMENSIONS;
  if (raw == null || !/^[1-9]\d*$/.test(raw)) return null;
  const dimensions = Number(raw);
  if (!Number.isSafeInteger(dimensions) || dimensions <= 0) return null;
  return dimensions;
}

function embeddingConfig(): EmbeddingSetup | null {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const baseUrl = process.env.DASHSCOPE_BASE_URL;
  const model = process.env.EMBEDDING_MODEL;
  const dimensions = readDimensions();
  if (!apiKey || !baseUrl || !model || dimensions == null) return null;
  return { apiKey, baseUrl: baseUrl.replace(/\/$/, ''), model, dimensions };
}

function rerankConfig(): RerankSetup | null {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const baseUrl = process.env.DASHSCOPE_BASE_URL;
  const model = process.env.RERANK_MODEL;
  if (!apiKey || !baseUrl || !model) return null;
  return { apiKey, baseUrl: baseUrl.replace(/\/$/, ''), model };
}

function usesMultimodalEmbedding(model: string): boolean {
  return /vl-embedding|multimodal-embedding|embedding-vision/i.test(model);
}

function embeddingRequest(config: EmbeddingSetup, batch: string[]): { url: string; body: unknown } {
  const base = config.baseUrl;
  const openaiBody = { model: config.model, input: batch, dimensions: config.dimensions };
  if (base.endsWith('/embeddings')) return { url: base, body: openaiBody };
  let pathname = '';
  try {
    pathname = new URL(base).pathname.replace(/\/$/, '');
  } catch {
    pathname = '';
  }
  if (pathname.endsWith('/api/v1') && usesMultimodalEmbedding(config.model)) {
    return {
      url: `${base}/services/embeddings/multimodal-embedding/multimodal-embedding`,
      body: {
        model: config.model,
        input: { contents: batch.map((text) => ({ text })) },
        parameters: { dimension: config.dimensions, output_type: 'dense' },
      },
    };
  }
  if (pathname.endsWith('/api/v1')) {
    return {
      url: `${base}/services/embeddings/text-embedding/text-embedding`,
      body: {
        model: config.model,
        input: { texts: batch },
        parameters: { dimension: config.dimensions, output_type: 'dense' },
      },
    };
  }
  return { url: `${base}/embeddings`, body: openaiBody };
}

async function embedTexts(config: EmbeddingSetup, texts: string[]): Promise<number[][]> {
  const request = embeddingRequest(config, texts);
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${config.apiKey}`);
  headers.set('Content-Type', 'application/json');
  const result = await postJson(request.url, request.body, headers);
  if (result.status !== 200) throw new Error(`embed ${result.status}`);
  const body = result.json as {
    data?: Array<{ embedding?: number[]; index?: number; text_index?: number }>;
    output?: { embeddings?: Array<{ embedding?: number[]; index?: number; text_index?: number }> };
  };
  const rows = body?.data ?? body?.output?.embeddings ?? [];
  if (rows.length !== texts.length) throw new Error('embed batch size mismatch');
  const vectors: number[][] = new Array(texts.length);
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row) throw new Error('embed dimension mismatch');
    const index =
      typeof row.index === 'number' ? row.index : typeof row.text_index === 'number' ? row.text_index : i;
    if (!row.embedding || row.embedding.length !== config.dimensions) throw new Error('embed dimension mismatch');
    vectors[index] = row.embedding;
  }
  if (vectors.some((vector) => !vector || vector.length !== config.dimensions)) {
    throw new Error('embed dimension mismatch');
  }
  return vectors;
}

async function defaultEmbedQuery(q: string): Promise<number[]> {
  const config = embeddingConfig();
  if (!config) throw new Error('embedding is not configured');
  const vector = (await embedTexts(config, [q]))[0];
  if (!vector || vector.length !== config.dimensions) throw new Error('embed dimension mismatch');
  return vector;
}

function parseIndexedHit(value: unknown, userId: string, requireUser: boolean): Hit | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  const kindRaw = typeof row.kind === 'string' ? row.kind : '';
  if (!id || !isKind(kindRaw)) return null;
  const owner = typeof row.user_id === 'string' ? row.user_id : '';
  if (requireUser) {
    if (owner !== userId) return null;
  } else if (owner !== '' && owner !== userId) {
    return null;
  }
  let objectId = typeof row.object_id === 'string' && row.object_id !== '' ? row.object_id : null;
  if (!objectId && kindRaw === 'object' && id.startsWith('object:')) objectId = id.slice('object:'.length);
  return {
    id,
    kind: kindRaw,
    text: typeof row.text === 'string' ? row.text : '',
    core: typeof row.core === 'string' ? row.core : '',
    title: typeof row.title === 'string' ? row.title : '',
    domain: typeof row.domain === 'string' ? row.domain : '',
    objectId,
  };
}

function dedupeHits(hits: Hit[]): Hit[] {
  const out: Hit[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    out.push(hit);
  }
  return out;
}

async function defaultMeiliSearch(q: string, userId: string): Promise<Hit[]> {
  const base = requiredRoot('MEILI_URL');
  const key = process.env.MEILI_SEARCH_KEY;
  if (!key) throw new Error('meili search key is not set');
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${key}`);
  headers.set('Content-Type', 'application/json');
  const result = await postJson(
    `${base}/indexes/${MEILI_INDEX}/search`,
    { q, limit: 20, filter: `user_id = "${userId}"` },
    headers,
  );
  if (result.status !== 200) throw new Error(`meili search ${result.status}`);
  const hits =
    result.json && typeof result.json === 'object' && Array.isArray((result.json as { hits?: unknown }).hits)
      ? (result.json as { hits: unknown[] }).hits
      : null;
  if (!hits) throw new Error('meili search has no hits');
  const parsed: Hit[] = [];
  for (const hit of hits) {
    const item = parseIndexedHit(hit, userId, false);
    if (item) parsed.push(item);
  }
  return dedupeHits(parsed).slice(0, 20);
}

function qdrantHeaders(): Headers {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  const key = process.env.QDRANT_API_KEY;
  if (key) headers.set('api-key', key);
  return headers;
}

function qdrantPoints(body: unknown): unknown[] {
  if (!body || typeof body !== 'object') return [];
  const result = (body as { result?: unknown }).result;
  if (Array.isArray(result)) return result;
  if (result && typeof result === 'object' && Array.isArray((result as { points?: unknown }).points)) {
    return (result as { points: unknown[] }).points;
  }
  return [];
}

async function defaultQdrantSearch(vector: number[], userId: string): Promise<Hit[]> {
  const base = requiredRoot('QDRANT_URL');
  const headers = qdrantHeaders();
  const filter = { must: [{ key: 'user_id', match: { value: userId } }] };
  const queryUrl = `${base}/collections/${QDRANT_COLLECTION}/points/query`;
  let result = await postJson(queryUrl, { query: vector, limit: 20, with_payload: true, filter }, headers);
  if (result.status === 400) {
    result = await postJson(
      queryUrl,
      { query: { nearest: vector }, limit: 20, with_payload: true, filter },
      headers,
    );
  }
  if (result.status === 404) {
    result = await postJson(
      `${base}/collections/${QDRANT_COLLECTION}/points/search`,
      { vector, limit: 20, with_payload: true, filter },
      headers,
    );
  }
  if (result.status !== 200) throw new Error(`qdrant search ${result.status}`);
  const parsed: Hit[] = [];
  for (const point of qdrantPoints(result.json)) {
    const payload =
      point && typeof point === 'object' && 'payload' in point ? (point as { payload?: unknown }).payload : point;
    const hit = parseIndexedHit(payload, userId, true);
    if (hit) parsed.push(hit);
  }
  return dedupeHits(parsed).slice(0, 20);
}

async function vectorHits(q: string, userId: string, override?: SearchClientOverride): Promise<Hit[] | null> {
  const setup = embeddingConfig();
  if (!override?.embedQuery && !setup) return null;
  try {
    const vector = override?.embedQuery ? await override.embedQuery(q) : await defaultEmbedQuery(q);
    const dimensions = setup?.dimensions ?? readDimensions();
    if (dimensions == null || vector.length !== dimensions) return null;
    return await (override?.qdrantSearch ?? defaultQdrantSearch)(vector, userId);
  } catch {
    return null;
  }
}

function rerankDocument(hit: Hit): string {
  const detail = hit.text.trim() !== '' ? hit.text : hit.core;
  const combined = `${hit.title}\n${detail}`.slice(0, 500);
  return combined.trim().length > 0 ? combined : ' ';
}

function scoreOf(row: RerankRow): number | null {
  if (typeof row.relevance_score === 'number') return row.relevance_score;
  if (typeof row.score === 'number') return row.score;
  return null;
}

function readRerankRows(body: unknown): RerankRow[] {
  if (!body || typeof body !== 'object') return [];
  const record = body as Record<string, unknown>;
  const output = record.output;
  const lists = [
    output && typeof output === 'object' ? (output as { results?: unknown }).results : undefined,
    record.results,
    record.data,
  ];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    return list.filter((row): row is RerankRow => Boolean(row) && typeof row === 'object');
  }
  return [];
}

function rankRows(rows: RerankRow[]): RerankRow[] {
  return rows
    .map((row, position) => ({ row, position }))
    .sort((left, right) => {
      const leftScore = scoreOf(left.row);
      const rightScore = scoreOf(right.row);
      if (leftScore != null && rightScore != null && leftScore !== rightScore) return rightScore - leftScore;
      return left.position - right.position;
    })
    .map((item) => item.row);
}

async function defaultRerank(q: string, documents: { id: string; text: string }[]): Promise<string[]> {
  const config = rerankConfig();
  if (!config) throw new Error('rerank is not configured');
  const texts = documents.map((doc) => doc.text);
  const topN = Math.min(10, texts.length);
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${config.apiKey}`);
  headers.set('Content-Type', 'application/json');
  const nativeUrl = `${config.baseUrl}/services/rerank/text-rerank/text-rerank`;
  let result = await postJson(
    nativeUrl,
    {
      model: config.model,
      input: { query: q, documents: texts },
      parameters: { return_documents: false, top_n: topN },
    },
    headers,
  );
  if (result.status !== 200 && result.status !== 401 && result.status !== 403) {
    let origin = '';
    try {
      origin = new URL(config.baseUrl).origin;
    } catch {
      origin = '';
    }
    const alt = origin ? `${origin}/compatible-api/v1/reranks` : '';
    if (alt && alt !== nativeUrl) {
      result = await postJson(alt, { model: config.model, query: q, documents: texts, top_n: topN }, headers);
    }
  }
  if (result.status !== 200) throw new Error(`rerank ${result.status}`);
  const ordered: string[] = [];
  const seen = new Set<number>();
  for (const row of rankRows(readRerankRows(result.json))) {
    if (typeof row.index !== 'number' || !Number.isInteger(row.index)) continue;
    if (row.index < 0 || row.index >= documents.length || seen.has(row.index)) continue;
    seen.add(row.index);
    const id = documents[row.index]?.id;
    if (!id) continue;
    ordered.push(id);
  }
  if (ordered.length === 0) throw new Error('rerank empty');
  return ordered;
}

async function applyRerank(
  q: string,
  hits: Hit[],
  override?: SearchClientOverride,
): Promise<{ ok: boolean; hits: Hit[] }> {
  const enabled = Boolean(override?.rerank) || Boolean(process.env.DASHSCOPE_API_KEY && process.env.RERANK_MODEL);
  if (!enabled) return { ok: false, hits: hits.slice(0, 10) };
  if (hits.length === 0) return { ok: true, hits: [] };
  try {
    const documents = hits.slice(0, 20).map((hit) => ({ id: hit.id, text: rerankDocument(hit) }));
    const order = await (override?.rerank ?? defaultRerank)(q, documents);
    const byId = new Map(hits.map((hit) => [hit.id, hit]));
    const ranked: Hit[] = [];
    const seen = new Set<string>();
    for (const id of order) {
      if (seen.has(id)) continue;
      const hit = byId.get(id);
      if (!hit) continue;
      seen.add(id);
      ranked.push(hit);
    }
    if (ranked.length === 0) return { ok: false, hits: hits.slice(0, 10) };
    return { ok: true, hits: ranked.slice(0, 10) };
  } catch {
    return { ok: false, hits: hits.slice(0, 10) };
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function displayText(hit: Hit): string {
  if (hit.kind === 'object') return hit.core || hit.title;
  return hit.text || hit.core;
}

function groupHits(ordered: Hit[]): SearchGroup[] {
  const groups: SearchGroup[] = [];
  const indexByKey = new Map<string, number>();
  for (const hit of ordered) {
    const key = hit.objectId ?? hit.id;
    let index = indexByKey.get(key);
    if (index === undefined) {
      index = groups.length;
      indexByKey.set(key, index);
      groups.push({
        objectId: hit.objectId,
        title: hit.title,
        domain: hit.domain,
        core: hit.core,
        hits: [],
      });
    }
    const group = groups[index];
    if (!group || group.hits.some((item) => item.id === hit.id)) continue;
    group.hits.push({
      id: hit.id,
      kind: hit.kind,
      text: displayText(hit),
      promote: hit.kind === 'collection_sentence',
    });
  }
  return groups;
}

function responseOf(hits: Hit[], degraded: boolean): SearchResponse {
  return searchResponseSchema.parse({
    degraded,
    notice: degraded ? DEGRADED_NOTICE : '',
    groups: groupHits(hits),
  });
}

async function ilikeHits(db: Database, userId: string, q: string): Promise<Hit[]> {
  const rawPattern = `%${escapeLike(q)}%`;
  const normalizedPattern = `%${escapeLike(normalizeName(q))}%`;
  const result = await db.execute<IlikeRow>(sql`
    select object_id, title, domain, core, kind, entity_id, snippet
    from (
      select
        o.id as object_id,
        o.canonical_name as title,
        d.name as domain,
        o.core_statement as core,
        'object' as kind,
        o.id as entity_id,
        o.core_statement as snippet,
        case
          when o.normalized_name ilike ${normalizedPattern} ${LIKE_ESCAPE} then 0
          when o.canonical_name ilike ${rawPattern} ${LIKE_ESCAPE} then 1
          when o.core_statement ilike ${rawPattern} ${LIKE_ESCAPE} then 2
          else 3
        end as rank_hint
      from knowledge_objects o
      join domains d on d.id = o.domain_id
      where o.user_id = ${userId}
        and o.deleted_at is null
        and o.status = 'active'
        and (
          o.canonical_name ilike ${rawPattern} ${LIKE_ESCAPE}
          or o.normalized_name ilike ${normalizedPattern} ${LIKE_ESCAPE}
          or o.core_statement ilike ${rawPattern} ${LIKE_ESCAPE}
          or (
            jsonb_typeof(o.aliases) = 'array'
            and exists (
              select 1
              from jsonb_array_elements_text(o.aliases) as alias(value)
              where alias.value ilike ${rawPattern} ${LIKE_ESCAPE}
            )
          )
        )
      union all
      select
        o.id as object_id,
        o.canonical_name as title,
        d.name as domain,
        o.core_statement as core,
        case b.block_type
          when 'question' then 'question'
          when 'decision' then 'decision'
          else 'block'
        end as kind,
        b.block_id as entity_id,
        b.text_preview as snippet,
        4 as rank_hint
      from block_index b
      join documents doc on doc.id = b.document_id
      join knowledge_objects o on o.id = doc.owner_id and doc.owner_type = 'object'
      join domains d on d.id = o.domain_id
      where b.user_id = ${userId}
        and b.deleted_at is null
        and doc.deleted_at is null
        and doc.user_id = ${userId}
        and o.user_id = ${userId}
        and o.deleted_at is null
        and o.status = 'active'
        and b.block_type not in ('object_ref', 'collection_ref')
        and b.text_preview ilike ${rawPattern} ${LIKE_ESCAPE}
    ) matches
    order by rank_hint asc, entity_id asc
    limit 20
  `);
  const hits: Hit[] = [];
  for (const row of result.rows) {
    if (!isKind(row.kind) || !row.entity_id || !row.object_id) continue;
    const id =
      row.kind === 'object'
        ? `object:${row.entity_id}`
        : row.kind === 'question'
          ? `question:${row.entity_id}`
          : row.kind === 'decision'
            ? `decision:${row.entity_id}`
            : `block:${row.entity_id}`;
    hits.push({
      id,
      kind: row.kind,
      text: row.kind === 'object' ? '' : (row.snippet ?? ''),
      core: row.core ?? '',
      title: row.title ?? '',
      domain: row.domain ?? '',
      objectId: row.object_id,
    });
  }
  return dedupeHits(hits).slice(0, 20);
}

export async function searchLibrary(
  db: Database,
  userId: string,
  q: string,
  override?: SearchClientOverride,
): Promise<SearchResponse> {
  let meiliHits: Hit[] | null = null;
  try {
    meiliHits = await (override?.meiliSearch ?? defaultMeiliSearch)(q, userId);
  } catch {
    meiliHits = null;
  }

  if (!meiliHits) {
    return responseOf((await ilikeHits(db, userId, q)).slice(0, 10), true);
  }

  const vector = await vectorHits(q, userId, override);
  const vectorOk = vector != null;
  const byId = new Map<string, Hit>();
  for (const hit of vector ?? []) byId.set(hit.id, hit);
  for (const hit of meiliHits) byId.set(hit.id, hit);

  const lists = [dedupeHits(meiliHits).map((hit) => hit.id)];
  if (vectorOk) lists.push(dedupeHits(vector ?? []).map((hit) => hit.id));
  const fused = rrf(lists)
    .slice(0, 20)
    .flatMap((row) => {
      const hit = byId.get(row.id);
      return hit ? [hit] : [];
    });
  const reranked = await applyRerank(q, fused, override);
  return responseOf(reranked.hits, !(vectorOk && reranked.ok));
}
