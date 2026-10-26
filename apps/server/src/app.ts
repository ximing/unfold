import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { loginBodySchema, registerBodySchema } from '@unfold/dto';
import { and, eq, isNull } from 'drizzle-orm';
import argon2 from 'argon2';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { registerAssetRoutes } from './assets/routes.js';
import { MAX_IMAGE_BYTES } from './assets/upload.js';
import { accountBody, registerAvatarRoutes } from './avatar/routes.js';
import { createS3AvatarStore, type AvatarStore } from './avatar/store.js';
import { registerCardRoutes } from './cards/routes.js';
import { registerCollectionRoutes } from './collections/routes.js';
import { loadConfig } from './config.js';
import { createDb, createPool } from './db/client.js';
import { users } from './db/schema.js';
import { registerEdgeRoutes } from './edges/routes.js';
import {
  bodyMessage,
  invalidBody,
  isUniqueViolation,
  usernameTaken,
  type SessionUser,
} from './http.js';
import { registerNodeRoutes } from './nodes/routes.js';
import { registerSearchRoutes } from './search/routes.js';
import { registerLive } from './sync/routes.js';
import { registerWebStatic } from './web-static.js';

const invalidCredentials = {
  error: { code: 'invalid_credentials', message: '用户名或密码不正确' },
};

const unauthenticated = {
  error: { code: 'unauthenticated', message: '未登录' },
};

/** WebView 会在进程退出时丢掉没有过期时间的会话 Cookie。400 天是 Chromium 上限。 */
const SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export type AppOverrides = { avatarStore?: AvatarStore };

export async function buildApp(overrides?: AppOverrides) {
  const config = loadConfig();
  const pool = createPool();
  const db = createDb(pool);
  const avatarStore = overrides?.avatarStore ?? createS3AvatarStore(config.s3);
  const app = Fastify({ logger: false });

  app.addHook('onClose', async () => {
    await pool.end();
  });

  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: {
      fieldSize: 1024,
      fields: 8,
      fileSize: MAX_IMAGE_BYTES,
      files: 1,
      parts: 12,
    },
  });

  const cookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.isProduction,
    signed: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
  };

  async function signedSessionUser(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<SessionUser | undefined> {
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
      .select({ id: users.id, username: users.username, avatarKey: users.avatarKey })
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
          avatarKey: users.avatarKey,
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
      return reply.code(200).send(await accountBody(user, avatarStore));
    },
  );

  app.post(
    '/api/register',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
          errorResponseBuilder: () => ({
            error: { code: 'rate_limited', message: '注册尝试过于频繁' },
          }),
        },
      },
    },
    async (request, reply) => {
      const parsed = registerBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(invalidBody(bodyMessage(parsed.error)));
      }

      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.username, parsed.data.username), isNull(users.deletedAt)))
        .limit(1);
      if (existing[0]) {
        return reply.code(409).send(usernameTaken);
      }

      const passwordHash = await argon2.hash(parsed.data.password, { type: argon2.argon2id });
      let created: { id: string; username: string };
      try {
        const inserted = await db
          .insert(users)
          .values({ username: parsed.data.username, passwordHash })
          .returning({ id: users.id, username: users.username });
        const row = inserted[0];
        if (!row) throw new Error('register failed');
        created = row;
      } catch (error) {
        if (isUniqueViolation(error)) {
          return reply.code(409).send(usernameTaken);
        }
        throw error;
      }

      reply.setCookie('unfold_session', created.id, cookieOptions);
      return reply.code(201).send({ username: created.username, avatarUrl: null });
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

    return reply.code(200).send(await accountBody(user, avatarStore));
  });

  app.get('/health', async () => ({ ok: true }));

  registerAvatarRoutes(app, db, signedSessionUser, avatarStore);

  registerAssetRoutes(app, db, signedSessionUser);
  registerCollectionRoutes(app, db, signedSessionUser);
  registerNodeRoutes(app, db, signedSessionUser);
  registerEdgeRoutes(app, db, signedSessionUser);
  registerCardRoutes(app, db, signedSessionUser);
  registerSearchRoutes(app, db, signedSessionUser);
  await registerLive(app);

  await registerWebStatic(app, config.isProduction);

  return app;
}
