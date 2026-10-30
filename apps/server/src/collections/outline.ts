import {
  createNodeResultSchema,
  hasOutlineCycle,
  initialRoots,
  memberResultSchema,
  normalizeOutline,
  outlineVersionSchema,
  promoteOnRemove,
  type CreateNodeBody,
  type OutlineItem,
  type PutOutlineBody,
  type RestoreOutlineBody,
} from '@unfold/dto';
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { createDb } from '../db/client.js';
import { collections, memberships, nodes } from '../db/schema.js';
import { isUniqueViolation } from '../http.js';

type Database = ReturnType<typeof createDb>;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type OutlineFailure = 'missing' | 'invalid' | 'conflict' | 'absent';

type StoredMember = OutlineItem & { createdAt: Date };

type PlacementExtra = {
  x?: number;
  y?: number;
  z?: number;
  imageWidth?: number | null;
};

export type MemberSlot = {
  parentId: string | null;
  outlineOrder: number;
  outlineVersion: number;
};

class OutlineRollback extends Error {
  constructor(readonly failure: OutlineFailure) {
    super(failure);
  }
}

async function run<T>(db: Database, work: (tx: Tx) => Promise<T>): Promise<T | OutlineFailure> {
  try {
    return await db.transaction(work);
  } catch (error) {
    if (error instanceof OutlineRollback) return error.failure;
    throw error;
  }
}

async function lockCollection(tx: Tx, userId: string, id: string) {
  const rows = await tx
    .select({
      id: collections.id,
      outlineVersion: collections.outlineVersion,
      outlineInitialized: collections.outlineInitialized,
    })
    .from(collections)
    .where(and(eq(collections.id, id), eq(collections.userId, userId), isNull(collections.deletedAt)))
    .limit(1)
    .for('update');
  return rows[0] ?? null;
}

