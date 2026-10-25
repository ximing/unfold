import { updateNodeBodySchema } from '@unfold/dto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { collections, memberships, nodes } from '../db/schema.js';
import { activeNode, type Database, listCards, removeNode } from '../graph/db.js';
import { bodyMessage, idParamsSchema, invalidBody, nodeNotFound, type SessionLookup } from '../http.js';

export function registerNodeRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.get('/api/nodes/:id', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const node = await activeNode(db, user.id, params.data.id);
    if (!node) return reply.code(404).send(nodeNotFound);

    const collectionRows = await db
      .select({ id: collections.id, title: collections.title })
      .from(memberships)
      .innerJoin(collections, eq(collections.id, memberships.collectionId))
      .where(
        and(eq(memberships.nodeId, node.id), eq(collections.userId, user.id), isNull(collections.deletedAt)),
      )
      .orderBy(asc(collections.createdAt), asc(collections.id));
    const cardRows = await listCards(db, user.id, 'node', node.id);
    return reply.code(200).send({ ...node, collections: collectionRows, cards: cardRows });
  });

  app.patch('/api/nodes/:id', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const parsed = updateNodeBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody(bodyMessage(parsed.error)));

    const patch: { name?: string; description?: string; updatedAt: Date } = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;

    const updated = await db
      .update(nodes)
      .set(patch)
      .where(and(eq(nodes.id, params.data.id), eq(nodes.userId, user.id), isNull(nodes.deletedAt)))
      .returning({ id: nodes.id, name: nodes.name, description: nodes.description });
    const row = updated[0];
    if (!row) return reply.code(404).send(nodeNotFound);
    return reply.code(200).send(row);
  });

  app.delete('/api/nodes/:id', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());
    const removed = await removeNode(db, user.id, params.data.id);
    if (!removed) return reply.code(404).send(nodeNotFound);
    return reply.code(204).send();
  });
}
