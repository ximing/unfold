import { randomUUID } from 'node:crypto';
import {
  cardContentSchemas,
  createCardBodySchema,
  updateCardBodySchema,
  type OwnerKind,
  type RichDoc,
} from '@unfold/dto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { removeAssetFiles, writeAssetFile } from '../assets/files.js';
import { readImageUpload } from '../assets/upload.js';
import { assets, cards, collectionEdges, edges } from '../db/schema.js';
import {
  activeNode,
  nextCardPosition,
  presentCard,
  removeCard,
  type Database,
} from '../graph/db.js';
import {
  cardNotFound,
  edgeNotFound,
  idParamsSchema,
  invalidBody,
  nodeNotFound,
  type SessionLookup,
} from '../http.js';
import { richDocTooBig, richImageIds, richPlain } from './plain.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Query = Database | Tx;

const richNotOnNode = '富文本只挂在点上';
const richImageMissing = '文稿里有找不到的图片';
const richTooBig = '这篇文稿太大了';

/** 文稿上限是 1 MiB。略放大，好让超限的 JSON 进到自己的 400，而不是被框架直接丢掉。 */
const cardJsonLimit = 2 * 1024 * 1024;

function cardColumns() {
  return {
    id: cards.id,
    ownerKind: cards.ownerKind,
    ownerId: cards.ownerId,
    cardType: cards.cardType,
    position: cards.position,
    content: cards.content,
  };
}

async function ownerMissing(db: Database, userId: string, ownerKind: OwnerKind, ownerId: string) {
  if (ownerKind === 'node') {
    const node = await activeNode(db, userId, ownerId);
    return node ? null : nodeNotFound;
  }

  if (ownerKind === 'edge') {
    const rows = await db
      .select({ id: edges.id })
      .from(edges)
      .where(and(eq(edges.id, ownerId), eq(edges.userId, userId), isNull(edges.deletedAt)))
      .limit(1);
    return rows[0] ? null : edgeNotFound;
  }

  const rows = await db
    .select({ id: collectionEdges.id })
    .from(collectionEdges)
    .where(
      and(
        eq(collectionEdges.id, ownerId),
        eq(collectionEdges.userId, userId),
        isNull(collectionEdges.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ? null : edgeNotFound;
}

async function activeRichCard(db: Query, userId: string, id: string) {
  const rows = await db
    .select({ id: cards.id })
    .from(cards)
    .where(
      and(eq(cards.id, id), eq(cards.userId, userId), eq(cards.cardType, 'rich'), isNull(cards.deletedAt)),
    )
    .limit(1);
  return rows[0] ?? null;
}

type RichWrite =
  | { kind: 'image' }
  | { kind: 'missing' }
  | { kind: 'ok'; row: Parameters<typeof presentCard>[0]; stale: string[] };

async function writeRich(db: Database, userId: string, cardId: string, doc: RichDoc): Promise<RichWrite> {
  const keep = new Set(richImageIds(doc));
  return db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.userId, userId), eq(assets.ownerKind, 'card'), eq(assets.ownerId, cardId)));
    const ownedIds = new Set(owned.map((row) => row.id));
    if ([...keep].some((id) => !ownedIds.has(id))) return { kind: 'image' };

    const updated = await tx
      .update(cards)
      .set({ content: { doc, plain: richPlain(doc) }, updatedAt: new Date() })
      .where(and(eq(cards.id, cardId), eq(cards.userId, userId), isNull(cards.deletedAt)))
      .returning(cardColumns());
    const row = updated[0];
    if (!row) return { kind: 'missing' };

    const stale = owned.map((item) => item.id).filter((id) => !keep.has(id));
    if (stale.length > 0) {
      await tx.delete(assets).where(and(eq(assets.userId, userId), inArray(assets.id, stale)));
    }
    return { kind: 'ok', row, stale };
  });
}

async function updateRich(db: Database, userId: string, cardId: string, body: unknown, reply: FastifyReply) {
  const parsed = cardContentSchemas.rich.safeParse(body);
  if (!parsed.success) return reply.code(400).send(invalidBody());
  const doc = parsed.data.doc;
  if (richDocTooBig(doc)) return reply.code(400).send(invalidBody(richTooBig));

  const outcome = await writeRich(db, userId, cardId, doc);
  if (outcome.kind === 'image') return reply.code(400).send(invalidBody(richImageMissing));
  if (outcome.kind === 'missing') return reply.code(404).send(cardNotFound);
  await removeAssetFiles(outcome.stale);
  return reply.code(200).send(presentCard(outcome.row));
}

