import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

const notFound = { error: { code: 'not_found' as const, message: '没有找到' } };

/** 生产环境才托管页面。目录按本文件位置解析，不看进程 cwd。 */
export function resolveWebDistRoot(isProduction: boolean, serverFileDir: string): string | null {
  if (!isProduction) return null;
  const dist = path.resolve(serverFileDir, '../../web/dist');
  return existsSync(path.join(dist, 'index.html')) ? dist : null;
}

export function isSpaFallback(method: string, url: string): boolean {
  if (method !== 'GET') return false;
  const pathOnly = url.split('?')[0] ?? url;
  if (pathOnly === '/api' || pathOnly.startsWith('/api/')) return false;
  if (pathOnly === '/health') return false;
  return true;
}

function cacheControl(filePath: string): string | undefined {
  if (filePath.includes(`${path.sep}assets${path.sep}`)) {
    return 'public, max-age=31536000, immutable';
  }
  if (filePath.endsWith(`${path.sep}index.html`)) return 'no-cache';
  return undefined;
}

export async function registerWebStatic(
  app: FastifyInstance,
  isProduction: boolean,
  serverFileDir = path.dirname(fileURLToPath(import.meta.url)),
): Promise<void> {
  const dist = resolveWebDistRoot(isProduction, serverFileDir);
  if (!dist) return;

  await app.register(fastifyStatic, {
    root: dist,
    prefix: '/',
    wildcard: true,
    setHeaders: (reply, filePath) => {
      const value = cacheControl(filePath);
      if (value) void reply.header('Cache-Control', value);
    },
  });

  app.setNotFoundHandler((request, reply) => {
    if (isSpaFallback(request.method, request.url)) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send(notFound);
  });
}
