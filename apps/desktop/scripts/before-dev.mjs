import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');

function portOpen(port, host) {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host }, () => {
      sock.end();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
  });
}

async function devPortOpen() {
  return (await portOpen(5173, '127.0.0.1')) || (await portOpen(5173, '::1'));
}

async function healthy() {
  try {
    const res = await globalThis.fetch('http://localhost:5173/', {
      signal: globalThis.AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

if (await devPortOpen()) {
  for (let i = 0; i < 60; i += 1) {
    if (await healthy()) process.exit(0);
    await delay(500);
  }
  process.stderr.write('port 5173 in use but Vite not healthy\n');
  process.exit(1);
}

const child = spawn('pnpm', ['--filter', '@unfold/web', 'dev'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
