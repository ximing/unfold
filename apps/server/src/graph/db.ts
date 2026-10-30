import type { Card, CardType, OwnerKind } from '@unfold/dto';
import { and, asc, eq, inArray, isNull, max, or } from 'drizzle-orm';
import { removeAssetFiles } from '../assets/files.js';
import { promoteMembershipsOfNode } from '../collections/outline.js';
import type { createDb } from '../db/client.js';
import { assets, cards, collectionEdges, collectionInclusions, collections, edges, memberships, nodes } from '../db/schema.js';

export type Database = ReturnType<typeof createDb>;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Query = Database | Tx;

function stamp() {
  const now = new Date();
  return { deletedAt: now, updatedAt: now };
}

export function presentCard(row: {
  id: string;
  ownerKind: string;
  ownerId: string;
  cardType: string;
  position: number;
  content: unknown;
}): Card {
  return {
    id: row.id,
    ownerKind: row.ownerKind as OwnerKind,
    ownerId: row.ownerId,
    type: row.cardType as CardType,
    position: row.position,
    content: row.content as Card['content'],
  } as Card;
}

export async function activeCollection(db: Query, userId: string, id: string) {
  const rows = await db
    .select({ id: collections.id, title: collections.title })
    .from(collections)
    .where(and(eq(collections.id, id), eq(collections.userId, userId), isNull(collections.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function activeNode(db: Query, userId: string, id: string) {
  const rows = await db
    .select({ id: nodes.id, name: nodes.name, description: nodes.description })
    .from(nodes)
    .where(and(eq(nodes.id, id), eq(nodes.userId, userId), isNull(nodes.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function activeNodeIdSet(db: Query, userId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Set<string>();
  const rows = await db
    .select({ id: nodes.id })
    .from(nodes)
    .where(and(eq(nodes.userId, userId), isNull(nodes.deletedAt), inArray(nodes.id, unique)));
  return new Set(rows.map((row) => row.id));
}

export async function activeCollectionIdSet(db: Query, userId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Set<string>();
  const rows = await db
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.userId, userId), isNull(collections.deletedAt), inArray(collections.id, unique)));
  return new Set(rows.map((row) => row.id));
}

export async function listCards(db: Query, userId: string, ownerKind: OwnerKind, ownerId: string) {
  const rows = await db
    .select({
      id: cards.id,
      ownerKind: cards.ownerKind,
      ownerId: cards.ownerId,
      cardType: cards.cardType,
      position: cards.position,
      content: cards.content,
    })
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        eq(cards.ownerKind, ownerKind),
        eq(cards.ownerId, ownerId),
        isNull(cards.deletedAt),
      ),
    )
    .orderBy(asc(cards.position), asc(cards.createdAt), asc(cards.id));
  return rows.map(presentCard);
}

export async function nextCardPosition(db: Query, userId: string, ownerKind: string, ownerId: string) {
  const rows = await db
    .select({ value: max(cards.position) })
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        eq(cards.ownerKind, ownerKind),
        eq(cards.ownerId, ownerId),
        isNull(cards.deletedAt),
      ),
    );
  const value = rows[0]?.value;
  if (value == null) return 0;
  return Number(value) + 1;
}

async function softDeleteEdgeCards(
  tx: Tx,
  userId: string,
  ownerKind: 'edge' | 'collection_edge',
  edgeIds: string[],
) {
  if (edgeIds.length === 0) return;
  await tx
    .update(cards)
    .set(stamp())
    .where(
      and(
        eq(cards.userId, userId),
        eq(cards.ownerKind, ownerKind),
        inArray(cards.ownerId, edgeIds),
        isNull(cards.deletedAt),
      ),
    );
}

export async function removeCollection(db: Database, userId: string, id: string) {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(collections)
      .set(stamp())
      .where(and(eq(collections.id, id), eq(collections.userId, userId), isNull(collections.deletedAt)))
      .returning({ id: collections.id });
    if (!updated[0]) return false;

    const linked = await tx
      .select({ id: collectionEdges.id })
      .from(collectionEdges)
      .where(
        and(
          eq(collectionEdges.userId, userId),
          isNull(collectionEdges.deletedAt),
          or(eq(collectionEdges.fromId, id), eq(collectionEdges.toId, id)),
        ),
      );
    const edgeIds = linked.map((row) => row.id);
    await softDeleteEdgeCards(tx, userId, 'collection_edge', edgeIds);
    if (edgeIds.length > 0) {
      await tx
        .update(collectionEdges)
        .set(stamp())
        .where(and(eq(collectionEdges.userId, userId), inArray(collectionEdges.id, edgeIds)));
    }
    await tx.delete(memberships).where(eq(memberships.collectionId, id));
    await tx
      .delete(collectionInclusions)
      .where(or(eq(collectionInclusions.parentId, id), eq(collectionInclusions.childId, id)));
    return true;
  });
}