export function registerCardRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.post('/api/cards', { bodyLimit: cardJsonLimit }, async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const parsed = createCardBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody());
    if (parsed.data.type === 'rich' && parsed.data.ownerKind !== 'node') {
      return reply.code(400).send(invalidBody(richNotOnNode));
    }

    const missing = await ownerMissing(db, user.id, parsed.data.ownerKind, parsed.data.ownerId);
    if (missing) return reply.code(404).send(missing);

    let content: unknown = parsed.data.content;
    if (parsed.data.type === 'rich') {
      const doc = parsed.data.content.doc;
      if (richDocTooBig(doc)) return reply.code(400).send(invalidBody(richTooBig));
      if (richImageIds(doc).length > 0) return reply.code(400).send(invalidBody(richImageMissing));
      content = { doc, plain: richPlain(doc) };
    }

    const created = await db.transaction(async (tx) => {
      const position = await nextCardPosition(tx, user.id, parsed.data.ownerKind, parsed.data.ownerId);
      const inserted = await tx
        .insert(cards)
        .values({
          userId: user.id,
          ownerKind: parsed.data.ownerKind,
          ownerId: parsed.data.ownerId,
          cardType: parsed.data.type,
          position,
          content,
        })
        .returning(cardColumns());
      return inserted[0];
    });
    if (!created) return reply.code(400).send(invalidBody());
    return reply.code(201).send(presentCard(created));
  });

  app.patch('/api/cards/:id', { bodyLimit: cardJsonLimit }, async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const parsed = updateCardBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody());

    const existing = await db
      .select({
        id: cards.id,
        cardType: cards.cardType,
      })
      .from(cards)
      .where(and(eq(cards.id, params.data.id), eq(cards.userId, user.id), isNull(cards.deletedAt)))
      .limit(1);
    const current = existing[0];
    if (!current) return reply.code(404).send(cardNotFound);
    if (current.cardType === 'rich') return updateRich(db, user.id, current.id, parsed.data.content, reply);
    if (!(current.cardType in cardContentSchemas)) return reply.code(400).send(invalidBody());

    const content = cardContentSchemas[current.cardType as keyof typeof cardContentSchemas].safeParse(
      parsed.data.content,
    );
    if (!content.success) return reply.code(400).send(invalidBody());

    const updated = await db
      .update(cards)
      .set({ content: content.data, updatedAt: new Date() })
      .where(and(eq(cards.id, current.id), eq(cards.userId, user.id), isNull(cards.deletedAt)))
      .returning(cardColumns());
    const row = updated[0];
    if (!row) return reply.code(404).send(cardNotFound);
    return reply.code(200).send(presentCard(row));
  });

  app.post('/api/cards/:id/assets', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    if (!(await activeRichCard(db, user.id, params.data.id))) return reply.code(404).send(cardNotFound);

    const upload = await readImageUpload(request);
    if (!upload.ok) return reply.code(400).send(invalidBody(upload.message));

    const assetId = randomUUID();
    await writeAssetFile(assetId, upload.upload.bytes);
    try {
      const saved = await db.transaction(async (tx) => {
        const card = await activeRichCard(tx, user.id, params.data.id);
        if (!card) return false;
        await tx.insert(assets).values({
          id: assetId,
          userId: user.id,
          ownerKind: 'card',
          ownerId: card.id,
          mime: upload.upload.mime,
          byteSize: upload.upload.bytes.length,
        });
        return true;
      });
      if (!saved) {
        await removeAssetFiles([assetId]);
        return reply.code(404).send(cardNotFound);
      }
    } catch (error) {
      await removeAssetFiles([assetId]);
      throw error;
    }
    return reply.code(201).send({ id: assetId });
  });

  app.delete('/api/cards/:id', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const removed = await removeCard(db, user.id, params.data.id);
    if (!removed) return reply.code(404).send(cardNotFound);
    return reply.code(204).send();
  });
}
