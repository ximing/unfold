import { searchHitSchema, searchResponseSchema, unassignedNodesSchema, edgeLabelsSchema } from '@unfold/dto';
import type { EdgeLabels, SearchResponse, UnassignedNodes } from '@unfold/dto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../graph/db.js';
import { clip, likePattern } from './text.js';

const nilId = '00000000-0000-0000-0000-000000000000';

export type SearchCursor = { tier: number; ms: string; id: string };
export type UnassignedCursor = { ms: string; id: string };

type SearchArgs = {
  query: string;
  scope: 'account' | 'collection';
  collectionId: string | null;
  preferCollectionId: string | null;
  cursor: SearchCursor | null;
};

type HitRow = {
  kind: string;
  id: string;
  title: string;
  field: string;
  snippet_source: string;
  collection_id: string | null;
  collection_title: string | null;
  node_id: string | null;
  edge_id: string | null;
  card_id: string | null;
  owner_kind: string | null;
  tier: number | string;
  updated_ms: string | number;
};

function encodeCursor(prefix: string, parts: string[]): string {
  return Buffer.from(`${prefix}:${parts.join(':')}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string, prefix: string): string[] | null {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  const parts = text.split(':');
  if (parts[0] !== prefix) return null;
  return parts.slice(1);
}

export function decodeSearchCursor(cursor: string): SearchCursor | null {
  const parts = decodeCursor(cursor, 's1');
  if (!parts || parts.length !== 3) return null;
  const [tierText, ms, id] = parts;
  if (!tierText || !ms || !id) return null;
  if (!['1', '2', '3'].includes(tierText) || !/^\d+$/.test(ms)) return null;
  if (!z.uuid().safeParse(id).success) return null;
  return { tier: Number(tierText), ms, id };
}

export function decodeUnassignedCursor(cursor: string): UnassignedCursor | null {
  const parts = decodeCursor(cursor, 'u1');
  if (!parts || parts.length !== 2) return null;
  const [ms, id] = parts;
  if (!ms || !id || !/^\d+$/.test(ms)) return null;
  if (!z.uuid().safeParse(id).success) return null;
  return { ms, id };
}

function page<T>(rows: T[], cursorOf: (row: T) => string): { page: T[]; nextCursor: string | null } {
  if (rows.length <= 30) return { page: rows, nextCursor: null };
  const kept = rows.slice(0, 30);
  const last = kept[29];
  if (!last) return { page: kept, nextCursor: null };
  return { page: kept, nextCursor: cursorOf(last) };
}

/** 合集标题、点名、描述、边标签，以及卡片可读文本。不扫描 content::text。 */
export async function querySearch(db: Database, userId: string, args: SearchArgs): Promise<SearchResponse> {
  const cursor = args.cursor;
  const result = await db.execute<HitRow>(sql`
    with params as (
      select
        cast(${userId} as uuid) as user_id,
        ${args.query}::text as query,
        ${likePattern(args.query)}::text as pattern,
        cast(${args.preferCollectionId} as uuid) as prefer,
        cast(${args.collectionId} as uuid) as collection_id,
        ${args.scope}::text as scope
    ),
    scope_collections as (
      select c.id
      from collections c
      cross join params p
      where p.scope = 'collection'
        and c.user_id = p.user_id
        and c.deleted_at is null
        and (
          c.id = p.collection_id
          or exists (
            select 1
            from collection_inclusions ci
            join collections child on child.id = ci.child_id
            where ci.parent_id = p.collection_id
              and ci.child_id = c.id
              and child.user_id = p.user_id
              and child.deleted_at is null
          )
        )
    ),
    scope_nodes as (
      select n.id
      from nodes n
      cross join params p
      where n.user_id = p.user_id
        and n.deleted_at is null
        and (
          p.scope = 'account'
          or exists (
            select 1
            from memberships m
            where m.node_id = n.id
              and m.collection_id in (select id from scope_collections)
          )
        )
    ),
    scope_edges as (
      select e.id
      from edges e
      where e.user_id = (select user_id from params)
        and e.deleted_at is null
        and e.from_id in (select id from scope_nodes)
        and e.to_id in (select id from scope_nodes)
    ),
    scope_collection_edges as (
      select ce.id
      from collection_edges ce
      join collections a on a.id = ce.from_id
      join collections b on b.id = ce.to_id
      cross join params p
      where ce.user_id = p.user_id
        and ce.deleted_at is null
        and a.deleted_at is null
        and b.deleted_at is null
        and a.user_id = p.user_id
        and b.user_id = p.user_id
        and (
          p.scope = 'account'
          or ce.from_id = p.collection_id
          or ce.to_id = p.collection_id
        )
    ),
    hits as (
      select
        'collection'::text as kind,
        c.id,
        c.title,
        'title'::text as field,
        c.title as snippet_source,
        c.id as collection_id,
        c.title as collection_title,
        null::uuid as node_id,
        null::uuid as edge_id,
        null::uuid as card_id,
        null::text as owner_kind,
        case when lower(c.title) = lower(p.query) then 1 else 2 end as tier,
        (extract(epoch from c.updated_at) * 1000)::bigint as updated_ms
      from collections c
      cross join params p
      where c.user_id = p.user_id
        and c.deleted_at is null
        and c.title ilike p.pattern escape '\\'
        and (
          p.scope = 'account'
          or c.id in (select id from scope_collections)
        )

      union all

      select
        'node'::text,
        n.id,
        n.name,
        'name'::text,
        n.name,
        place.id,
        place.title,
        n.id,
        null::uuid,
        null::uuid,
        null::text,
        case when lower(n.name) = lower(p.query) then 1 else 2 end,
        (extract(epoch from n.updated_at) * 1000)::bigint
      from nodes n
      cross join params p
      left join lateral (
        select col.id, col.title
        from memberships m
        join collections col on col.id = m.collection_id
        where m.node_id = n.id
          and col.user_id = p.user_id
          and col.deleted_at is null
        order by case when m.collection_id = p.prefer then 0 else 1 end, m.created_at asc, col.id asc
        limit 1
      ) place on true
      where n.id in (select id from scope_nodes)
        and n.name ilike p.pattern escape '\\'

      union all

      select
        'node'::text,
        n.id,
        n.name,
        'description'::text,
        n.description,
        place.id,
        place.title,
        n.id,
        null::uuid,
        null::uuid,
        null::text,
        2,
        (extract(epoch from n.updated_at) * 1000)::bigint
      from nodes n
      cross join params p
      left join lateral (
        select col.id, col.title
        from memberships m
        join collections col on col.id = m.collection_id
        where m.node_id = n.id
          and col.user_id = p.user_id
          and col.deleted_at is null
        order by case when m.collection_id = p.prefer then 0 else 1 end, m.created_at asc, col.id asc
        limit 1
      ) place on true
      where n.id in (select id from scope_nodes)
        and n.description ilike p.pattern escape '\\'
        and n.name not ilike p.pattern escape '\\'

      union all

      select
        'edge'::text,
        e.id,
        e.label,
        'label'::text,
        e.label,
        place.id,
        place.title,
        null::uuid,
        e.id,
        null::uuid,
        null::text,
        case when lower(e.label) = lower(p.query) then 1 else 2 end,
        (extract(epoch from e.updated_at) * 1000)::bigint
      from edges e
      cross join params p
      left join lateral (
        select col.id, col.title
        from memberships m
        join collections col on col.id = m.collection_id
        where m.node_id in (e.from_id, e.to_id)
          and col.user_id = p.user_id
          and col.deleted_at is null
        order by case when m.collection_id = p.prefer then 0 else 1 end, m.created_at asc, col.id asc
        limit 1
      ) place on true
      where e.id in (select id from scope_edges)
        and e.label ilike p.pattern escape '\\'

      union all

      select
        'collection_edge'::text,
        ce.id,
        ce.label,
        'label'::text,
        ce.label,
        place.id,
        place.title,
        null::uuid,
        ce.id,
        null::uuid,
        null::text,
        case when lower(ce.label) = lower(p.query) then 1 else 2 end,
        (extract(epoch from ce.updated_at) * 1000)::bigint
      from collection_edges ce
      cross join params p
      left join lateral (
        select c.id, c.title
        from collections c
        where c.id in (ce.from_id, ce.to_id)
          and c.user_id = p.user_id
          and c.deleted_at is null
        order by case when c.id = p.prefer then 0 else 1 end, c.created_at asc, c.id asc
        limit 1
      ) place on true
      where ce.id in (select id from scope_collection_edges)
        and ce.label ilike p.pattern escape '\\'

      union all

      select
        'card'::text,
        c.id,
        case
          when c.owner_kind = 'node' then coalesce(owner_node.name, '')
          when c.owner_kind = 'edge' then coalesce(owner_edge.label, '')
          else coalesce(owner_collection_edge.label, '')
        end,
        'content'::text,
        readable.text,
        case
          when c.owner_kind = 'node' then node_place.id
          when c.owner_kind = 'edge' then edge_place.id
          else collection_edge_place.id
        end,
        case
          when c.owner_kind = 'node' then node_place.title
          when c.owner_kind = 'edge' then edge_place.title
          else collection_edge_place.title
        end,
        case when c.owner_kind = 'node' then c.owner_id else null::uuid end,
        case when c.owner_kind in ('edge', 'collection_edge') then c.owner_id else null::uuid end,
        c.id,
        c.owner_kind,
        3,
        (extract(epoch from c.updated_at) * 1000)::bigint
      from cards c
      cross join params p
      cross join lateral (
        select case
          when c.card_type = 'rich' then coalesce(c.content->>'plain', '')
          when c.card_type = 'note' then trim(both from regexp_replace(
            regexp_replace(
              regexp_replace(coalesce(c.content->>'body', ''), '<[^>]+>', ' ', 'g'),
              '&[a-zA-Z]+;', ' ', 'g'
            ),
            '\\s+', ' ', 'g'
          ))
          else coalesce((
            select string_agg(entry.value, ' ')
            from jsonb_each_text(c.content) as entry
            where jsonb_typeof(c.content -> entry.key) = 'string'
          ), '')
        end as text
      ) readable
      left join nodes owner_node
        on c.owner_kind = 'node' and owner_node.id = c.owner_id and owner_node.deleted_at is null
      left join edges owner_edge
        on c.owner_kind = 'edge' and owner_edge.id = c.owner_id and owner_edge.deleted_at is null
      left join collection_edges owner_collection_edge
        on c.owner_kind = 'collection_edge'
        and owner_collection_edge.id = c.owner_id
        and owner_collection_edge.deleted_at is null
      left join lateral (
        select col.id, col.title
        from memberships m
        join collections col on col.id = m.collection_id
        where c.owner_kind = 'node'
          and m.node_id = c.owner_id
          and col.user_id = p.user_id
          and col.deleted_at is null
        order by case when m.collection_id = p.prefer then 0 else 1 end, m.created_at asc, col.id asc
        limit 1
      ) node_place on true
      left join lateral (
        select col.id, col.title
        from memberships m
        join collections col on col.id = m.collection_id
        where c.owner_kind = 'edge'
          and owner_edge.id is not null
          and m.node_id in (owner_edge.from_id, owner_edge.to_id)
          and col.user_id = p.user_id
          and col.deleted_at is null
        order by case when m.collection_id = p.prefer then 0 else 1 end, m.created_at asc, col.id asc
        limit 1
      ) edge_place on true
      left join lateral (
        select col.id, col.title
        from collections col
        where c.owner_kind = 'collection_edge'
          and owner_collection_edge.id is not null
          and col.id in (owner_collection_edge.from_id, owner_collection_edge.to_id)
          and col.user_id = p.user_id
          and col.deleted_at is null
        order by case when col.id = p.prefer then 0 else 1 end, col.created_at asc, col.id asc
        limit 1
      ) collection_edge_place on true
      where c.user_id = p.user_id
        and c.deleted_at is null
        and readable.text ilike p.pattern escape '\\'
        and (
          (c.owner_kind = 'node' and c.owner_id in (select id from scope_nodes))
          or (c.owner_kind = 'edge' and c.owner_id in (select id from scope_edges))
          or (c.owner_kind = 'collection_edge' and c.owner_id in (select id from scope_collection_edges))
        )
    )
    select *
    from hits
    where (
      ${cursor === null}::boolean
      or tier > ${cursor?.tier ?? 0}::int
      or (tier = ${cursor?.tier ?? 0}::int and updated_ms < cast(${cursor?.ms ?? '0'} as bigint))
      or (
        tier = ${cursor?.tier ?? 0}::int
        and updated_ms = cast(${cursor?.ms ?? '0'} as bigint)
        and id > cast(${cursor?.id ?? nilId} as uuid)
      )
    )
    order by tier asc, updated_ms desc, id asc
    limit 31
  `);

  const mapped = result.rows.map((row) => {
    const tier = Number(row.tier);
    const updatedMs = String(row.updated_ms);
    return {
      hit: searchHitSchema.parse({
        kind: row.kind,
        id: row.id,
        title: row.title,
        field: row.field,
        snippet: clip(row.snippet_source ?? ''),
        collectionId: row.collection_id,
        collectionTitle: row.collection_title,
        nodeId: row.node_id,
        edgeId: row.edge_id,
        cardId: row.card_id,
        ownerKind: row.owner_kind,
      }),
      tier,
      updatedMs,
    };
  });
  const paged = page(mapped, (row) => encodeCursor('s1', [String(row.tier), row.updatedMs, row.hit.id]));
  return searchResponseSchema.parse({
    hits: paged.page.map((row) => row.hit),
    nextCursor: paged.nextCursor,
  });
}

export async function queryUnassigned(
  db: Database,
  userId: string,
  cursor: UnassignedCursor | null,
): Promise<UnassignedNodes> {
  const result = await db.execute<{
    id: string;
    name: string;
    description: string;
    kind: string;
    card_count: string | number;
    updated_ms: string | number;
  }>(sql`
    select
      n.id,
      n.name,
      n.description,
      n.kind,
      (
        select count(*)::int
        from cards k
        where k.user_id = n.user_id
          and k.owner_kind = 'node'
          and k.owner_id = n.id
          and k.deleted_at is null
      ) as card_count,
      (extract(epoch from n.updated_at) * 1000)::bigint as updated_ms
    from nodes n
    where n.user_id = cast(${userId} as uuid)
      and n.deleted_at is null
      and not exists (
        select 1
        from memberships m
        join collections c on c.id = m.collection_id
        where m.node_id = n.id
          and c.user_id = n.user_id
          and c.deleted_at is null
      )
      and (
        ${cursor === null}::boolean
        or (extract(epoch from n.updated_at) * 1000)::bigint < cast(${cursor?.ms ?? '0'} as bigint)
        or (
          (extract(epoch from n.updated_at) * 1000)::bigint = cast(${cursor?.ms ?? '0'} as bigint)
          and n.id > cast(${cursor?.id ?? nilId} as uuid)
        )
      )
    order by updated_ms desc, n.id asc
    limit 31
  `);
  const rows = result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    kind: row.kind,
    cardCount: Number(row.card_count),
    updatedMs: String(row.updated_ms),
  }));
  const paged = page(rows, (row) => encodeCursor('u1', [row.updatedMs, row.id]));
  return unassignedNodesSchema.parse({
    nodes: paged.page.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      kind: row.kind,
      cardCount: row.cardCount,
    })),
    nextCursor: paged.nextCursor,
  });
}

export async function queryEdgeLabels(db: Database, userId: string, limit: number): Promise<EdgeLabels> {
  const result = await db.execute<{ label: string }>(sql`
    select e.label
    from edges e
    where e.user_id = cast(${userId} as uuid)
      and e.deleted_at is null
    group by e.label
    order by max(e.updated_at) desc, e.label asc
    limit ${limit}
  `);
  return edgeLabelsSchema.parse({ labels: result.rows.map((row) => row.label) });
}
