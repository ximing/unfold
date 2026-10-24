import * as argon2 from 'argon2';
import { and, eq, isNull } from 'drizzle-orm';
import { createDb, createPool } from './db/client.js';
import { users } from './db/schema.js';

function redact(message: string): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return message;
  }
  let safe = message.split(url).join('DATABASE_URL');
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      safe = safe.split(decodeURIComponent(parsed.password)).join('***');
    }
  } catch {
    return safe;
  }
  return safe;
}

function requiredEnv(name: 'SEED_USERNAME' | 'SEED_PASSWORD'): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`${name} is not set\n`);
    process.exit(1);
  }
  return value;
}

const username = requiredEnv('SEED_USERNAME');
const password = requiredEnv('SEED_PASSWORD');

const pool = createPool();

try {
  const db = createDb(pool);
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.username, username), isNull(users.deletedAt)))
    .limit(1);

  if (existing.length > 0) {
    process.stdout.write('seed exists\n');
  } else {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await db.insert(users).values({ username, passwordHash });
    process.stdout.write('seeded\n');
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'seed failed';
  process.stderr.write(`${redact(message)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