async function readMembers(
  tx: Tx,
  userId: string,
  collectionId: string,
  includeDeletedNodeId?: string,
): Promise<StoredMember[]> {
  const rows = await tx
    .select({
      nodeId: memberships.nodeId,
      parentId: memberships.parentNodeId,
      order: memberships.outlineOrder,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(nodes, eq(nodes.id, memberships.nodeId))
    .where(
      and(
        eq(memberships.collectionId, collectionId),
        eq(nodes.userId, userId),
        includeDeletedNodeId
          ? or(isNull(nodes.deletedAt), eq(nodes.id, includeDeletedNodeId))
          : isNull(nodes.deletedAt),
      ),
    )
    .orderBy(asc(memberships.createdAt), asc(memberships.nodeId));
  return rows.map((row) => ({
    nodeId: row.nodeId,
    parentId: row.parentId,
    order: row.order,
    createdAt: row.createdAt,
  }));
}

function asItems(members: readonly StoredMember[]): OutlineItem[] {
  return members.map((member) => ({ nodeId: member.nodeId, parentId: member.parentId, order: member.order }));
}

function rootsOf(members: readonly StoredMember[]): OutlineItem[] {
  return initialRoots(
    members.map((member) => ({ nodeId: member.nodeId, createdAt: member.createdAt.toISOString() })),
  );
}

async function writeMembers(tx: Tx, collectionId: string, items: readonly OutlineItem[]) {
  for (const item of items) {
    await tx
      .update(memberships)
      .set({ parentNodeId: item.parentId, outlineOrder: item.order })
      .where(and(eq(memberships.collectionId, collectionId), eq(memberships.nodeId, item.nodeId)));
  }
}

async function setVersion(tx: Tx, collectionId: string, version: number) {
  await tx
    .update(collections)
    .set({ outlineVersion: version, outlineInitialized: true })
    .where(eq(collections.id, collectionId));
}

function placeAmong(
  items: readonly OutlineItem[],
  nodeId: string,
  parentId: string | null,
  afterNodeId: string | undefined,
): OutlineItem[] | 'parent' | 'after' {
  if (parentId !== null && !items.some((item) => item.nodeId === parentId)) return 'parent';
  const normalized = normalizeOutline(items);
  const siblings = normalized
    .filter((item) => item.parentId === parentId)
    .sort((a, b) => a.order - b.order);
  if (afterNodeId === undefined) {
    return normalizeOutline([...normalized, { nodeId, parentId, order: siblings.length }]);
  }
  const after = siblings.find((item) => item.nodeId === afterNodeId);
  if (!after) return 'after';
  const shifted = normalized.map((item) =>
    item.parentId === parentId && item.order > after.order ? { ...item, order: item.order + 1 } : item,
  );
  return normalizeOutline([...shifted, { nodeId, parentId, order: after.order + 1 }]);
}

/** 把一个已存在的点插进本合集大纲。调用方负责事务。 */
export async function insertMemberAt(
  tx: Tx,
  userId: string,
  collectionId: string,
  nodeId: string,
  parentId: string | null,
  afterNodeId: string | undefined,
  extra?: PlacementExtra,
): Promise<MemberSlot | 'missing' | 'parent' | 'after'> {
  const locked = await lockCollection(tx, userId, collectionId);
  if (!locked) return 'missing';
  const members = await readMembers(tx, userId, collectionId);
  const base = locked.outlineInitialized ? asItems(members) : rootsOf(members);
  const placed = placeAmong(base, nodeId, parentId, afterNodeId);
  if (placed === 'parent' || placed === 'after') return placed;
  const item = placed.find((row) => row.nodeId === nodeId);
  if (!item) return 'parent';
  await writeMembers(
    tx,
    collectionId,
    placed.filter((row) => row.nodeId !== nodeId),
  );
  await tx.insert(memberships).values({
    collectionId,
    nodeId,
    parentNodeId: item.parentId,
    outlineOrder: item.order,
    ...extra,
  });
  const outlineVersion = locked.outlineVersion + 1;
  await setVersion(tx, collectionId, outlineVersion);
  return { parentId: item.parentId, outlineOrder: item.order, outlineVersion };
}

export async function ensureCollectionOutline(db: Database, userId: string, collectionId: string): Promise<number | null> {
  return db.transaction(async (tx) => {
    const locked = await lockCollection(tx, userId, collectionId);
    if (!locked) return null;
    if (locked.outlineInitialized) return locked.outlineVersion;
    const members = await readMembers(tx, userId, collectionId);
    await writeMembers(tx, collectionId, rootsOf(members));
    const outlineVersion = locked.outlineVersion + 1;
    await setVersion(tx, collectionId, outlineVersion);
    return outlineVersion;
  });
}

function rejectItems(members: readonly StoredMember[], items: readonly OutlineItem[]): boolean {
  const memberIds = new Set(members.map((member) => member.nodeId));
  if (items.length !== memberIds.size) return true;
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.nodeId) || !memberIds.has(item.nodeId)) return true;
    seen.add(item.nodeId);
    if (item.parentId === item.nodeId) return true;
    if (item.parentId !== null && !memberIds.has(item.parentId)) return true;
  }
  return hasOutlineCycle(items);
}

export function putCollectionOutline(db: Database, userId: string, collectionId: string, body: PutOutlineBody) {
  return run(db, async (tx) => {
    const locked = await lockCollection(tx, userId, collectionId);
    if (!locked) throw new OutlineRollback('missing');
    if (body.expectedVersion !== locked.outlineVersion) throw new OutlineRollback('conflict');
    const members = await readMembers(tx, userId, collectionId);
    if (rejectItems(members, body.items)) throw new OutlineRollback('invalid');
    const next = normalizeOutline(body.items);
    await writeMembers(tx, collectionId, next);
    const outlineVersion = locked.outlineVersion + 1;
    await setVersion(tx, collectionId, outlineVersion);
    return outlineVersionSchema.parse({ outlineVersion });
  });
}

async function duplicateNodes(tx: Tx, userId: string, name: string, exceptId: string) {
  const rows = await tx
    .select({ id: nodes.id, name: nodes.name, description: nodes.description })
    .from(nodes)
    .where(and(eq(nodes.userId, userId), eq(nodes.name, name), isNull(nodes.deletedAt)))
    .orderBy(desc(nodes.updatedAt), asc(nodes.id))
    .limit(6);
  const picked = rows.filter((row) => row.id !== exceptId).slice(0, 5);
  if (picked.length === 0) return [];
  const links = await tx
    .select({ nodeId: memberships.nodeId, id: collections.id, title: collections.title })
    .from(memberships)
    .innerJoin(collections, eq(collections.id, memberships.collectionId))
    .where(
      and(
        inArray(
          memberships.nodeId,
          picked.map((row) => row.id),
        ),
        eq(collections.userId, userId),
        isNull(collections.deletedAt),
      ),
    )
    .orderBy(asc(collections.createdAt), asc(collections.id));
  return picked.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    collections: links.filter((link) => link.nodeId === row.id).map((link) => ({ id: link.id, title: link.title })),
  }));
}

