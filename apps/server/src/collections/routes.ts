import {
  addMemberBodySchema,
  createCollectionBodySchema,
  createInclusionBodySchema,
  createNodeBodySchema,
  edgeAppearanceSchema,
  placementsBodySchema,
  updateCollectionBodySchema,
  updateInclusionBodySchema,
  type EdgeAppearance,
} from '@unfold/dto';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { cards, collectionEdges, collections, memberships, nodes } from '../db/schema.js';
import {
  activeCollection,
  activeNode,
  type Database,
  removeCollection,
} from '../graph/db.js';
import { assembleCollectionGraph } from './graph-view.js';
import { createInclusion, listInclusionCandidates, removeInclusion, updateInclusion, type InclusionFailure } from './inclusions.js';
import {
  bodyMessage,
  collectionNotFound,
  edgeConflict,
  idParamsSchema,
  inclusionCycle,
  inclusionExists,
  inclusionNeedsLabel,
  inclusionNotFound,
  inclusionParamsSchema,
  inclusionSelf,
  invalidBody,
  memberParamsSchema,
  nodeNotFound,
  type SessionLookup,
} from '../http.js';

type CardStat = { count: number; types: string[] };

const appearanceSelection = {
  edgeDash: collections.edgeDash,
  edgeWidth: collections.edgeWidth,
  edgeColor: collections.edgeColor,
  edgeArrow: collections.edgeArrow,
};

function appearanceFromRow(row: {
  edgeDash: string;
  edgeWidth: string;
  edgeColor: string;
  edgeArrow: string;
}): EdgeAppearance {
  return edgeAppearanceSchema.parse({
    dash: row.edgeDash,
    width: row.edgeWidth,
    color: row.edgeColor,
    arrow: row.edgeArrow,
  });
}

async function readAppearance(db: Database, userId: string, id: string): Promise<EdgeAppearance | null> {
  const rows = await db
    .select(appearanceSelection)
    .from(collections)
    .where(and(eq(collections.id, id), eq(collections.userId, userId), isNull(collections.deletedAt)))
    .limit(1);
  const row = rows[0];
  return row ? appearanceFromRow(row) : null;
}

class PlacementNotMember extends Error {}

function sendInclusionFailure(reply: FastifyReply, failure: InclusionFailure) {
  if (failure === 'missing') return reply.code(404).send(collectionNotFound);
  if (failure === 'self') return reply.code(400).send(inclusionSelf);
  if (failure === 'cycle') return reply.code(400).send(inclusionCycle);
  if (failure === 'exists') return reply.code(409).send(inclusionExists);
  if (failure === 'needs-label') return reply.code(400).send(inclusionNeedsLabel);
  if (failure === 'conflict') return reply.code(409).send(edgeConflict);
  return reply.code(404).send(inclusionNotFound);
}

/** 图片点的宽度只写入 120 到 480 */
function clampImageWidth(width: number): number {
  if (width < 120) return 120;
  if (width > 480) return 480;
  return width;
}

/** 图上的徽标数据：每个 owner 的活跃卡片数和出现过的卡片类型 */
async function cardStats(db: Database, userId: string, ownerKind: 'node' | 'edge' | 'collection_edge', ownerIds: string[]) {
  const stats = new Map<string, CardStat>();
  if (ownerIds.length === 0) return stats;
  const rows = await db
    .select({
      id: cards.ownerId,
      value: count(),
      types: sql<string[]>`array_agg(distinct ${cards.cardType})`,
    })
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        eq(cards.ownerKind, ownerKind),
        inArray(cards.ownerId, ownerIds),
        isNull(cards.deletedAt),
      ),
    )
    .groupBy(cards.ownerId);
  for (const row of rows) stats.set(row.id, { count: row.value, types: row.types });
  return stats;
}

/** 合集目录的徽标数据：每个合集的成员点数 */
async function memberCounts(db: Database, userId: string) {
  const rows = await db
    .select({ id: memberships.collectionId, value: count() })
    .from(memberships)
    .innerJoin(collections, eq(collections.id, memberships.collectionId))
    .where(and(eq(collections.userId, userId), isNull(collections.deletedAt)))
    .groupBy(memberships.collectionId);
  return new Map(rows.map((row) => [row.id, row.value]));
}

