import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { loginBodySchema, todayResponseSchema } from '@unfold/dto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import argon2 from 'argon2';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { loadConfig } from './config.js';
import { createDb, createPool } from './db/client.js';
import { blockIndex, documents, domains, knowledgeObjects, suggestions, users } from './db/schema.js';
import { registerChainRoutes } from './chain.js';
import { registerCollectionRefRoutes } from './collection-refs.js';
import { registerCollectionRoutes } from './collections.js';
import { registerDocumentRoutes } from './documents.js';
import { registerExportRoutes } from './export.js';
import { registerImportRoutes } from './import.js';
import { registerObjectRoutes } from './objects.js';
import { registerRelationRoutes } from './relations.js';
import { registerSearchRoutes } from './search.js';
import { registerSuggestionRoutes } from './suggestions.js';
import { registerUndoRoutes } from './undo.js';
import { registerCapabilityRoutes } from './capabilities.js';
import { registerEvidenceRoutes } from './evidence.js';

const invalidCredentials = {
  error: { code: 'invalid_credentials', message: '用户名或密码不正确' },
};

const unauthenticated = {
  error: { code: 'unauthenticated', message: '未登录' },
};

const databaseUnavailable = {
  error: { code: 'database_unavailable', message: '数据库暂时不可用' },
};

