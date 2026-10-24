export function loadConfig() {
  const databaseUrl = process.env.DATABASE_URL;
  const sessionSecret = process.env.SESSION_SECRET;
  const unfoldEnv = process.env.UNFOLD_ENV;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  if (!sessionSecret) throw new Error('SESSION_SECRET is not set');
  if (!unfoldEnv) throw new Error('UNFOLD_ENV is not set');
  return { databaseUrl, sessionSecret, unfoldEnv, isProduction: unfoldEnv === 'production' };
}
