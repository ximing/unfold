import { searchResponseSchema } from '@unfold/dto';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from './graph-db.js';
import { invalidBody, type SessionLookup } from './http.js';
import { likePattern, snippetOf } from './search-text.js';

const searchQuerySchema = z.object({
  q: z.string().optional(),
});

export function registerSearchRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.get('/api/search', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(invalidBody());
    const query = (parsed.data.q ?? '').trim();
    if (!query) return reply.code(200).send({ hits: [] });

    const pattern = likePattern(query);
    const result = await db.execute<{
      node_id: string;
      name: string;
      card_text: string | null;
      collection_id: string | null;
      collection_title: string | null;
    }>(sql`
      select
        n.id as node_id,
        n.name as name,
        card.card_text as card_text,
        col.id as collection_id,
        col.title as collection_title
      from nodes n
      left join lateral (
        select c.content::text as card_text
        from cards c
        where c.user_id = n.user_id
          and c.owner_kind = 'node'
          and c.owner_id = n.id
          and c.deleted_at is null
          and c.content::text ilike ${pattern} escape '\\'
        order by c.position asc, c.created_at asc, c.id asc
        limit 1
      ) card on true
      left join lateral (
        select collection.id, collection.title
        from memberships m
        join collections collection on collection.id = m.collection_id
        where m.node_id = n.id
          and collection.user_id = n.user_id
          and collection.deleted_at is null
        order by collection.created_at asc, collection.id asc
        limit 1
      ) col on true
      where n.user_id = ${user.id}
        and n.deleted_at is null
        and (
          n.name ilike ${pattern} escape '\\'
          or card.card_text is not null
        )
      order by n.created_at asc, n.id asc
      limit 30
    `);

    const hits = result.rows.map((row) => ({
      nodeId: row.node_id,
      name: row.name,
      collectionId: row.collection_id ?? '',
      collectionTitle: row.collection_title ?? '',
      snippet: snippetOf(row.name, row.card_text, query),
    }));
    return reply.code(200).send(searchResponseSchema.parse({ hits }));
  });
}