export function registerCollectionRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.post('/api/collections', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const parsed = createCollectionBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody(bodyMessage(parsed.error)));

    const inserted = await db
      .insert(collections)
      .values({ userId: user.id, title: parsed.data.title })
      .returning({ id: collections.id, title: collections.title });
    return reply.code(201).send(inserted[0]);
  });

  app.get('/api/collections', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const rows = await db
      .select({ id: collections.id, title: collections.title })
      .from(collections)
      .where(and(eq(collections.userId, user.id), isNull(collections.deletedAt)))
      .orderBy(asc(collections.createdAt), asc(collections.id));
    const counts = await memberCounts(db, user.id);
    return reply.code(200).send({
      collections: rows.map((row) => ({ ...row, nodeCount: counts.get(row.id) ?? 0 })),
    });
  });

  app.patch('/api/collections/:id', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const parsed = updateCollectionBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody(bodyMessage(parsed.error)));

    const updated = await db
      .update(collections)
      .set({ title: parsed.data.title, updatedAt: new Date() })
      .where(
        and(eq(collections.id, params.data.id), eq(collections.userId, user.id), isNull(collections.deletedAt)),
      )
      .returning({ id: collections.id, title: collections.title });
    const row = updated[0];
    if (!row) return reply.code(404).send(collectionNotFound);
    return reply.code(200).send(row);
  });

  app.delete('/api/collections/:id', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const removed = await removeCollection(db, user.id, params.data.id);
    if (!removed) return reply.code(404).send(collectionNotFound);
    return reply.code(204).send();
  });

  app.get('/api/library', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const fromCollection = alias(collections, 'library_from_collection');
    const toCollection = alias(collections, 'library_to_collection');
    const collectionRows = await db
      .select({ id: collections.id, title: collections.title })
      .from(collections)
      .where(and(eq(collections.userId, user.id), isNull(collections.deletedAt)))
      .orderBy(asc(collections.createdAt), asc(collections.id));
    const edgeRows = await db
      .select({
        id: collectionEdges.id,
        fromId: collectionEdges.fromId,
        toId: collectionEdges.toId,
        label: collectionEdges.label,
      })
      .from(collectionEdges)
      .innerJoin(fromCollection, eq(fromCollection.id, collectionEdges.fromId))
      .innerJoin(toCollection, eq(toCollection.id, collectionEdges.toId))
      .where(
        and(
          eq(collectionEdges.userId, user.id),
          isNull(collectionEdges.deletedAt),
          isNull(fromCollection.deletedAt),
          isNull(toCollection.deletedAt),
          eq(fromCollection.userId, user.id),
          eq(toCollection.userId, user.id),
        ),
      )
      .orderBy(asc(collectionEdges.createdAt), asc(collectionEdges.id));
    const counts = await memberCounts(db, user.id);
    const edgeStats = await cardStats(db, user.id, 'collection_edge', edgeRows.map((row) => row.id));
    return reply.code(200).send({
      collections: collectionRows.map((row) => ({ ...row, nodeCount: counts.get(row.id) ?? 0 })),
      edges: edgeRows.map((row) => ({ ...row, cardCount: edgeStats.get(row.id)?.count ?? 0 })),
    });
  });

  app.get('/api/collections/:id/graph', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const collection = await activeCollection(db, user.id, params.data.id);
    if (!collection) return reply.code(404).send(collectionNotFound);
    const appearance = await readAppearance(db, user.id, collection.id);
    if (!appearance) return reply.code(404).send(collectionNotFound);
    const body = await assembleCollectionGraph(db, user.id, collection.id, appearance);
    return reply.code(200).send(body);
  });

  app.get('/api/collections/:id/inclusion-candidates', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const body = await listInclusionCandidates(db, user.id, params.data.id);
    if (!body) return reply.code(404).send(collectionNotFound);
    return reply.code(200).send(body);
  });

  app.post('/api/collections/:id/inclusions', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const parsed = createInclusionBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody(bodyMessage(parsed.error)));
    const outcome = await createInclusion(db, user.id, params.data.id, parsed.data);
    if (outcome !== 'ok') return sendInclusionFailure(reply, outcome);
    return reply.code(201).send({ childId: parsed.data.childId });
  });

  app.patch('/api/collections/:id/inclusions/:childId', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;
    const params = inclusionParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const parsed = updateInclusionBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody(bodyMessage(parsed.error)));
    if (parsed.data.x === undefined && parsed.data.y === undefined && parsed.data.collapsed === undefined) {
      return reply.code(400).send(invalidBody());
    }
    const outcome = await updateInclusion(db, user.id, params.data.id, params.data.childId, parsed.data);
    if (outcome !== 'ok') return sendInclusionFailure(reply, outcome);
    return reply.code(204).send();
  });

  app.delete('/api/collections/:id/inclusions/:childId', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;
    const params = inclusionParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const outcome = await removeInclusion(db, user.id, params.data.id, params.data.childId);
    if (outcome !== 'ok') return sendInclusionFailure(reply, outcome);
    return reply.code(204).send();
  });

  app.patch('/api/collections/:id/appearance', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const parsed = edgeAppearanceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody());

    const updated = await db
      .update(collections)
      .set({
        edgeDash: parsed.data.dash,
        edgeWidth: parsed.data.width,
        edgeColor: parsed.data.color,
        edgeArrow: parsed.data.arrow,
        updatedAt: new Date(),
      })
      .where(and(eq(collections.id, params.data.id), eq(collections.userId, user.id), isNull(collections.deletedAt)))
      .returning(appearanceSelection);
    const row = updated[0];
    if (!row) return reply.code(404).send(collectionNotFound);
    return reply.code(200).send(appearanceFromRow(row));
  });

  app.patch('/api/collections/:id/placements', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const parsed = placementsBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody(bodyMessage(parsed.error)));

    let outcome: 'ok' | 'missing' | 'invalid';
    try {
      outcome = await db.transaction(async (tx) => {
        const collection = await activeCollection(tx, user.id, params.data.id);
        if (!collection) return 'missing';
        const items = parsed.data.placements;
        if (items.length === 0) return 'ok';

        const ids = [...new Set(items.map((item) => item.nodeId))];
        const rows = await tx
          .select({ id: nodes.id, kind: nodes.kind })
          .from(memberships)
          .innerJoin(nodes, eq(nodes.id, memberships.nodeId))
          .where(
            and(
              eq(memberships.collectionId, collection.id),
              eq(nodes.userId, user.id),
              isNull(nodes.deletedAt),
              inArray(nodes.id, ids),
            ),
          );
        const kinds = new Map(rows.map((row) => [row.id, row.kind]));
        if (kinds.size !== ids.length) return 'invalid';

        for (const item of items) {
          const kind = kinds.get(item.nodeId);
          if (kind === undefined) throw new PlacementNotMember();
          const values: { x: number; y: number; z: number; imageWidth?: number } = {
            x: item.x,
            y: item.y,
            z: item.z,
          };
          if (kind === 'image' && item.imageWidth !== undefined) {
            values.imageWidth = clampImageWidth(item.imageWidth);
          }
          const updated = await tx
            .update(memberships)
            .set(values)
            .where(and(eq(memberships.collectionId, collection.id), eq(memberships.nodeId, item.nodeId)))
            .returning({ nodeId: memberships.nodeId });
          if (updated.length !== 1) throw new PlacementNotMember();
        }
        return 'ok';
      });
    } catch (error) {
      if (error instanceof PlacementNotMember) return reply.code(400).send(invalidBody());
      throw error;
    }
    if (outcome === 'missing') return reply.code(404).send(collectionNotFound);
    if (outcome === 'invalid') return reply.code(400).send(invalidBody());
    return reply.code(204).send();
  });

  app.post('/api/collections/:id/nodes', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const parsed = createNodeBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody(bodyMessage(parsed.error)));

    const created = await db.transaction(async (tx) => {
      const collection = await activeCollection(tx, user.id, params.data.id);
      if (!collection) return null;
      const inserted = await tx
        .insert(nodes)
        .values({ userId: user.id, name: parsed.data.name })
        .returning({ id: nodes.id, name: nodes.name });
      const node = inserted[0];
      if (!node) return null;
      await tx.insert(memberships).values({ collectionId: collection.id, nodeId: node.id });
      return node;
    });
    if (!created) return reply.code(404).send(collectionNotFound);
    return reply.code(201).send(created);
  });

  app.post('/api/collections/:id/members', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const parsed = addMemberBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody());

    const collection = await activeCollection(db, user.id, params.data.id);
    if (!collection) return reply.code(404).send(collectionNotFound);
    const node = await activeNode(db, user.id, parsed.data.nodeId);
    if (!node) return reply.code(404).send(nodeNotFound);

    await db
      .insert(memberships)
      .values({ collectionId: collection.id, nodeId: node.id })
      .onConflictDoNothing();
    return reply.code(204).send();
  });

  app.delete('/api/collections/:id/members/:nodeId', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = memberParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const collection = await activeCollection(db, user.id, params.data.id);
    if (!collection) return reply.code(404).send(collectionNotFound);

    await db
      .delete(memberships)
      .where(and(eq(memberships.collectionId, collection.id), eq(memberships.nodeId, params.data.nodeId)));
    return reply.code(204).send();
  });
}
