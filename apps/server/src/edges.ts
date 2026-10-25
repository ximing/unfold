import { createEdgeBodySchema, updateEdgeBodySchema } from '@unfold/dto';
import { and, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { collectionEdges, collections, edges, nodes } from './db/schema.js';
import {
  activeCollectionIdSet,
  activeNodeIdSet,
  type Database,
  listCards,
  removeCollectionEdge,
  removeEdge,
} from './graph-db.js';
import {
  bodyMessage,
  collectionNotFound,
  edgeConflict,
  edgeNotFound,
  idParamsSchema,
  invalidBody,
  isUniqueViolation,
  nodeNotFound,
  type SessionLookup,
  type SessionUser,
} from './http.js';

const selfLoop = invalidBody('不能连到自己');

async function guardEnds(
  reply: FastifyReply,
  fromId: string,
  toId: string,
  found: Set<string>,
  missing: typeof nodeNotFound,
) {
  if (fromId === toId) {
    if (!found.has(fromId)) {
      await reply.code(404).send(missing);
      return false;
    }
    await reply.code(400).send(selfLoop);
    return false;
  }
  if (found.size < 2) {
    await reply.code(404).send(missing);
    return false;
  }
  return true;
}

export function registerEdgeRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.post('/api/edges', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const parsed = createEdgeBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody(bodyMessage(parsed.error)));
    const { fromId, toId, label } = parsed.data;
    const found = await activeNodeIdSet(db, user.id, [fromId, toId]);
    if (!(await guardEnds(reply, fromId, toId, found, nodeNotFound))) return;

    try {
      const inserted = await db
        .insert(edges)
        .values({ userId: user.id, fromId, toId, label })
        .returning({ id: edges.id, fromId: edges.fromId, toId: edges.toId, label: edges.label });
      return reply.code(201).send(inserted[0]);
    } catch (error) {
      if (isUniqueViolation(error)) return reply.code(409).send(edgeConflict);
      throw error;
    }
  });

  app.get('/api/edges/:id', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const fromNode = alias(nodes, 'edge_from_node');
    const toNode = alias(nodes, 'edge_to_node');
    const rows = await db
      .select({
        id: edges.id,
        fromId: edges.fromId,
        toId: edges.toId,
        label: edges.label,
        fromName: fromNode.name,
        toName: toNode.name,
      })
      .from(edges)
      .innerJoin(fromNode, eq(fromNode.id, edges.fromId))
      .innerJoin(toNode, eq(toNode.id, edges.toId))
      .where(
        and(
          eq(edges.id, params.data.id),
          eq(edges.userId, user.id),
          isNull(edges.deletedAt),
          isNull(fromNode.deletedAt),
          isNull(toNode.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return reply.code(404).send(edgeNotFound);
    const cardRows = await listCards(db, user.id, 'edge', row.id);
    return reply.code(200).send({ ...row, cards: cardRows });
  });

  app.patch('/api/edges/:id', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;
    return patchEdgeLabel(db, user, request.params, request.body, reply, 'edge');
  });

  app.delete('/api/edges/:id', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const removed = await removeEdge(db, user.id, params.data.id);
    if (!removed) return reply.code(404).send(edgeNotFound);
    return reply.code(204).send();
  });

  app.post('/api/collection-edges', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const parsed = createEdgeBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody(bodyMessage(parsed.error)));
    const { fromId, toId, label } = parsed.data;
    const found = await activeCollectionIdSet(db, user.id, [fromId, toId]);
    if (!(await guardEnds(reply, fromId, toId, found, collectionNotFound))) return;

    try {
      const inserted = await db
        .insert(collectionEdges)
        .values({ userId: user.id, fromId, toId, label })
        .returning({
          id: collectionEdges.id,
          fromId: collectionEdges.fromId,
          toId: collectionEdges.toId,
          label: collectionEdges.label,
        });
      return reply.code(201).send(inserted[0]);
    } catch (error) {
      if (isUniqueViolation(error)) return reply.code(409).send(edgeConflict);
      throw error;
    }
  });

  app.get('/api/collection-edges/:id', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const fromCollection = alias(collections, 'collection_edge_from');
    const toCollection = alias(collections, 'collection_edge_to');
    const rows = await db
      .select({
        id: collectionEdges.id,
        fromId: collectionEdges.fromId,
        toId: collectionEdges.toId,
        label: collectionEdges.label,
        fromTitle: fromCollection.title,
        toTitle: toCollection.title,
      })
      .from(collectionEdges)
      .innerJoin(fromCollection, eq(fromCollection.id, collectionEdges.fromId))
      .innerJoin(toCollection, eq(toCollection.id, collectionEdges.toId))
      .where(
        and(
          eq(collectionEdges.id, params.data.id),
          eq(collectionEdges.userId, user.id),
          isNull(collectionEdges.deletedAt),
          isNull(fromCollection.deletedAt),
          isNull(toCollection.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return reply.code(404).send(edgeNotFound);
    const cardRows = await listCards(db, user.id, 'collection_edge', row.id);
    return reply.code(200).send({ ...row, cards: cardRows });
  });

  app.patch('/api/collection-edges/:id', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;
    return patchEdgeLabel(db, user, request.params, request.body, reply, 'collection_edge');
  });

  app.delete('/api/collection-edges/:id', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const removed = await removeCollectionEdge(db, user.id, params.data.id);
    if (!removed) return reply.code(404).send(edgeNotFound);
    return reply.code(204).send();
  });
}

async function patchEdgeLabel(
  db: Database,
  user: SessionUser,
  paramsInput: unknown,
  bodyInput: unknown,
  reply: FastifyReply,
  kind: 'edge' | 'collection_edge',
) {
  const params = idParamsSchema.safeParse(paramsInput);
  if (!params.success) return reply.code(400).send(invalidBody());
  const parsed = updateEdgeBodySchema.safeParse(bodyInput);
  if (!parsed.success) return reply.code(400).send(invalidBody(bodyMessage(parsed.error)));

  try {
    if (kind === 'edge') {
      const updated = await db
        .update(edges)
        .set({ label: parsed.data.label, updatedAt: new Date() })
        .where(and(eq(edges.id, params.data.id), eq(edges.userId, user.id), isNull(edges.deletedAt)))
        .returning({ id: edges.id, fromId: edges.fromId, toId: edges.toId, label: edges.label });
      const row = updated[0];
      if (!row) return reply.code(404).send(edgeNotFound);
      return reply.code(200).send(row);
    }

    const updated = await db
      .update(collectionEdges)
      .set({ label: parsed.data.label, updatedAt: new Date() })
      .where(
        and(
          eq(collectionEdges.id, params.data.id),
          eq(collectionEdges.userId, user.id),
          isNull(collectionEdges.deletedAt),
        ),
      )
      .returning({
        id: collectionEdges.id,
        fromId: collectionEdges.fromId,
        toId: collectionEdges.toId,
        label: collectionEdges.label,
      });
    const row = updated[0];
    if (!row) return reply.code(404).send(edgeNotFound);
    return reply.code(200).send(row);
  } catch (error) {
    if (isUniqueViolation(error)) return reply.code(409).send(edgeConflict);
    throw error;
  }
}
