import {
  cardContentSchemas,
  createCardBodySchema,
  updateCardBodySchema,
  type OwnerKind,
} from '@unfold/dto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { cards, collectionEdges, edges } from '../db/schema.js';
import { activeNode, type Database, nextCardPosition, presentCard } from '../graph/db.js';
import {
  cardNotFound,
  edgeNotFound,
  idParamsSchema,
  invalidBody,
  nodeNotFound,
  type SessionLookup,
} from '../http.js';

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

export function registerCardRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.post('/api/cards', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const parsed = createCardBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody());

    const missing = await ownerMissing(db, user.id, parsed.data.ownerKind, parsed.data.ownerId);
    if (missing) return reply.code(404).send(missing);

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
          content: parsed.data.content,
        })
        .returning({
          id: cards.id,
          ownerKind: cards.ownerKind,
          ownerId: cards.ownerId,
          cardType: cards.cardType,
          position: cards.position,
          content: cards.content,
        });
      return inserted[0];
    });
    if (!created) return reply.code(400).send(invalidBody());
    return reply.code(201).send(presentCard(created));
  });

  app.patch('/api/cards/:id', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const parsed = updateCardBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody());

    const existing = await db
      .select({
        id: cards.id,
        ownerKind: cards.ownerKind,
        ownerId: cards.ownerId,
        cardType: cards.cardType,
        position: cards.position,
      })
      .from(cards)
      .where(and(eq(cards.id, params.data.id), eq(cards.userId, user.id), isNull(cards.deletedAt)))
      .limit(1);
    const current = existing[0];
    if (!current) return reply.code(404).send(cardNotFound);
    if (!(current.cardType in cardContentSchemas)) return reply.code(400).send(invalidBody());

    const content = cardContentSchemas[current.cardType as keyof typeof cardContentSchemas].safeParse(
      parsed.data.content,
    );
    if (!content.success) return reply.code(400).send(invalidBody());

    const updated = await db
      .update(cards)
      .set({ content: content.data, updatedAt: new Date() })
      .where(and(eq(cards.id, current.id), eq(cards.userId, user.id), isNull(cards.deletedAt)))
      .returning({
        id: cards.id,
        ownerKind: cards.ownerKind,
        ownerId: cards.ownerId,
        cardType: cards.cardType,
        position: cards.position,
        content: cards.content,
      });
    const row = updated[0];
    if (!row) return reply.code(404).send(cardNotFound);
    return reply.code(200).send(presentCard(row));
  });

  app.delete('/api/cards/:id', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const updated = await db
      .update(cards)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(cards.id, params.data.id), eq(cards.userId, user.id), isNull(cards.deletedAt)))
      .returning({ id: cards.id });
    if (!updated[0]) return reply.code(404).send(cardNotFound);
    return reply.code(204).send();
  });
}
