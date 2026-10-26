import type { FastifyRequest } from 'fastify';

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export const avatarFormatMessage = '头像只能是 JPEG、PNG、WebP 或 GIF';
export const avatarSizeMessage = '头像不能超过 5 MB';

const allowedMime = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export type AvatarUpload = { mime: string; bytes: Buffer };

type UploadResult = { ok: true; upload: AvatarUpload } | { ok: false; message: string };

export async function readAvatarUpload(request: FastifyRequest): Promise<UploadResult> {
  if (!request.isMultipart()) return { ok: false, message: avatarFormatMessage };

  let bytes: Buffer | null = null;
  let mime: string | null = null;
  let sawFile = false;
  let oversize = false;

  try {
    for await (const part of request.parts({
      limits: { fileSize: MAX_AVATAR_BYTES, files: 1, fields: 0, parts: 4, fieldSize: 1024 },
    })) {
      if (part.type !== 'file') continue;
      if (sawFile) {
        await discardFile(part);
        continue;
      }
      sawFile = true;
      mime = canonicalMime(part.mimetype);
      try {
        const read = await part.toBuffer();
        if (part.file.truncated || read.length > MAX_AVATAR_BYTES) oversize = true;
        else bytes = read;
      } catch (error) {
        if (isFileTooLarge(error)) oversize = true;
        else throw error;
      }
    }
  } catch (error) {
    if (isFileTooLarge(error)) oversize = true;
    else if (isMultipartError(error)) return { ok: false, message: avatarFormatMessage };
    else throw error;
  }

  if (!sawFile || mime === null || !bytes || bytes.length === 0) {
    return { ok: false, message: oversize ? avatarSizeMessage : avatarFormatMessage };
  }
  if (oversize) return { ok: false, message: avatarSizeMessage };
  return { ok: true, upload: { mime, bytes } };
}

function canonicalMime(raw: string): string | null {
  const mime = raw.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return allowedMime.has(mime) ? mime : null;
}

async function discardFile(part: { toBuffer(): Promise<Buffer> }): Promise<void> {
  try {
    await part.toBuffer();
  } catch (error) {
    if (isFileTooLarge(error)) return;
    throw error;
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

function isFileTooLarge(error: unknown): boolean {
  return errorCode(error) === 'FST_REQ_FILE_TOO_LARGE';
}

function isMultipartError(error: unknown): boolean {
  return errorCode(error)?.startsWith('FST_') === true;
}
