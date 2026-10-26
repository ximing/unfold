import { usernameBodySchema } from '@unfold/dto';
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { users } from '../db/schema.js';
import type { Database } from '../graph/db.js';
import {
  bodyMessage,
  invalidBody,
  isUniqueViolation,
  usernameTaken,
  type SessionLookup,
  type SessionUser,
} from '../http.js';
import { avatarKey, type AvatarStore } from './store.js';
import { readAvatarUpload } from './upload.js';

/** 登录、注册、/api/me 与改名共用的账号响应：头像地址每次现签。 */
export async function accountBody(user: SessionUser, store: AvatarStore) {
  return { username: user.username, avatarUrl: user.avatarKey ? await store.url(user.avatarKey) : null };
}

export function registerAvatarRoutes(
  app: FastifyInstance,
  db: Database,
  session: SessionLookup,
  store: AvatarStore,
) {
  app.patch('/api/me/username', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const parsed = usernameBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidBody(bodyMessage(parsed.error)));
    const username = parsed.data.username;

    if (username !== user.username) {
      const taken = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.username, username), isNull(users.deletedAt), ne(users.id, user.id)))
        .limit(1);
      if (taken[0]) return reply.code(409).send(usernameTaken);
      try {
        await db.update(users).set({ username, updatedAt: new Date() }).where(eq(users.id, user.id));
      } catch (error) {
        if (isUniqueViolation(error)) return reply.code(409).send(usernameTaken);
        throw error;
      }
    }

    return reply.code(200).send(await accountBody({ ...user, username }, store));
  });

  app.put('/api/me/avatar', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    const parsed = await readAvatarUpload(request);
    if (!parsed.ok) return reply.code(400).send(invalidBody(parsed.message));

    // 新对象先落桶，再换 users.avatar_key，最后删旧对象。
    const key = avatarKey(user.id, parsed.upload.mime);
    await store.put(key, parsed.upload.bytes, parsed.upload.mime);
    try {
      await db.update(users).set({ avatarKey: key, updatedAt: new Date() }).where(eq(users.id, user.id));
    } catch (error) {
      await store.remove(key).catch(() => undefined);
      throw error;
    }
    if (user.avatarKey && user.avatarKey !== key) {
      await store.remove(user.avatarKey).catch(() => undefined);
    }
    return reply.code(200).send({ avatarUrl: await store.url(key) });
  });

  app.delete('/api/me/avatar', async (request, reply) => {
    const user = await session(request, reply);
    if (!user) return;

    await db.update(users).set({ avatarKey: null, updatedAt: new Date() }).where(eq(users.id, user.id));
    if (user.avatarKey) await store.remove(user.avatarKey).catch(() => undefined);
    return reply.code(204).send();
  });
}
