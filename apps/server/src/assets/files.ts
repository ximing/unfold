import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config.js';

const assetIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assetFilePath(id: string): string {
  if (!assetIdPattern.test(id)) throw new Error('invalid asset id');
  const root = path.resolve(loadConfig().assetDir);
  const full = path.join(root, id);
  if (path.dirname(full) !== root) throw new Error('invalid asset id');
  return full;
}

export async function writeAssetFile(id: string, bytes: Buffer): Promise<void> {
  const finalPath = assetFilePath(id);
  const root = path.dirname(finalPath);
  await mkdir(root, { recursive: true });
  const tmpPath = path.join(root, `${id}.tmp`);
  try {
    await writeFile(tmpPath, bytes);
    await rename(tmpPath, finalPath);
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
}

export async function readAssetFile(id: string): Promise<Buffer> {
  return readFile(assetFilePath(id));
}

export async function removeAssetFiles(ids: readonly string[]): Promise<void> {
  let failure: unknown;
  for (const id of ids) {
    try {
      await unlink(assetFilePath(id));
    } catch (error) {
      if (!isEnoent(error)) failure ??= error;
    }
  }
  if (failure !== undefined) throw failure;
}

export function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
