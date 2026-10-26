import {
  addMemberBodySchema,
  createCollectionBodySchema,
  createNodeBodySchema,
  placementsBodySchema,
  updateCollectionBodySchema,
} from '@unfold/dto';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { assets, cards, collectionEdges, collections, edges, memberships, nodes } from '../db/schema.js';
import {
  activeCollection,
  activeNode,
  type Database,
  removeCollection,
} from '../graph/db.js';
import {
  bodyMessage,
  collectionNotFound,
  idParamsSchema,
  invalidBody,
  memberParamsSchema,
  nodeNotFound,
  type SessionLookup,
} from '../http.js';

type CardStat = { count: number; types: string[] };

class PlacementNotMember extends Error {}

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

    const memberRows = await db
      .select({
        id: nodes.id,
        name: nodes.name,
        description: nodes.description,
        kind: nodes.kind,
        x: memberships.x,
        y: memberships.y,
        z: memberships.z,
        imageWidth: memberships.imageWidth,
      })
      .from(memberships)
      .innerJoin(nodes, eq(nodes.id, memberships.nodeId))
      .where(
        and(
          eq(memberships.collectionId, collection.id),
          eq(nodes.userId, user.id),
          isNull(nodes.deletedAt),
        ),
      )
      .orderBy(asc(nodes.createdAt), asc(nodes.id));

    if (memberRows.length === 0) return reply.code(200).send({ nodes: [], edges: [] });

    const memberIds = memberRows.map((row) => row.id);
    const edgeRows = await db
      .select({ id: edges.id, fromId: edges.fromId, toId: edges.toId, label: edges.label })
      .from(edges)
      .where(
        and(
          eq(edges.userId, user.id),
          isNull(edges.deletedAt),
          inArray(edges.fromId, memberIds),
          inArray(edges.toId, memberIds),
        ),
      )
      .orderBy(asc(edges.createdAt), asc(edges.id));
    const nodeStats = await cardStats(db, user.id, 'node', memberIds);
    const edgeStats = await cardStats(db, user.id, 'edge', edgeRows.map((row) => row.id));
    const assetRows = await db
      .select({ id: assets.id, ownerId: assets.ownerId })
      .from(assets)
      .where(
        and(eq(assets.userId, user.id), eq(assets.ownerKind, 'node'), inArray(assets.ownerId, memberIds)),
      );
    const assetByNode = new Map(assetRows.map((row) => [row.ownerId, row.id]));
    return reply.code(200).send({
      nodes: memberRows.map((row) => {
        const stat = nodeStats.get(row.id);
        return {
          id: row.id,
          name: row.name,
          description: row.description,
          kind: row.kind,
          x: row.x,
          y: row.y,
          z: row.z,
          imageWidth: row.imageWidth,
          assetId: assetByNode.get(row.id) ?? null,
          cardCount: stat?.count ?? 0,
          cardTypes: stat?.types ?? [],
        };
      }),
      edges: edgeRows.map((row) => ({ ...row, cardCount: edgeStats.get(row.id)?.count ?? 0 })),
    });
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