export async function removeNode(db: Database, userId: string, id: string) {
  const assetIds = await db.transaction(async (tx) => {
    const updated = await tx
      .update(nodes)
      .set(stamp())
      .where(and(eq(nodes.id, id), eq(nodes.userId, userId), isNull(nodes.deletedAt)))
      .returning({ id: nodes.id });
    if (!updated[0]) return null;
    await promoteMembershipsOfNode(tx, userId, id);

    const linked = await tx
      .select({ id: edges.id })
      .from(edges)
      .where(
        and(eq(edges.userId, userId), isNull(edges.deletedAt), or(eq(edges.fromId, id), eq(edges.toId, id))),
      );
    const edgeIds = linked.map((row) => row.id);
    await softDeleteEdgeCards(tx, userId, 'edge', edgeIds);
    if (edgeIds.length > 0) {
      await tx.update(edges).set(stamp()).where(and(eq(edges.userId, userId), inArray(edges.id, edgeIds)));
    }
    await tx
      .update(cards)
      .set(stamp())
      .where(
        and(eq(cards.userId, userId), eq(cards.ownerKind, 'node'), eq(cards.ownerId, id), isNull(cards.deletedAt)),
      );
    await tx.delete(memberships).where(eq(memberships.nodeId, id));
    return removedNodeAssetIds(tx, userId, id);
  });
  if (assetIds === null) return false;
  await removeAssetFiles(assetIds);
  return true;
}

/** 软删这张卡，并在提交后删掉它名下的文件。 */
export async function removeCard(db: Database, userId: string, id: string) {
  const assetIds = await db.transaction(async (tx) => {
    const updated = await tx
      .update(cards)
      .set(stamp())
      .where(and(eq(cards.id, id), eq(cards.userId, userId), isNull(cards.deletedAt)))
      .returning({ id: cards.id });
    if (!updated[0]) return null;
    const rows = await tx
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.userId, userId), eq(assets.ownerKind, 'card'), eq(assets.ownerId, id)));
    const ids = rows.map((row) => row.id);
    if (ids.length > 0) {
      await tx.delete(assets).where(and(eq(assets.userId, userId), inArray(assets.id, ids)));
    }
    return ids;
  });
  if (assetIds === null) return false;
  await removeAssetFiles(assetIds);
  return true;
}

/** 点上的卡片刚被软删，名下资产仍要清掉，所以不按 deleted_at 过滤。 */
async function removedNodeAssetIds(tx: Tx, userId: string, nodeId: string): Promise<string[]> {
  const nodeCards = await tx
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.userId, userId), eq(cards.ownerKind, 'node'), eq(cards.ownerId, nodeId)));
  const cardIds = nodeCards.map((row) => row.id);
  const nodeAssets = await tx
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.userId, userId), eq(assets.ownerKind, 'node'), eq(assets.ownerId, nodeId)));
  const cardAssets =
    cardIds.length === 0
      ? []
      : await tx
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.userId, userId), eq(assets.ownerKind, 'card'), inArray(assets.ownerId, cardIds)));
  const assetIds = [...nodeAssets, ...cardAssets].map((row) => row.id);
  if (assetIds.length > 0) {
    await tx.delete(assets).where(and(eq(assets.userId, userId), inArray(assets.id, assetIds)));
  }
  return assetIds;
}

export async function removeEdge(db: Database, userId: string, id: string) {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(edges)
      .set(stamp())
      .where(and(eq(edges.id, id), eq(edges.userId, userId), isNull(edges.deletedAt)))
      .returning({ id: edges.id });
    if (!updated[0]) return false;
    await softDeleteEdgeCards(tx, userId, 'edge', [id]);
    return true;
  });
}

export async function removeCollectionEdge(db: Database, userId: string, id: string) {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(collectionEdges)
      .set(stamp())
      .where(and(eq(collectionEdges.id, id), eq(collectionEdges.userId, userId), isNull(collectionEdges.deletedAt)))
      .returning({ id: collectionEdges.id });
    if (!updated[0]) return false;
    await softDeleteEdgeCards(tx, userId, 'collection_edge', [id]);
    return true;
  });
}
