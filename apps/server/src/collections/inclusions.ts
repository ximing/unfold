import { anchorForFrameOrigin, type CreateInclusionBody, type UpdateInclusionBody } from '@unfold/dto';
import { and, asc, count, eq, isNull, ne, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { collectionEdges, collectionInclusions, collections, edges, memberships } from '../db/schema.js';
import { activeCollection, type Query } from '../graph/db.js';
import { isUniqueViolation } from '../http.js';

export type InclusionFailure = 'missing' | 'self' | 'cycle' | 'exists' | 'needs-label' | 'conflict' | 'absent';

type Link = { parentId: string; childId: string };

function closesCycle(parentId: string, childId: string, links: readonly Link[]): boolean {
  if (parentId === childId) return true;
  const childrenOf = new Map<string, string[]>();
  for (const link of links) {
    const list = childrenOf.get(link.parentId) ?? [];
    list.push(link.childId);
    childrenOf.set(link.parentId, list);
  }
  const seen = new Set<string>();
  const stack = [childId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (current === parentId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of childrenOf.get(current) ?? []) stack.push(next);
  }
  return false;
}

async function inclusionLinks(db: Query, userId: string): Promise<Link[]> {
  const child = alias(collections, 'inclusion_child');
  const rows = await db
    .select({ parentId: collectionInclusions.parentId, childId: collectionInclusions.childId })
    .from(collectionInclusions)
    .innerJoin(collections, eq(collections.id, collectionInclusions.parentId))
    .innerJoin(child, eq(child.id, collectionInclusions.childId))
    .where(
      and(
        eq(collections.userId, userId),
        eq(child.userId, userId),
        isNull(collections.deletedAt),
        isNull(child.deletedAt),
      ),
    );
  return rows;
}

async function relationLabels(db: Query, userId: string, parentId: string, childId: string): Promise<string[]> {
  const rows = await db
    .select({ fromId: collectionEdges.fromId, toId: collectionEdges.toId, label: collectionEdges.label })
    .from(collectionEdges)
    .where(
      and(
        eq(collectionEdges.userId, userId),
        isNull(collectionEdges.deletedAt),
        or(
          and(eq(collectionEdges.fromId, parentId), eq(collectionEdges.toId, childId)),
          and(eq(collectionEdges.fromId, childId), eq(collectionEdges.toId, parentId)),
        ),
      ),
    )
    .orderBy(asc(collectionEdges.createdAt), asc(collectionEdges.id));
  return rows.map((row) => row.label);
}

/** 与父合集已有点边相连的其他合集。两个方向各查一次。 */
async function linkedByNodes(db: Query, userId: string, parentId: string): Promise<Set<string>> {
  const linked = new Set<string>();
  for (const direction of ['from', 'to'] as const) {
    const parentMember = alias(memberships, `link_parent_${direction}`);
    const otherMember = alias(memberships, `link_other_${direction}`);
    const otherCollection = alias(collections, `link_collection_${direction}`);
    const parentNode = direction === 'from' ? edges.fromId : edges.toId;
    const otherNode = direction === 'from' ? edges.toId : edges.fromId;
    const rows = await db
      .select({ childId: otherMember.collectionId })
      .from(edges)
      .innerJoin(parentMember, eq(parentMember.nodeId, parentNode))
      .innerJoin(otherMember, eq(otherMember.nodeId, otherNode))
      .innerJoin(otherCollection, eq(otherCollection.id, otherMember.collectionId))
      .where(
        and(
          eq(edges.userId, userId),
          isNull(edges.deletedAt),
          eq(parentMember.collectionId, parentId),
          ne(otherMember.collectionId, parentId),
          eq(otherCollection.userId, userId),
          isNull(otherCollection.deletedAt),
        ),
      );
    for (const row of rows) linked.add(row.childId);
  }
  return linked;
}

export async function listInclusionCandidates(db: Query, userId: string, parentId: string) {
  const parent = await activeCollection(db, userId, parentId);
  if (!parent) return null;
  const rows = await db
    .select({ id: collections.id, title: collections.title })
    .from(collections)
    .where(and(eq(collections.userId, userId), isNull(collections.deletedAt)))
    .orderBy(asc(collections.createdAt), asc(collections.id));
  const counts = await db
    .select({ id: memberships.collectionId, value: count() })
    .from(memberships)
    .innerJoin(collections, eq(collections.id, memberships.collectionId))
    .where(and(eq(collections.userId, userId), isNull(collections.deletedAt)))
    .groupBy(memberships.collectionId);
  const countOf = new Map(counts.map((row) => [row.id, row.value]));
  const links = await inclusionLinks(db, userId);
  const placed = new Set(links.filter((link) => link.parentId === parentId).map((link) => link.childId));
  const nodeLinks = await linkedByNodes(db, userId, parentId);
  const labelRows = await db
    .select({ fromId: collectionEdges.fromId, toId: collectionEdges.toId, label: collectionEdges.label })
    .from(collectionEdges)
    .where(
      and(
        eq(collectionEdges.userId, userId),
        isNull(collectionEdges.deletedAt),
        or(eq(collectionEdges.fromId, parentId), eq(collectionEdges.toId, parentId)),
      ),
    )
    .orderBy(asc(collectionEdges.createdAt), asc(collectionEdges.id));

  const collectionsOut = [];
  for (const row of rows) {
    if (row.id === parentId || placed.has(row.id)) continue;
    if (closesCycle(parentId, row.id, links)) continue;
    const labels = labelRows
      .filter((edge) => edge.fromId === row.id || edge.toId === row.id)
      .map((edge) => edge.label);
    collectionsOut.push({
      id: row.id,
      title: row.title,
      nodeCount: countOf.get(row.id) ?? 0,
      linked: labels.length > 0 || nodeLinks.has(row.id),
      labels,
    });
  }
  return { collections: collectionsOut };
}

export async function createInclusion(
  db: Query,
  userId: string,
  parentId: string,
  body: CreateInclusionBody,
): Promise<InclusionFailure | 'ok'> {
  try {
    return await db.transaction(async (tx) => {
      const parent = await activeCollection(tx, userId, parentId);
      if (!parent) return 'missing';
      if (body.childId === parentId) return 'self';
      const child = await activeCollection(tx, userId, body.childId);
      if (!child) return 'missing';
      const links = await inclusionLinks(tx, userId);
      if (links.some((link) => link.parentId === parentId && link.childId === body.childId)) return 'exists';
      if (closesCycle(parentId, body.childId, links)) return 'cycle';

      const labels = await relationLabels(tx, userId, parentId, body.childId);
      const nodeLinks = await linkedByNodes(tx, userId, parentId);
      const linked = labels.length > 0 || nodeLinks.has(body.childId);
      if (!linked) {
        if (!body.label) return 'needs-label';
        await tx.insert(collectionEdges).values({
          userId,
          fromId: parentId,
          toId: body.childId,
          label: body.label,
        });
      }

      const points = await tx
        .select({ x: memberships.x, y: memberships.y })
        .from(memberships)
        .where(eq(memberships.collectionId, body.childId));
      const anchor = anchorForFrameOrigin({ x: body.originX, y: body.originY }, points);
      await tx.insert(collectionInclusions).values({
        parentId,
        childId: body.childId,
        x: anchor.x,
        y: anchor.y,
        collapsed: false,
      });
      return 'ok';
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const links = await inclusionLinks(db, userId);
    if (links.some((link) => link.parentId === parentId && link.childId === body.childId)) return 'exists';
    return 'conflict';
  }
}

export async function updateInclusion(
  db: Query,
  userId: string,
  parentId: string,
  childId: string,
  body: UpdateInclusionBody,
): Promise<InclusionFailure | 'ok'> {
  const parent = await activeCollection(db, userId, parentId);
  if (!parent) return 'missing';
  const child = await activeCollection(db, userId, childId);
  if (!child) return 'absent';
  const values: { x?: number; y?: number; collapsed?: boolean } = {};
  if (body.x !== undefined) values.x = body.x;
  if (body.y !== undefined) values.y = body.y;
  if (body.collapsed !== undefined) values.collapsed = body.collapsed;
  const updated = await db
    .update(collectionInclusions)
    .set(values)
    .where(and(eq(collectionInclusions.parentId, parentId), eq(collectionInclusions.childId, childId)))
    .returning({ childId: collectionInclusions.childId });
  if (!updated[0]) return 'absent';
  return 'ok';
}

export async function removeInclusion(
  db: Query,
  userId: string,
  parentId: string,
  childId: string,
): Promise<InclusionFailure | 'ok'> {
  const parent = await activeCollection(db, userId, parentId);
  if (!parent) return 'missing';
  const removed = await db
    .delete(collectionInclusions)
    .where(and(eq(collectionInclusions.parentId, parentId), eq(collectionInclusions.childId, childId)))
    .returning({ childId: collectionInclusions.childId });
  if (!removed[0]) return 'absent';
  return 'ok';
}
