import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { loginBodySchema } from '@unfold/dto';
import { and, eq, isNull } from 'drizzle-orm';
import argon2 from 'argon2';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { registerCardRoutes } from './cards/routes.js';
import { registerCollectionRoutes } from './collections/routes.js';
import { loadConfig } from './config.js';
import { createDb, createPool } from './db/client.js';
import { users } from './db/schema.js';
import { registerEdgeRoutes } from './edges/routes.js';
import type { SessionUser } from './http.js';
import { registerNodeRoutes } from './nodes/routes.js';
import { registerSearchRoutes } from './search/routes.js';

const invalidCredentials = {
  error: { code: 'invalid_credentials', message: '用户名或密码不正确' },
};

const unauthenticated = {
  error: { code: 'unauthenticated', message: '未登录' },
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

  app.get('/health', async () => ({ ok: true }));

  registerCollectionRoutes(app, db, signedSessionUser);
  registerNodeRoutes(app, db, signedSessionUser);
  registerEdgeRoutes(app, db, signedSessionUser);
  registerCardRoutes(app, db, signedSessionUser);
  registerSearchRoutes(app, db, signedSessionUser);

  return app;
}
