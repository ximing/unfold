import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

function joinKey(...parts: string[]): string {
  return parts.join('_');
}

const leftoverEnv: Record<string, string> = {
  [joinKey('MEILI', 'URL')]: 'http://127.0.0.1:7700',
  [joinKey('QDRANT', 'URL')]: 'http://127.0.0.1:6333',
  [joinKey('DASHSCOPE', 'API', 'KEY')]: 'sk-test',
  [joinKey('UNFOLD', 'INDEX')]: 'on',
  [joinKey('UNFOLD', 'SUGGEST', 'MODEL')]: 'qwen-plus',
};

const sentinelEnv = {
  DATABASE_URL: 'postgres://unfold:unfold@127.0.0.1:5432/unfold',
  SESSION_SECRET: 'test-session-secret',
  UNFOLD_ENV: 'development',
  ASSET_DIR: '/tmp/unfold-asset-sentinel',
  ATTACHMENT_S3_BUCKET: 'sentinel-bucket',
  ATTACHMENT_S3_ACCESS_KEY_ID: 'sentinel-access',
  ATTACHMENT_S3_SECRET_ACCESS_KEY: 'sentinel-secret',
  ATTACHMENT_S3_REGION: 'cn-north-1',
  ATTACHMENT_S3_ENDPOINT: 'https://s3.example.test',
  ATTACHMENT_S3_IS_PUBLIC: 'false',
  ATTACHMENT_S3_FORCE_PATH_STYLE: 'true',
} as const;

const mutatedKeys = [...Object.keys(leftoverEnv), ...Object.keys(sentinelEnv)];

const leftoverNames = [
  joinKey('MEILI', ''),
  joinKey('QDRANT', ''),
  joinKey('DASHSCOPE', ''),
  joinKey('EMBEDDING', ''),
  joinKey('RERANK', ''),
  joinKey('UNFOLD', 'SUGGEST', 'MODEL'),
  joinKey('UNFOLD', 'INDEX'),
  joinKey('DATABASE', 'URL', 'PROD'),
];

const currentExampleNames = [
  'DATABASE_URL',
  'SESSION_SECRET',
  'UNFOLD_ENV',
  'SEED_USERNAME',
  'SEED_PASSWORD',
  'ASSET_DIR',
  'ATTACHMENT_S3_BUCKET',
  'ATTACHMENT_S3_ACCESS_KEY_ID',
  'ATTACHMENT_S3_SECRET_ACCESS_KEY',
  'ATTACHMENT_S3_REGION',
  'ATTACHMENT_S3_ENDPOINT',
  'ATTACHMENT_S3_IS_PUBLIC',
  'ATTACHMENT_S3_FORCE_PATH_STYLE',
];

const retiredPackages = ['search', 'doc-schema', 'markdown'].map((name) => `@unfold/${name}`);

function readNearby(relativeFromSrc: string): string {
  return readFileSync(fileURLToPath(new URL(relativeFromSrc, import.meta.url)), 'utf8');
}

function packageDependencies(relativeFromSrc: string): Record<string, string> {
  const pkg = JSON.parse(readNearby(relativeFromSrc)) as {
    dependencies?: Record<string, string>;
  };
  return pkg.dependencies ?? {};
}

describe('loadConfig', () => {
  const snapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of mutatedKeys) {
      snapshot[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of mutatedKeys) {
      const value = snapshot[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('maps current env keys and ignores leftover retrieval keys', () => {
    Object.assign(process.env, sentinelEnv, leftoverEnv);

    const config = loadConfig();

    expect(Object.keys(config).sort()).toEqual(
      ['assetDir', 'databaseUrl', 'isProduction', 's3', 'sessionSecret', 'unfoldEnv'].sort(),
    );
    expect(Object.keys(config.s3).sort()).toEqual(
      [
        'accessKeyId',
        'bucket',
        'endpoint',
        'forcePathStyle',
        'isPublic',
        'region',
        'secretAccessKey',
      ].sort(),
    );
    expect(config.databaseUrl).toBe(sentinelEnv.DATABASE_URL);
    expect(config.sessionSecret).toBe(sentinelEnv.SESSION_SECRET);
    expect(config.unfoldEnv).toBe('development');
    expect(config.isProduction).toBe(false);
    expect(config.assetDir).toBe(path.resolve(sentinelEnv.ASSET_DIR));
    expect(config.s3.bucket).toBe(sentinelEnv.ATTACHMENT_S3_BUCKET);
    expect(config.s3.accessKeyId).toBe(sentinelEnv.ATTACHMENT_S3_ACCESS_KEY_ID);
    expect(config.s3.secretAccessKey).toBe(sentinelEnv.ATTACHMENT_S3_SECRET_ACCESS_KEY);
    expect(config.s3.region).toBe(sentinelEnv.ATTACHMENT_S3_REGION);
    expect(config.s3.endpoint).toBe(sentinelEnv.ATTACHMENT_S3_ENDPOINT);
    expect(config.s3.isPublic).toBe(false);
    expect(config.s3.forcePathStyle).toBe(true);

    const keyBlob = `${Object.keys(config).join('\n')}\n${Object.keys(config.s3).join('\n')}`;
    for (const name of leftoverNames) {
      expect(keyBlob).not.toContain(name);
    }
  });
});

describe('env files', () => {
  it('lists current variables and omits leftover retrieval names', () => {
    const example = readNearby('../.env.example');
    const vitestConfig = readNearby('../vitest.config.ts');

    for (const name of currentExampleNames) {
      expect(example).toContain(name);
    }
    for (const name of leftoverNames) {
      expect(example).not.toContain(name);
      expect(vitestConfig).not.toContain(name);
    }
  });
});

describe('workspace runtime dependencies', () => {
  it('does not depend on retired experimental packages', () => {
    const webDeps = packageDependencies('../../web/package.json');
    const serverDeps = packageDependencies('../package.json');

    expect(webDeps).toHaveProperty('@unfold/dto');
    expect(serverDeps).toHaveProperty('@unfold/dto');
    for (const name of retiredPackages) {
      expect(webDeps).not.toHaveProperty(name);
      expect(serverDeps).not.toHaveProperty(name);
    }
  });
});