export function createCollectionNode(db: Database, userId: string, collectionId: string, body: CreateNodeBody) {
  return run(db, async (tx) => {
    const locked = await lockCollection(tx, userId, collectionId);
    if (!locked) throw new OutlineRollback('missing');
    const inserted = await tx
      .insert(nodes)
      .values({ userId, name: body.name })
      .returning({ id: nodes.id, name: nodes.name });
    const node = inserted[0];
    if (!node) throw new OutlineRollback('missing');
    const placed = await insertMemberAt(
      tx,
      userId,
      collectionId,
      node.id,
      body.parentId ?? null,
      body.afterNodeId,
    );
    if (placed === 'missing') throw new OutlineRollback('missing');
    if (placed === 'parent' || placed === 'after') throw new OutlineRollback('invalid');
    const duplicates = await duplicateNodes(tx, userId, node.name, node.id);
    return createNodeResultSchema.parse({
      id: node.id,
      name: node.name,
      parentId: placed.parentId,
      outlineOrder: placed.outlineOrder,
      outlineVersion: placed.outlineVersion,
      duplicates,
    });
  });
}

async function existingMember(db: Database, userId: string, collectionId: string, nodeId: string) {
  const locked = await db
    .select({ outlineVersion: collections.outlineVersion })
    .from(collections)
    .where(and(eq(collections.id, collectionId), eq(collections.userId, userId), isNull(collections.deletedAt)))
    .limit(1);
  const version = locked[0]?.outlineVersion;
  if (version === undefined) return 'missing' as const;
  const rows = await db
    .select({ parentId: memberships.parentNodeId, order: memberships.outlineOrder })
    .from(memberships)
    .innerJoin(nodes, eq(nodes.id, memberships.nodeId))
    .where(
      and(
        eq(memberships.collectionId, collectionId),
        eq(memberships.nodeId, nodeId),
        eq(nodes.userId, userId),
        isNull(nodes.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return memberResultSchema.parse({
    status: 'exists' as const,
    parentId: row.parentId,
    outlineOrder: row.order,
    outlineVersion: version,
  });
}

export async function addCollectionMember(
  db: Database,
  userId: string,
  collectionId: string,
  nodeId: string,
  parentId: string | null,
) {
  try {
    return await run(db, async (tx) => {
      const locked = await lockCollection(tx, userId, collectionId);
      if (!locked) throw new OutlineRollback('missing');
      const nodeRows = await tx
        .select({ id: nodes.id })
        .from(nodes)
        .where(and(eq(nodes.id, nodeId), eq(nodes.userId, userId), isNull(nodes.deletedAt)))
        .limit(1);
      if (!nodeRows[0]) throw new OutlineRollback('absent');
      const members = await readMembers(tx, userId, collectionId);
      const existing = members.find((member) => member.nodeId === nodeId);
      if (existing) {
        return memberResultSchema.parse({
          status: 'exists',
          parentId: existing.parentId,
          outlineOrder: existing.order,
          outlineVersion: locked.outlineVersion,
        });
      }
      const placed = await insertMemberAt(tx, userId, collectionId, nodeId, parentId, undefined);
      if (placed === 'missing') throw new OutlineRollback('missing');
      if (placed === 'parent' || placed === 'after') throw new OutlineRollback('invalid');
      return memberResultSchema.parse({ status: 'joined', ...placed });
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const current = await existingMember(db, userId, collectionId, nodeId);
    if (!current || current === 'missing') throw error;
    return current;
  }
}

export function removeCollectionMember(
  db: Database,
  userId: string,
  collectionId: string,
  nodeId: string,
  expectedVersion: number | undefined,
) {
  return run(db, async (tx) => {
    const locked = await lockCollection(tx, userId, collectionId);
    if (!locked) throw new OutlineRollback('missing');
    if (expectedVersion !== undefined && expectedVersion !== locked.outlineVersion) {
      throw new OutlineRollback('conflict');
    }
    const members = await readMembers(tx, userId, collectionId);
    if (!members.some((member) => member.nodeId === nodeId)) throw new OutlineRollback('absent');
    const base = locked.outlineInitialized ? asItems(members) : rootsOf(members);
    const next = promoteOnRemove(base, nodeId);
    await writeMembers(tx, collectionId, next);
    await tx
      .delete(memberships)
      .where(and(eq(memberships.collectionId, collectionId), eq(memberships.nodeId, nodeId)));
    const outlineVersion = locked.outlineVersion + 1;
    await setVersion(tx, collectionId, outlineVersion);
    return outlineVersionSchema.parse({ outlineVersion });
  });
}

function restoredItems(members: readonly StoredMember[], body: RestoreOutlineBody): OutlineItem[] | null {
  const memberIds = new Set(members.map((member) => member.nodeId));
  if (memberIds.has(body.nodeId)) return null;
  if (body.parentId !== null && !memberIds.has(body.parentId)) return null;
  const childIds = new Set<string>();
  for (const child of body.children) {
    if (child.nodeId === body.nodeId || !memberIds.has(child.nodeId) || childIds.has(child.nodeId)) return null;
    if (child.parentId !== null && child.parentId !== body.nodeId && !memberIds.has(child.parentId)) return null;
    childIds.add(child.nodeId);
  }
  const childOf = new Map(body.children.map((child) => [child.nodeId, child]));
  const next = members.map((member) => {
    const child = childOf.get(member.nodeId);
    if (!child) return { nodeId: member.nodeId, parentId: member.parentId, order: member.order };
    return { nodeId: child.nodeId, parentId: child.parentId, order: child.order };
  });
  next.push({ nodeId: body.nodeId, parentId: body.parentId, order: body.order });
  if (hasOutlineCycle(next)) return null;
  return next;
}

export function restoreCollectionOutline(db: Database, userId: string, collectionId: string, body: RestoreOutlineBody) {
  return run(db, async (tx) => {
    const locked = await lockCollection(tx, userId, collectionId);
    if (!locked) throw new OutlineRollback('missing');
    if (body.expectedVersion !== locked.outlineVersion) throw new OutlineRollback('conflict');
    const nodeRows = await tx
      .select({ id: nodes.id })
      .from(nodes)
      .where(and(eq(nodes.id, body.nodeId), eq(nodes.userId, userId), isNull(nodes.deletedAt)))
      .limit(1);
    if (!nodeRows[0]) throw new OutlineRollback('absent');
    const members = await readMembers(tx, userId, collectionId);
    if (members.some((member) => member.nodeId === body.nodeId)) throw new OutlineRollback('conflict');
    const next = restoredItems(members, body);
    if (!next) throw new OutlineRollback('invalid');
    await writeMembers(
      tx,
      collectionId,
      next.filter((item) => item.nodeId !== body.nodeId),
    );
    await tx.insert(memberships).values({
      collectionId,
      nodeId: body.nodeId,
      parentNodeId: body.parentId,
      outlineOrder: body.order,
      x: body.placement.x,
      y: body.placement.y,
      z: body.placement.z,
      imageWidth: body.placement.imageWidth,
    });
    const outlineVersion = locked.outlineVersion + 1;
    await setVersion(tx, collectionId, outlineVersion);
    return outlineVersionSchema.parse({ outlineVersion });
  });
}

/** 删点之前，每个仍包含它的合集先提升直接子项。点行可以已经标上删除。 */
export async function promoteMembershipsOfNode(tx: Tx, userId: string, nodeId: string) {
  const rows = await tx
    .select({ collectionId: memberships.collectionId })
    .from(memberships)
    .where(eq(memberships.nodeId, nodeId));
  const collectionIds = [...new Set(rows.map((row) => row.collectionId))].sort();
  for (const collectionId of collectionIds) {
    const locked = await lockCollection(tx, userId, collectionId);
    if (!locked) continue;
    const members = await readMembers(tx, userId, collectionId, nodeId);
    const base = locked.outlineInitialized ? asItems(members) : rootsOf(members);
    const next = promoteOnRemove(base, nodeId);
    await writeMembers(tx, collectionId, next);
    await setVersion(tx, collectionId, locked.outlineVersion + 1);
  }
}
