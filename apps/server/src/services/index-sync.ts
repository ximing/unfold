import { createHash } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { blockEntries, objectEntry, type SearchEntry } from '@unfold/search';
import type { createDb } from '../db/client.js';
import { blockIndex, documents, domains, indexOutbox, knowledgeObjects } from '../db/schema.js';

type Database = ReturnType<typeof createDb>;

const TIMEOUT_MS = 8000;
const EMBED_BATCH = 20;
const MEILI_INDEX = 'unfold';
const QDRANT_COLLECTION = 'unfold_chunks';

type MeiliDoc = {
  entry_key: string;
  id: string;
  user_id: string;
  kind: string;
  domain: string;
  title: string;
  aliases: string[];
  core: string;
  text: string;
  entity_id: string;
  object_id: string | null;
  collection_id: string | null;
  promote: boolean;
};

type QdrantPoint = {
  id: string;
  vector: number[];
  payload: MeiliDoc;
};

export type IndexDeps = {
  meiliAdd: (docs: MeiliDoc[]) => Promise<void>;
  meiliDelete: (ids: string[]) => Promise<void>;
  embed: (texts: string[]) => Promise<number[][]>;
  qdrantUpsert: (points: QdrantPoint[]) => Promise<void>;
  qdrantDelete: (ids: string[]) => Promise<void>;
};

type OutboxPayload = { op: 'upsert' } | { op: 'delete'; objectId: string };

type EmbeddingSetup = {
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
};

export function entryPointId(entryId: string): string {
  const hex = createHash('sha256').update(entryId).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function safeError(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err);
  const secrets = [
    process.env.MEILI_ADMIN_KEY,
    process.env.MEILI_SEARCH_KEY,
    process.env.DASHSCOPE_API_KEY,
    process.env.QDRANT_API_KEY,
    process.env.DATABASE_URL,
    process.env.SEED_PASSWORD,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const secret of secrets) msg = msg.split(secret).join('[redacted]');
  return msg.slice(0, 500);
}

function serviceRoot(name: 'MEILI_URL' | 'QDRANT_URL'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value.replace(/\/$/, '');
}

