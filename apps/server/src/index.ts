import { pathToFileURL } from 'node:url';
import { buildApp } from './app.js';

function listenTarget(): { port: number; host: string } | undefined {
  const port = Number(process.env.PORT ?? '3000');
  const host = (process.env.HOST ?? '127.0.0.1').trim();
  if (!Number.isInteger(port) || port < 1 || port > 65535 || host === '') return undefined;
  return { port, host };
}

const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  const target = listenTarget();
  if (!target) {
    process.stderr.write('listen failed\n');
    process.exit(1);
  }
  const app = await buildApp();
  try {
    await app.listen(target);
  } catch {
    process.stderr.write('listen failed\n');
    process.exit(1);
  }
}
