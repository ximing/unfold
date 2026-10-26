import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 未设置 ASSET_DIR 时用 apps/server/data/assets，按本文件位置解析，不看进程 cwd。 */
function defaultAssetDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../data/assets');
}

export function loadConfig() {
  const databaseUrl = process.env.DATABASE_URL;
  const sessionSecret = process.env.SESSION_SECRET;
  const unfoldEnv = process.env.UNFOLD_ENV;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  if (!sessionSecret) throw new Error('SESSION_SECRET is not set');
  if (!unfoldEnv) throw new Error('UNFOLD_ENV is not set');
  const configured = process.env.ASSET_DIR?.trim();
  const assetDir = configured ? path.resolve(configured) : defaultAssetDir();
  const s3Bucket = process.env.ATTACHMENT_S3_BUCKET;
  const s3AccessKeyId = process.env.ATTACHMENT_S3_ACCESS_KEY_ID;
  const s3SecretAccessKey = process.env.ATTACHMENT_S3_SECRET_ACCESS_KEY;
  const s3Region = process.env.ATTACHMENT_S3_REGION;
  if (!s3Bucket) throw new Error('ATTACHMENT_S3_BUCKET is not set');
  if (!s3AccessKeyId) throw new Error('ATTACHMENT_S3_ACCESS_KEY_ID is not set');
  if (!s3SecretAccessKey) throw new Error('ATTACHMENT_S3_SECRET_ACCESS_KEY is not set');
  if (!s3Region) throw new Error('ATTACHMENT_S3_REGION is not set');
  const s3Endpoint = process.env.ATTACHMENT_S3_ENDPOINT?.trim() || undefined;
  return {
    databaseUrl,
    sessionSecret,
    unfoldEnv,
    isProduction: unfoldEnv === 'production',
    assetDir,
    s3: {
      bucket: s3Bucket,
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey,
      region: s3Region,
      endpoint: s3Endpoint,
      isPublic: process.env.ATTACHMENT_S3_IS_PUBLIC === 'true',
      forcePathStyle: process.env.ATTACHMENT_S3_FORCE_PATH_STYLE === 'true',
    },
  };
}
