import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { isSpaFallback, registerWebStatic, resolveWebDistRoot } from './web-static.js';

describe('resolveWebDistRoot', () => {
  it('skips when not production', () => {
    expect(resolveWebDistRoot(false, '/any/apps/server/src')).toBeNull();
  });

  it('skips when index.html is missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'unfold-web-'));
    const serverFileDir = path.join(root, 'apps', 'server', 'src');
    await mkdir(serverFileDir, { recursive: true });
    expect(resolveWebDistRoot(true, serverFileDir)).toBeNull();
    await rm(root, { recursive: true, force: true });
  });
});

describe('isSpaFallback', () => {
  it('keeps api and health off the page', () => {
    expect(isSpaFallback('GET', '/library')).toBe(true);
    expect(isSpaFallback('GET', '/c/abc?x=1')).toBe(true);
    expect(isSpaFallback('GET', '/api/nodes')).toBe(false);
    expect(isSpaFallback('GET', '/api')).toBe(false);
    expect(isSpaFallback('GET', '/health')).toBe(false);
    expect(isSpaFallback('POST', '/library')).toBe(false);
  });
});

describe('registerWebStatic', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function distFixture(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'unfold-web-'));
    roots.push(root);
    const serverFileDir = path.join(root, 'apps', 'server', 'src');
    const dist = path.join(root, 'apps', 'web', 'dist');
    await mkdir(path.join(dist, 'assets'), { recursive: true });
    await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>Unfold</title>');
    await writeFile(path.join(dist, 'assets', 'app.js'), 'console.log(1)');
    return serverFileDir;
  }

  it('serves the page and leaves api routes alone', async () => {
    const serverFileDir = await distFixture();
    const app = Fastify();
    app.get('/health', async () => ({ ok: true }));
    app.get('/api/me', async () => ({ username: 'a' }));
    await registerWebStatic(app, true, serverFileDir);

    const home = await app.inject({ method: 'GET', url: '/' });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('Unfold');
    expect(home.headers['cache-control']).toBe('no-cache');

    const spa = await app.inject({ method: 'GET', url: '/library' });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain('Unfold');

    const asset = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    const me = await app.inject({ method: 'GET', url: '/api/me' });
    expect(me.json()).toEqual({ username: 'a' });

    const missing = await app.inject({ method: 'GET', url: '/api/missing' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: { code: 'not_found', message: '没有找到' } });

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.json()).toEqual({ ok: true });

    await app.close();
  });

  it('does not serve the page outside production', async () => {
    const serverFileDir = await distFixture();
    const app = Fastify();
    await registerWebStatic(app, false, serverFileDir);
    const home = await app.inject({ method: 'GET', url: '/' });
    expect(home.statusCode).toBe(404);
    await app.close();
  });
});