export async function buildApp() {
  const config = loadConfig();
  const pool = createPool();
  const db = createDb(pool);
  const app = Fastify({ logger: false });

  app.addHook('onClose', async () => {
    await pool.end();
  });

  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(rateLimit, { global: false });

  const cookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.isProduction,
    signed: true,
  };

  async function signedSessionUser(request: FastifyRequest, reply: FastifyReply) {
    const raw = request.cookies.unfold_session;
    if (!raw) {
      await reply.code(401).send(unauthenticated);
      return;
    }

    const unsigned = reply.unsignCookie(raw);
    if (unsigned.valid !== true || !unsigned.value) {
      await reply.code(401).send(unauthenticated);
      return;
    }

    const found = await db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(and(eq(users.id, unsigned.value), isNull(users.deletedAt)))
      .limit(1);

    const user = found[0];
    if (!user) {
      await reply.code(401).send(unauthenticated);
      return;
    }

    return user;
  }

  app.post(
    '/api/login',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
          errorResponseBuilder: () => ({
            error: { code: 'rate_limited', message: '登录尝试过于频繁' },
          }),
        },
      },
    },
    async (request, reply) => {
      const parsed = loginBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: 'invalid_body', message: '请求格式不正确' },
        });
      }

      const found = await db
        .select({
          id: users.id,
          username: users.username,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(and(eq(users.username, parsed.data.username), isNull(users.deletedAt)))
        .limit(1);

      const user = found[0];
      if (!user) {
        return reply.code(401).send(invalidCredentials);
      }

      try {
        const matches = await argon2.verify(user.passwordHash, parsed.data.password);
        if (!matches) {
          return reply.code(401).send(invalidCredentials);
        }
      } catch {
        return reply.code(401).send(invalidCredentials);
      }

      reply.setCookie('unfold_session', user.id, cookieOptions);
      return reply.code(200).send({ username: user.username });
    },
  );

  app.post('/api/logout', async (_request, reply) => {
    reply.clearCookie('unfold_session', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
    });
    return reply.code(204).send();
  });

  app.get('/api/me', async (request, reply) => {
    const user = await signedSessionUser(request, reply);
    if (!user) return;

    return reply.code(200).send({ username: user.username });
  });

  app.get('/api/today', async (request, reply) => {
    const user = await signedSessionUser(request, reply);
    if (!user) return;

    try {
      const result = await db.execute<{ name: string }>(sql`select current_database() as name`);
      if (result.rows.length === 0) {
        return reply.code(500).send(databaseUnavailable);
      }
      const counted = await db.execute<{ count: string }>(sql`
        select count(*)::text as count
        from knowledge_objects o
        where o.user_id = ${user.id}
          and o.status = 'active'
          and o.deleted_at is null
          and not exists (
            select 1
            from block_index b
            join documents doc on doc.id = b.document_id
            where b.block_type = 'object_ref'
              and b.text_preview = o.id::text
              and b.deleted_at is null
              and doc.deleted_at is null
              and doc.user_id = o.user_id
              and doc.owner_type = 'collection'
          )
      `);
      const freeCount = Number(counted.rows[0]?.count ?? 0);
      if (!Number.isInteger(freeCount) || freeCount < 0) {
        return reply.code(500).send(databaseUnavailable);
      }

      const focusRows = await db
        .select({
          id: knowledgeObjects.id,
          canonicalName: knowledgeObjects.canonicalName,
          coreStatement: knowledgeObjects.coreStatement,
          domainName: domains.name,
          type: knowledgeObjects.type,
        })
        .from(knowledgeObjects)
        .innerJoin(documents, eq(documents.id, knowledgeObjects.documentId))
        .innerJoin(domains, eq(domains.id, knowledgeObjects.domainId))
        .where(
          and(
            eq(knowledgeObjects.userId, user.id),
            eq(knowledgeObjects.status, 'active'),
            isNull(knowledgeObjects.deletedAt),
            isNull(documents.deletedAt),
            isNull(domains.deletedAt),
          ),
        )
        .orderBy(desc(documents.updatedAt), desc(knowledgeObjects.id))
        .limit(1);

      const pendingRows = await db
        .select({ count: sql<string>`count(*)::text` })
        .from(suggestions)
        .where(
          and(
            eq(suggestions.userId, user.id),
            isNull(suggestions.deletedAt),
            inArray(suggestions.status, ['pending', 'deferred']),
          ),
        );
      const pendingSuggestions = Number(pendingRows[0]?.count ?? 0);
      if (!Number.isInteger(pendingSuggestions) || pendingSuggestions < 0) {
        return reply.code(500).send(databaseUnavailable);
      }

      const openQuestions = await db
        .select({
          blockId: blockIndex.blockId,
          text: blockIndex.textPreview,
          objectId: knowledgeObjects.id,
          objectName: knowledgeObjects.canonicalName,
        })
        .from(blockIndex)
        .innerJoin(documents, eq(documents.id, blockIndex.documentId))
        .innerJoin(knowledgeObjects, eq(knowledgeObjects.id, documents.ownerId))
        .where(
          and(
            eq(blockIndex.blockType, 'question'),
            isNull(blockIndex.deletedAt),
            isNull(documents.deletedAt),
            eq(documents.ownerType, 'object'),
            eq(knowledgeObjects.userId, user.id),
            eq(knowledgeObjects.status, 'active'),
            isNull(knowledgeObjects.deletedAt),
          ),
        )
        .orderBy(desc(documents.updatedAt), asc(blockIndex.position));

      return todayResponseSchema.parse({
        focus: focusRows[0] ?? null,
        due: [],
        freeCount,
        pendingSuggestions,
        openQuestions,
      });
    } catch {
      return reply.code(500).send(databaseUnavailable);
    }
  });

  app.get('/health', async () => ({ ok: true }));

  registerObjectRoutes(app, db, signedSessionUser);
  registerDocumentRoutes(app, db, signedSessionUser);
  registerRelationRoutes(app, db, signedSessionUser);
  registerChainRoutes(app, db, signedSessionUser);
  registerSearchRoutes(app, db, signedSessionUser);
  registerCollectionRoutes(app, db, signedSessionUser);
  registerCollectionRefRoutes(app, db, signedSessionUser);
  registerUndoRoutes(app, db, signedSessionUser);
  registerSuggestionRoutes(app, db, signedSessionUser);
  registerExportRoutes(app, db, signedSessionUser);
  registerImportRoutes(app, db, signedSessionUser);
  registerCapabilityRoutes(app, db, signedSessionUser);
  registerEvidenceRoutes(app, db, signedSessionUser);

  return app;
}
