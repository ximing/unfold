import { randomUUID } from 'node:crypto';
import { and, eq, isNull, max } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { assets, memberships, nodes } from '../db/schema.js';
import { activeCollection, type Database } from '../graph/db.js';
import {
  collectionNotFound,
  idParamsSchema,
  invalidBody,
  nodeNotFound,
  type SessionLookup,
} from '../http.js';
import { isEnoent, readAssetFile, removeAssetFiles, writeAssetFile } from './files.js';
import { readImageUpload } from './upload.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Query = Database | Tx;

const assetNotFound = { error: { code: 'not_found' as const, message: '没有找到' } };
const textNodeImage = invalidBody('这是文字点');

export function registerAssetRoutes(app: FastifyInstance, db: Database, session: SessionLookup) {
  app.post('/api/collections/:id/images', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());

    const parsed = await readImageUpload(request);
    if (!parsed.ok) return reply.code(400).send(invalidBody(parsed.message));
    const upload = parsed.upload;
    if (!(await activeCollection(db, user.id, params.data.id))) {
      return reply.code(404).send(collectionNotFound);
    }

    const assetId = randomUUID();
    await writeAssetFile(assetId, upload.bytes);
    let created: { id: string; name: string } | null;
    try {
      created = await db.transaction(async (tx) => {
        const collection = await activeCollection(tx, user.id, params.data.id);
        if (!collection) return null;
        const inserted = await tx
          .insert(nodes)
          .values({ userId: user.id, name: upload.name, kind: 'image' })
          .returning({ id: nodes.id, name: nodes.name });
        const node = inserted[0];
        if (!node) return null;
        const placed = upload.placement;
        await tx.insert(memberships).values({
          collectionId: collection.id,
          nodeId: node.id,
          ...(placed ? { x: placed.x, y: placed.y, z: await nextPlacementZ(tx, collection.id) } : {}),
        });
        await tx.insert(assets).values({
          id: assetId,
          userId: user.id,
          ownerKind: 'node',
          ownerId: node.id,
          mime: upload.mime,
          byteSize: upload.bytes.length,
        });
        return node;
      });
    } catch (error) {
      await removeAssetFiles([assetId]);
      throw error;
    }
    if (!created) {
      await removeAssetFiles([assetId]);
      return reply.code(404).send(collectionNotFound);
    }
    return reply.code(201).send(created);
  });

  app.put('/api/nodes/:id/image', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());

    const current = await ownedNode(db, user.id, params.data.id);
    if (!current) return reply.code(404).send(nodeNotFound);
    if (current.kind !== 'image') return reply.code(400).send(textNodeImage);

    const parsed = await readImageUpload(request);
    if (!parsed.ok) return reply.code(400).send(invalidBody(parsed.message));
    const upload = parsed.upload;

    // 新文件先落盘。换行失败只删新文件，旧图保持可读。
    const assetId = randomUUID();
    await writeAssetFile(assetId, upload.bytes);
    let oldIds: string[];
    try {
      const outcome = await db.transaction(async (tx) => {
        const node = await ownedNode(tx, user.id, params.data.id);
        if (!node) return 'missing' as const;
        if (node.kind !== 'image') return 'text' as const;
        const previous = await tx
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.userId, user.id), eq(assets.ownerKind, 'node'), eq(assets.ownerId, node.id)));
        if (previous.length > 0) {
          await tx
            .delete(assets)
            .where(and(eq(assets.userId, user.id), eq(assets.ownerKind, 'node'), eq(assets.ownerId, node.id)));
        }
        await tx.insert(assets).values({
          id: assetId,
          userId: user.id,
          ownerKind: 'node',
          ownerId: node.id,
          mime: upload.mime,
          byteSize: upload.bytes.length,
        });
        return previous.map((row) => row.id);
      });
      if (outcome === 'missing') {
        await removeAssetFiles([assetId]);
        return reply.code(404).send(nodeNotFound);
      }
      if (outcome === 'text') {
        await removeAssetFiles([assetId]);
        return reply.code(400).send(textNodeImage);
      }
      oldIds = outcome;
    } catch (error) {
      await removeAssetFiles([assetId]);
      throw error;
    }
    await removeAssetFiles(oldIds);
    return reply.code(200).send({ id: assetId });
  });

  app.get('/api/assets/:id', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidBody());

    const rows = await db
      .select({ id: assets.id, mime: assets.mime })
      .from(assets)
      .where(and(eq(assets.id, params.data.id), eq(assets.userId, user.id)))
      .limit(1);
    const row = rows[0];
    if (!row) return reply.code(404).send(assetNotFound);

    let bytes: Buffer;
    try {
      bytes = await readAssetFile(row.id);
    } catch (error) {
      if (isEnoent(error)) return reply.code(404).send(assetNotFound);
      throw error;
    }
    return reply
      .code(200)
      .header('Content-Type', row.mime)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', 'inline')
      .send(bytes);
  });
}

async function ownedNode(db: Query, userId: string, id: string) {
  const rows = await db
    .select({ id: nodes.id, kind: nodes.kind })
    .from(nodes)
    .where(and(eq(nodes.id, id), eq(nodes.userId, userId), isNull(nodes.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/** 合集里还没有 z 时从 1 起。 */
async function nextPlacementZ(db: Tx, collectionId: string): Promise<number> {
  const rows = await db
    .select({ value: max(memberships.z) })
    .from(memberships)
    .where(eq(memberships.collectionId, collectionId));
  return nextZ(rows[0]?.value);
}

function nextZ(value: unknown): number {
  if (value == null) return 1;
  const current = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(current)) return 1;
  return Math.trunc(current) + 1;
}
