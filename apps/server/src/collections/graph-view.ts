import type { EdgeAppearance } from '@unfold/dto';
import { and, asc, count, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { assets, cards, collectionEdges, collectionInclusions, collections, edges, memberships, nodes } from '../db/schema.js';
import type { Query } from '../graph/db.js';

type CardStat = { count: number; types: string[] };

type MemberRow = {
  collectionId: string;
  id: string;
  name: string;
  description: string;
  kind: string;
  x: number | null;
  y: number | null;
  z: number | null;
  imageWidth: number | null;
};

type EdgeRow = { id: string; fromId: string; toId: string; label: string };

async function cardStats(
  db: Query,
  userId: string,
  ownerKind: 'node' | 'edge',
  ownerIds: string[],
): Promise<Map<string, CardStat>> {
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

function toNode(row: MemberRow, stat: CardStat | undefined, assetId: string | null) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    kind: row.kind,
    x: row.x,
    y: row.y,
    z: row.z,
    imageWidth: row.imageWidth,
    assetId,
    cardCount: stat?.count ?? 0,
    cardTypes: stat?.types ?? [],
  };
}

function toEdge(row: EdgeRow, stat: CardStat | undefined) {
  return { ...row, cardCount: stat?.count ?? 0 };
}

/** 父合集的图，加上一层子集合和跨集合的点边。 */
export async function assembleCollectionGraph(
  db: Query,
  userId: string,
  collectionId: string,
  appearance: EdgeAppearance,
) {
  const placed = await db
    .select({
      childId: collectionInclusions.childId,
      title: collections.title,
      x: collectionInclusions.x,
      y: collectionInclusions.y,
      collapsed: collectionInclusions.collapsed,
    })
    .from(collectionInclusions)
    .innerJoin(collections, eq(collections.id, collectionInclusions.childId))
    .where(
      and(
        eq(collectionInclusions.parentId, collectionId),
        eq(collections.userId, userId),
        isNull(collections.deletedAt),
      ),
    )
    .orderBy(asc(collectionInclusions.createdAt), asc(collectionInclusions.childId));

  const childIds = placed.map((row) => row.childId);
  const scope = [collectionId, ...childIds];
  const memberRows = await db
    .select({
      collectionId: memberships.collectionId,
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
    .where(and(inArray(memberships.collectionId, scope), eq(nodes.userId, userId), isNull(nodes.deletedAt)))
    .orderBy(asc(nodes.createdAt), asc(nodes.id));

  const parentMembers = memberRows.filter((row) => row.collectionId === collectionId);
  const byChild = new Map<string, MemberRow[]>();
  for (const row of memberRows) {
    if (row.collectionId === collectionId) continue;
    const list = byChild.get(row.collectionId) ?? [];
    list.push(row);
    byChild.set(row.collectionId, list);
  }

  const parentIds = new Set(parentMembers.map((row) => row.id));
  const childSets = new Map<string, Set<string>>(childIds.map((id) => [id, new Set(byChild.get(id)?.map((row) => row.id) ?? [])]));
  const nodeIds = [...new Set(memberRows.map((row) => row.id))];

  let edgeRows: EdgeRow[] = [];
  if (nodeIds.length > 0) {
    edgeRows = await db
      .select({ id: edges.id, fromId: edges.fromId, toId: edges.toId, label: edges.label })
      .from(edges)
      .where(
        and(
          eq(edges.userId, userId),
          isNull(edges.deletedAt),
          inArray(edges.fromId, nodeIds),
          inArray(edges.toId, nodeIds),
        ),
      )
      .orderBy(asc(edges.createdAt), asc(edges.id));
  }

  function locate(nodeId: string): string | null {
    if (parentIds.has(nodeId)) return 'parent';
    for (const [childId, ids] of childSets) {
      if (ids.has(nodeId)) return childId;
    }
    return null;
  }

  const parentEdges: EdgeRow[] = [];
  const childEdges = new Map<string, EdgeRow[]>(childIds.map((id) => [id, []]));
  const bridgeRows: EdgeRow[] = [];
  for (const edge of edgeRows) {
    const from = locate(edge.fromId);
    const to = locate(edge.toId);
    if (!from || !to) continue;
    if (from === 'parent' && to === 'parent') parentEdges.push(edge);
    else if (from === to) childEdges.get(from)?.push(edge);
    else bridgeRows.push(edge);
  }

  const labelRows =
    childIds.length === 0
      ? []
      : await db
          .select({
            fromId: collectionEdges.fromId,
            toId: collectionEdges.toId,
            label: collectionEdges.label,
          })
          .from(collectionEdges)
          .where(
            and(
              eq(collectionEdges.userId, userId),
              isNull(collectionEdges.deletedAt),
              or(eq(collectionEdges.fromId, collectionId), eq(collectionEdges.toId, collectionId)),
            ),
          )
          .orderBy(asc(collectionEdges.createdAt), asc(collectionEdges.id));
  const childIdSet = new Set(childIds);
  const labelsByChild = new Map<string, string[]>();
  for (const row of labelRows) {
    const other = row.fromId === collectionId ? row.toId : row.fromId;
    if (!childIdSet.has(other)) continue;
    const list = labelsByChild.get(other) ?? [];
    list.push(row.label);
    labelsByChild.set(other, list);
  }

  const shownEdges = [...parentEdges, ...bridgeRows, ...childIds.flatMap((id) => childEdges.get(id) ?? [])];
  const nodeStats = await cardStats(db, userId, 'node', nodeIds);
  const edgeStats = await cardStats(db, userId, 'edge', shownEdges.map((row) => row.id));
  const assetRows =
    nodeIds.length === 0
      ? []
      : await db
          .select({ id: assets.id, ownerId: assets.ownerId })
          .from(assets)
          .where(and(eq(assets.userId, userId), eq(assets.ownerKind, 'node'), inArray(assets.ownerId, nodeIds)));
  const assetByNode = new Map(assetRows.map((row) => [row.ownerId, row.id]));

  return {
    nodes: parentMembers.map((row) => toNode(row, nodeStats.get(row.id), assetByNode.get(row.id) ?? null)),
    edges: parentEdges.map((row) => toEdge(row, edgeStats.get(row.id))),
    bridges: bridgeRows.map((row) => toEdge(row, edgeStats.get(row.id))),
    inclusions: placed.map((row) => ({
      childId: row.childId,
      title: row.title,
      x: row.x,
      y: row.y,
      collapsed: row.collapsed,
      labels: labelsByChild.get(row.childId) ?? [],
      nodes: (byChild.get(row.childId) ?? []).map((member) =>
        toNode(member, nodeStats.get(member.id), assetByNode.get(member.id) ?? null),
      ),
      edges: (childEdges.get(row.childId) ?? []).map((edge) => toEdge(edge, edgeStats.get(edge.id))),
    })),
    appearance,
  };
}