function meiliHeaders(): Headers {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${process.env.MEILI_ADMIN_KEY ?? ''}`);
  headers.set('Content-Type', 'application/json');
  return headers;
}

function qdrantHeaders(): Headers {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  const key = process.env.QDRANT_API_KEY;
  if (key) headers.set('api-key', key);
  return headers;
}

async function responseText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function brief(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 180);
}

function embeddingConfig(): EmbeddingSetup | null {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const baseUrl = process.env.DASHSCOPE_BASE_URL;
  const model = process.env.EMBEDDING_MODEL;
  const rawDimensions = process.env.EMBEDDING_DIMENSIONS;
  if (!apiKey || !baseUrl || !model || rawDimensions == null || rawDimensions === '') return null;
  if (!/^[1-9]\d*$/.test(rawDimensions)) return null;
  const dimensions = Number(rawDimensions);
  if (!Number.isSafeInteger(dimensions) || dimensions <= 0) return null;
  return { apiKey, baseUrl: baseUrl.replace(/\/$/, ''), model, dimensions };
}

function asAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function meiliDocumentKey(id: string): string {
  return id.replaceAll(':', '_');
}

function toMeiliDoc(entry: SearchEntry): MeiliDoc {
  return {
    // Meili 主键不能包含冒号，逻辑 id 仍放在 id。
    entry_key: meiliDocumentKey(entry.id),
    id: entry.id,
    user_id: entry.userId,
    kind: entry.kind,
    domain: entry.domain,
    title: entry.title,
    aliases: [...entry.aliases],
    core: entry.core,
    text: entry.text,
    entity_id: entry.entityId,
    object_id: entry.objectId,
    collection_id: entry.collectionId,
    promote: entry.promote,
  };
}

function clipEmbed(parts: string[]): string {
  const joined = parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('\n');
  if (joined.length === 0) return ' ';
  return joined.slice(0, 4000);
}

function embedText(entry: SearchEntry): string {
  if (entry.kind === 'object') return clipEmbed([entry.title, entry.aliases.join(' '), entry.core]);
  return clipEmbed([entry.title, entry.text]);
}

async function waitMeiliTask(base: string, taskUid: number): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/tasks/${taskUid}`, {
      headers: meiliHeaders(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await responseText(res);
    if (!res.ok) throw new Error(`meili task ${res.status} ${brief(text)}`.trim());
    let status = '';
    let message = '';
    try {
      const body = JSON.parse(text) as { status?: string; error?: { message?: string } };
      status = body.status ?? '';
      message = body.error?.message ?? '';
    } catch {
      status = '';
    }
    if (status === 'succeeded') return;
    if (status === 'failed') throw new Error(`meili task failed ${message}`.trim());
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function meiliSend(path: string, method: string, body: unknown, ok: number[]): Promise<void> {
  const base = serviceRoot('MEILI_URL');
  const res = await fetch(`${base}${path}`, {
    method,
    headers: meiliHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await responseText(res);
  if (!ok.includes(res.status)) throw new Error(`meili ${method} ${path} ${res.status} ${brief(text)}`.trim());
  if (res.status === 409) return;
  try {
    const parsed = JSON.parse(text) as { taskUid?: number };
    if (typeof parsed.taskUid === 'number') await waitMeiliTask(base, parsed.taskUid);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('meili task')) throw err;
  }
}

async function ensureMeiliPrimaryKey(base: string): Promise<void> {
  const infoRes = await fetch(`${base}/indexes/${MEILI_INDEX}`, {
    headers: meiliHeaders(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!infoRes.ok) return;
  const info = (await infoRes.json()) as { primaryKey?: string | null };
  if (info.primaryKey === 'entry_key') return;
  const statsRes = await fetch(`${base}/indexes/${MEILI_INDEX}/stats`, {
    headers: meiliHeaders(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const stats = statsRes.ok ? ((await statsRes.json()) as { numberOfDocuments?: number }) : {};
  if ((stats.numberOfDocuments ?? 0) > 0) return;
  await meiliSend(`/indexes/${MEILI_INDEX}`, 'PATCH', { primaryKey: 'entry_key' }, [200, 202]);
}

async function ensureMeiliIndex(): Promise<void> {
  const base = serviceRoot('MEILI_URL');
  const created = await fetch(`${base}/indexes`, {
    method: 'POST',
    headers: meiliHeaders(),
    body: JSON.stringify({ uid: MEILI_INDEX, primaryKey: 'entry_key' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const createdText = await responseText(created);
  if (created.status !== 200 && created.status !== 202 && created.status !== 409) {
    throw new Error(`meili POST /indexes ${created.status} ${brief(createdText)}`.trim());
  }
  if (created.status !== 409) {
    try {
      const parsed = JSON.parse(createdText) as { taskUid?: number };
      if (typeof parsed.taskUid === 'number') await waitMeiliTask(base, parsed.taskUid);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/already exists/i.test(message)) throw err;
    }
  }
  await ensureMeiliPrimaryKey(base);
  await meiliSend(
    `/indexes/${MEILI_INDEX}/settings`,
    'PATCH',
    {
      searchableAttributes: ['title', 'aliases', 'core', 'text'],
      filterableAttributes: ['user_id', 'kind', 'domain', 'object_id'],
    },
    [200, 202],
  );
}

async function defaultMeiliAdd(docs: MeiliDoc[]): Promise<void> {
  if (docs.length === 0) return;
  await ensureMeiliIndex();
  await meiliSend(`/indexes/${MEILI_INDEX}/documents`, 'POST', docs, [200, 202]);
}

async function defaultMeiliDelete(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await ensureMeiliIndex();
  const base = serviceRoot('MEILI_URL');
  const keys = ids.map((id) => meiliDocumentKey(id));
  const res = await fetch(`${base}/indexes/${MEILI_INDEX}/documents/delete-batch`, {
    method: 'POST',
    headers: meiliHeaders(),
    body: JSON.stringify(keys),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return;
  const text = await responseText(res);
  if (res.status !== 200 && res.status !== 202) {
    throw new Error(`meili delete ${res.status} ${brief(text)}`.trim());
  }
  try {
    const parsed = JSON.parse(text) as { taskUid?: number };
    if (typeof parsed.taskUid === 'number') await waitMeiliTask(base, parsed.taskUid);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('meili task')) throw err;
  }
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

async function defaultEmbed(texts: string[]): Promise<number[][]> {
  const config = embeddingConfig();
  if (!config) throw new Error('embedding is not configured');
  const vectors: number[][] = new Array(texts.length);
  for (let offset = 0; offset < texts.length; offset += EMBED_BATCH) {
    const batch = texts.slice(offset, offset + EMBED_BATCH);
    const request = embeddingRequest(config, batch);
    const res = await fetch(request.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await responseText(res);
    if (!res.ok) throw new Error(`embed ${res.status} ${brief(text)}`.trim());
    let rows: Array<{ embedding?: number[]; index?: number; text_index?: number }> = [];
    try {
      const body = JSON.parse(text) as {
        data?: Array<{ embedding?: number[]; index?: number; text_index?: number }>;
        output?: { embeddings?: Array<{ embedding?: number[]; index?: number; text_index?: number }> };
      };
      rows = body.data ?? body.output?.embeddings ?? [];
    } catch {
      throw new Error('embed response is not json');
    }
    if (rows.length !== batch.length) throw new Error('embed batch size mismatch');
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row) throw new Error('embed dimension mismatch');
      const index = typeof row.index === 'number' ? row.index : typeof row.text_index === 'number' ? row.text_index : i;
      if (!row.embedding || row.embedding.length !== config.dimensions) throw new Error('embed dimension mismatch');
      vectors[offset + index] = row.embedding;
    }
  }
  if (vectors.some((vector) => !vector || vector.length !== config.dimensions)) {
    throw new Error('embed dimension mismatch');
  }
  return vectors;
}

async function ensureQdrantCollection(size: number): Promise<void> {
  const base = serviceRoot('QDRANT_URL');
  const existing = await fetch(`${base}/collections/${QDRANT_COLLECTION}`, {
    method: 'GET',
    headers: qdrantHeaders(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (existing.status === 200) return;
  if (existing.status !== 404) {
    throw new Error(`qdrant collection ${existing.status} ${brief(await responseText(existing))}`.trim());
  }
  const created = await fetch(`${base}/collections/${QDRANT_COLLECTION}`, {
    method: 'PUT',
    headers: qdrantHeaders(),
    body: JSON.stringify({ vectors: { size, distance: 'Cosine' } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (created.ok) return;
  const again = await fetch(`${base}/collections/${QDRANT_COLLECTION}`, {
    method: 'GET',
    headers: qdrantHeaders(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (again.status === 200) return;
  throw new Error(`qdrant create ${created.status} ${brief(await responseText(created))}`.trim());
}

async function defaultQdrantUpsert(points: QdrantPoint[]): Promise<void> {
  if (points.length === 0) return;
  const size = points[0]?.vector.length ?? 0;
  if (size <= 0 || points.some((point) => point.vector.length !== size)) {
    throw new Error('qdrant vector size mismatch');
  }
  await ensureQdrantCollection(size);
  const base = serviceRoot('QDRANT_URL');
  const res = await fetch(`${base}/collections/${QDRANT_COLLECTION}/points?wait=true`, {
    method: 'PUT',
    headers: qdrantHeaders(),
    body: JSON.stringify({ points }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`qdrant upsert ${res.status} ${brief(await responseText(res))}`.trim());
}

async function deleteMeiliByObjectId(objectId: string): Promise<void> {
  await ensureMeiliIndex();
  const base = serviceRoot('MEILI_URL');
  const res = await fetch(`${base}/indexes/${MEILI_INDEX}/documents/delete`, {
    method: 'POST',
    headers: meiliHeaders(),
    body: JSON.stringify({ filter: `object_id = "${objectId}"` }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return;
  const text = await responseText(res);
  if (res.status !== 200 && res.status !== 202) {
    throw new Error(`meili delete filter ${res.status} ${brief(text)}`.trim());
  }
  let taskUid: number | undefined;
  try {
    const parsed = JSON.parse(text) as { taskUid?: number };
    if (typeof parsed.taskUid === 'number') taskUid = parsed.taskUid;
  } catch {
    throw new Error(`meili delete filter ${res.status}`);
  }
  if (taskUid === undefined) return;
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const task = await fetch(`${base}/tasks/${taskUid}`, {
      headers: meiliHeaders(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const taskText = await responseText(task);
    if (!task.ok) throw new Error(`meili task ${task.status} ${brief(taskText)}`.trim());
    const body = JSON.parse(taskText) as { status?: string; error?: { message?: string } };
    if (body.status === 'succeeded') return;
    if (body.status === 'failed') throw new Error(`meili task failed ${body.error?.message ?? ''}`.trim());
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('meili task timeout');
}

async function deleteQdrantByObjectId(objectId: string): Promise<void> {
  const base = serviceRoot('QDRANT_URL');
  const existing = await fetch(`${base}/collections/${QDRANT_COLLECTION}`, {
    method: 'GET',
    headers: qdrantHeaders(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (existing.status === 404) return;
  if (existing.status !== 200) {
    throw new Error(`qdrant collection ${existing.status} ${brief(await responseText(existing))}`.trim());
  }
  const indexed = await fetch(`${base}/collections/${QDRANT_COLLECTION}/index?wait=true`, {
    method: 'PUT',
    headers: qdrantHeaders(),
    body: JSON.stringify({ field_name: 'object_id', field_schema: 'keyword' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!indexed.ok && indexed.status !== 409) {
    const detail = brief(await responseText(indexed));
    if (!/exist/i.test(detail)) throw new Error(`qdrant index ${indexed.status} ${detail}`.trim());
  }
  const res = await fetch(`${base}/collections/${QDRANT_COLLECTION}/points/delete?wait=true`, {
    method: 'POST',
    headers: qdrantHeaders(),
    body: JSON.stringify({ filter: { must: [{ key: 'object_id', match: { value: objectId } }] } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return;
  if (!res.ok) throw new Error(`qdrant delete ${res.status} ${brief(await responseText(res))}`.trim());
}

async function deleteIndexedObject(objectId: string): Promise<void> {
  await deleteMeiliByObjectId(objectId);
  await deleteQdrantByObjectId(objectId);
}

async function defaultQdrantDelete(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const base = serviceRoot('QDRANT_URL');
  const existing = await fetch(`${base}/collections/${QDRANT_COLLECTION}`, {
    method: 'GET',
    headers: qdrantHeaders(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (existing.status === 404) return;
  if (existing.status !== 200) {
    throw new Error(`qdrant collection ${existing.status} ${brief(await responseText(existing))}`.trim());
  }
  const res = await fetch(`${base}/collections/${QDRANT_COLLECTION}/points/delete?wait=true`, {
    method: 'POST',
    headers: qdrantHeaders(),
    body: JSON.stringify({ points: ids }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return;
  if (!res.ok) throw new Error(`qdrant delete ${res.status} ${brief(await responseText(res))}`.trim());
}

function defaultDeps(): IndexDeps {
  return {
    meiliAdd: defaultMeiliAdd,
    meiliDelete: defaultMeiliDelete,
    embed: defaultEmbed,
    qdrantUpsert: defaultQdrantUpsert,
    qdrantDelete: defaultQdrantDelete,
  };
}

type LoadedObject = {
  id: string;
  userId: string;
  domainId: string;
  documentId: string | null;
  status: string;
  deletedAt: Date | null;
  canonicalName: string;
  coreStatement: string;
  aliases: unknown;
};

async function loadForIndex(
  db: Database,
  userId: string,
  objectId: string,
): Promise<{ object: LoadedObject; domain: string; documentId: string | null; blocks: Array<{ blockId: string; blockType: string; textPreview: string }> } | null> {
  const objects = await db
    .select({
      id: knowledgeObjects.id,
      userId: knowledgeObjects.userId,
      domainId: knowledgeObjects.domainId,
      documentId: knowledgeObjects.documentId,
      status: knowledgeObjects.status,
      deletedAt: knowledgeObjects.deletedAt,
      canonicalName: knowledgeObjects.canonicalName,
      coreStatement: knowledgeObjects.coreStatement,
      aliases: knowledgeObjects.aliases,
    })
    .from(knowledgeObjects)
    .where(and(eq(knowledgeObjects.id, objectId), eq(knowledgeObjects.userId, userId)))
    .limit(1);
  const object = objects[0];
  if (!object) return null;

  const domainRows = await db
    .select({ name: domains.name })
    .from(domains)
    .where(eq(domains.id, object.domainId))
    .limit(1);
  const domain = domainRows[0]?.name ?? '';

  let documentId = object.documentId;
  if (!documentId) {
    const docs = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.userId, userId), eq(documents.ownerType, 'object'), eq(documents.ownerId, objectId)))
      .limit(1);
    documentId = docs[0]?.id ?? null;
  }

  const blocks = documentId
    ? await db
        .select({
          blockId: blockIndex.blockId,
          blockType: blockIndex.blockType,
          textPreview: blockIndex.textPreview,
        })
        .from(blockIndex)
        .where(and(eq(blockIndex.documentId, documentId), eq(blockIndex.userId, userId), isNull(blockIndex.deletedAt)))
    : [];

  return { object, domain, documentId, blocks };
}

function buildEntries(
  object: LoadedObject,
  domain: string,
  blocks: Array<{ blockId: string; blockType: string; textPreview: string }>,
): SearchEntry[] {
  const base = {
    userId: object.userId,
    domain,
    title: object.canonicalName,
    core: object.coreStatement,
  };
  return [
    objectEntry({
      ...base,
      objectId: object.id,
      aliases: asAliases(object.aliases),
    }),
    ...blockEntries({
      ...base,
      ownerType: 'object',
      ownerId: object.id,
      blocks: blocks.map((block) => ({
        blockId: block.blockId,
        blockType: block.blockType,
        text: block.textPreview,
      })),
    }),
  ];
}

async function writeOutbox(db: Database, userId: string, documentId: string, payload: OutboxPayload, err: unknown): Promise<void> {
  await db.insert(indexOutbox).values({
    userId,
    documentId,
    payload,
    lastError: safeError(err),
  });
}

async function softDeleteUpsertOutbox(db: Database, documentId: string): Promise<void> {
  await db
    .update(indexOutbox)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(indexOutbox.documentId, documentId),
        isNull(indexOutbox.deletedAt),
        sql`(${indexOutbox.payload}->>'op') = 'upsert'`,
      ),
    );
}

export async function syncObjectIndex(
  db: Database,
  userId: string,
  objectId: string,
  override?: Partial<IndexDeps>,
): Promise<void> {
  try {
    if (process.env.UNFOLD_INDEX === 'off') return;
    const deps: IndexDeps = { ...defaultDeps(), ...override };
    const loaded = await loadForIndex(db, userId, objectId);
    if (!loaded) return;
    const entries = buildEntries(loaded.object, loaded.domain, loaded.blocks);
    const inactive = loaded.object.deletedAt != null || loaded.object.status !== 'active';
    if (inactive) {
      try {
        await deleteIndexedObject(objectId);
      } catch (err) {
        if (loaded.documentId) await writeOutbox(db, userId, loaded.documentId, { op: 'delete', objectId }, err);
      }
      return;
    }

    try {
      await deleteIndexedObject(objectId);
    } catch (err) {
      if (loaded.documentId) await writeOutbox(db, userId, loaded.documentId, { op: 'upsert' }, err);
      return;
    }

    try {
      await deps.meiliAdd(entries.map((entry) => toMeiliDoc(entry)));
    } catch (err) {
      if (loaded.documentId) await writeOutbox(db, userId, loaded.documentId, { op: 'upsert' }, err);
      return;
    }

    const embedCfg = embeddingConfig();
    if (!embedCfg) {
      if (loaded.documentId) await softDeleteUpsertOutbox(db, loaded.documentId);
      return;
    }

    try {
      const vectors = await deps.embed(entries.map((entry) => embedText(entry)));
      if (vectors.length !== entries.length || vectors.some((vector) => vector.length !== embedCfg.dimensions)) {
        throw new Error('embed dimension mismatch');
      }
      await deps.qdrantUpsert(
        entries.map((entry, index) => ({
          id: entryPointId(entry.id),
          vector: vectors[index] ?? [],
          payload: toMeiliDoc(entry),
        })),
      );
      if (loaded.documentId) await softDeleteUpsertOutbox(db, loaded.documentId);
    } catch (err) {
      if (loaded.documentId) await writeOutbox(db, userId, loaded.documentId, { op: 'upsert' }, err);
    }
  } catch {
    return;
  }
}
