import {
  mindmapAdoptResultSchema,
  mindmapCommitResultSchema,
  type MindmapAdoptResult,
  type MindmapCommitResult,
} from '@unfold/dto';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Database } from '../graph/db.js';
import { collections, memberships } from '../db/schema.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

async function lockCollection(tx: Tx, userId: string, id: string) {
  const rows = await tx
    .select({ id: collections.id, mindmapAnchored: collections.mindmapAnchored })
    .from(collections)
    .where(and(eq(collections.id, id), eq(collections.userId, userId), isNull(collections.deletedAt)))
    .limit(1)
    .for('update');
  return rows[0] ?? null;
}

export async function adoptMindmap(
  db: Database,
  userId: string,
  collectionId: string,
): Promise<MindmapAdoptResult | 'missing'> {
  const outcome = await db.transaction(async (tx) => {
    const locked = await lockCollection(tx, userId, collectionId);
    if (!locked) return 'missing' as const;
    if (locked.mindmapAnchored) {
      return { mindmapAnchored: true as const, copied: 0, changed: false as const };
    }
    const copied = await tx
      .update(memberships)
      .set({
        freeX: sql<number | null>`${memberships.x}`,
        freeY: sql<number | null>`${memberships.y}`,
        freeCaptured: true,
      })
      .where(and(eq(memberships.collectionId, collectionId), eq(memberships.freeCaptured, false)))
      .returning({ nodeId: memberships.nodeId });
    return { mindmapAnchored: false as const, copied: copied.length, changed: true as const };
  });
  if (outcome === 'missing') return 'missing';
  if (outcome.changed) {
    // eslint-disable-next-line no-console -- 采纳观测。logger 关着。
    console.info(`mindmap-adopt collection=${collectionId} copied=${outcome.copied}`);
  }
  return mindmapAdoptResultSchema.parse({ mindmapAnchored: outcome.mindmapAnchored, copied: outcome.copied });
}

export async function commitMindmap(
  db: Database,
  userId: string,
  collectionId: string,
): Promise<MindmapCommitResult | 'missing' | 'conflict'> {
  const outcome = await db.transaction(async (tx) => {
    const locked = await lockCollection(tx, userId, collectionId);
    if (!locked) return 'missing' as const;
    if (locked.mindmapAnchored) return 'already' as const;
    const blocking = await tx
      .select({ nodeId: memberships.nodeId })
      .from(memberships)
      .where(
        and(eq(memberships.collectionId, collectionId), eq(memberships.freeCaptured, false), isNotNull(memberships.x)),
      )
      .limit(1);
    if (blocking.length > 0) return 'conflict' as const;
    await tx.update(collections).set({ mindmapAnchored: true }).where(eq(collections.id, collectionId));
    return 'committed' as const;
  });
  if (outcome === 'missing' || outcome === 'conflict') return outcome;
  if (outcome === 'committed') {
    // eslint-disable-next-line no-console -- 锚定观测。logger 关着。
    console.info(`mindmap-commit collection=${collectionId}`);
  }
  return mindmapCommitResultSchema.parse({ mindmapAnchored: true });
}
