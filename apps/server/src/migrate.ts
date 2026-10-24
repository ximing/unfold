import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, createPool } from './db/client.js';

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

const pool = createPool();

try {
  const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
  await migrate(createDb(pool), { migrationsFolder });
  process.stdout.write('migrated\n');
} catch (error) {
  const message = error instanceof Error ? error.message : 'migration failed';
  process.stderr.write(`${redact(message)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
