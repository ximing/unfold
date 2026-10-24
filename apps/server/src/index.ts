import { pathToFileURL } from 'node:url';
import { buildApp } from './app.js';

const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  const app = await buildApp();
  try {
    await app.listen({ port: 3000, host: '127.0.0.1' });
  } catch {
    process.stderr.write('listen failed\n');
    process.exit(1);
  }
}
