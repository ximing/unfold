import { searchResponseSchema } from '@unfold/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createDb } from './db/client.js';
import type { SessionLookup } from './objects.js';
import { searchLibrary } from './services/search-query.js';

type Database = ReturnType<typeof createDb>;

const invalidBody = { error: { code: 'invalid_body', message: '请求格式不正确' } };

export function registerSearchRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.get('/api/search', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const parsed = z.object({ q: z.string().min(1).max(200) }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(invalidBody);

    const result = await searchLibrary(db, user.id, parsed.data.q);
    return reply.code(200).send(searchResponseSchema.parse(result));
  });
}
