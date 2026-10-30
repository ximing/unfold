import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { activeCollection, type Database } from '../graph/db.js';
import { collectionNotFound, invalidBody, type SessionLookup } from '../http.js';
import { decodeSearchCursor, decodeUnassignedCursor, queryEdgeLabels, querySearch, queryUnassigned } from './query.js';

const searchQuerySchema = z.object({
  q: z.string().optional(),
  scope: z.enum(['account', 'collection']).optional(),
  collectionId: z.uuid().optional(),
  preferCollectionId: z.uuid().optional(),
  cursor: z.string().optional(),
});

const cursorQuerySchema = z.object({
  cursor: z.string().optional(),
});

const labelQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
});

export function registerSearchRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.get('/api/search', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(invalidBody());
    const query = (parsed.data.q ?? '').trim();
    if (!query) return reply.code(200).send({ hits: [], nextCursor: null });

    const scope = parsed.data.scope ?? 'account';
    if (scope === 'collection' && !parsed.data.collectionId) return reply.code(400).send(invalidBody());
    const cursor = parsed.data.cursor === undefined ? null : decodeSearchCursor(parsed.data.cursor);
    if (parsed.data.cursor !== undefined && !cursor) return reply.code(400).send(invalidBody());
    if (scope === 'collection' && parsed.data.collectionId) {
      const collection = await activeCollection(db, user.id, parsed.data.collectionId);
      if (!collection) return reply.code(404).send(collectionNotFound);
    }

    const body = await querySearch(db, user.id, {
      query,
      scope,
      collectionId: parsed.data.collectionId ?? null,
      preferCollectionId: parsed.data.preferCollectionId ?? null,
      cursor,
    });
    return reply.code(200).send(body);
  });

  app.get('/api/unassigned-nodes', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;
    const parsed = cursorQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(invalidBody());
    const cursor = parsed.data.cursor === undefined ? null : decodeUnassignedCursor(parsed.data.cursor);
    if (parsed.data.cursor !== undefined && !cursor) return reply.code(400).send(invalidBody());
    return reply.code(200).send(await queryUnassigned(db, user.id, cursor));
  });

  app.get('/api/edge-labels', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;
    const parsed = labelQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(invalidBody());
    const limit = parsed.data.limit === undefined ? 8 : Number(parsed.data.limit);
    if (limit < 1 || limit > 20) return reply.code(400).send(invalidBody());
    return reply.code(200).send(await queryEdgeLabels(db, user.id, limit));
  });
}
