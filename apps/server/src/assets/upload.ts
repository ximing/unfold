import type { FastifyRequest } from 'fastify';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const imageFormatMessage = '只能放入 JPEG、PNG、WebP 或 GIF';
export const imageSizeMessage = '图片不能超过 10 MB';

const allowedMime = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const multipartRejectCodes = new Set([
  'FST_PARTS_LIMIT',
  'FST_FILES_LIMIT',
  'FST_FIELDS_LIMIT',
  'FST_PROTO_VIOLATION',
  'FST_INVALID_MULTIPART_CONTENT_TYPE',
  'FST_INVALID_JSON_FIELD_ERROR',
  'FST_MP_PREMATURE_CLOSE',
]);

export type ImageUpload = {
  name: string;
  mime: string;
  bytes: Buffer;
  placement?: { x: number; y: number };
};

type UploadResult = { ok: true; upload: ImageUpload } | { ok: false; message: string };

type FilePart = {
  type: 'file';
  fieldname: string;
  filename: string;
  mimetype: string;
  toBuffer: () => Promise<Buffer>;
  file: { truncated: boolean };
};

export function imageNodeName(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const stem = (dot >= 0 ? base.slice(0, dot) : base).trim();
  const name = stem === '' ? '图片' : stem;
  return Array.from(name).slice(0, 80).join('');
}

export async function readImageUpload(request: FastifyRequest): Promise<UploadResult> {
  if (!request.isMultipart()) return { ok: false, message: imageFormatMessage };

  let sawFile = false;
  let mime: string | null = null;
  let filename = '';
  let bytes: Buffer | null = null;
  let oversize = false;
  let xText: string | undefined;
  let yText: string | undefined;

  try {
    for await (const part of request.parts({
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 8, parts: 12, fieldSize: 1024 },
    })) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file' || sawFile) {
          await discardFile(part);
          continue;
        }
        sawFile = true;
        filename = part.filename;
        mime = canonicalMime(part.mimetype);
        const read = await bufferFile(part);
        if (read === 'too-large') oversize = true;
        else bytes = read;
        continue;
      }
      if (part.fieldname === 'x' && xText === undefined && typeof part.value === 'string') xText = part.value;
      if (part.fieldname === 'y' && yText === undefined && typeof part.value === 'string') yText = part.value;
    }
  } catch (error) {
    if (isFileTooLarge(error)) oversize = true;
    else if (isMultipartReject(error)) return { ok: false, message: imageFormatMessage };
    else throw error;
  }

  if (!sawFile || mime === null) return { ok: false, message: imageFormatMessage };
  if (oversize) return { ok: false, message: imageSizeMessage };
  if (!bytes || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    return { ok: false, message: bytes && bytes.length > MAX_IMAGE_BYTES ? imageSizeMessage : imageFormatMessage };
  }

  const placement = finitePlacement(xText, yText);
  return {
    ok: true,
    upload: { name: imageNodeName(filename), mime, bytes, ...(placement ? { placement } : {}) },
  };
}

function canonicalMime(raw: string): string | null {
  const mime = raw.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return allowedMime.has(mime) ? mime : null;
}

async function bufferFile(part: FilePart): Promise<Buffer | 'too-large'> {
  try {
    const bytes = await part.toBuffer();
    if (part.file.truncated || bytes.length > MAX_IMAGE_BYTES) return 'too-large';
    return bytes;
  } catch (error) {
    if (isFileTooLarge(error)) return 'too-large';
    throw error;
  }
}

async function discardFile(part: FilePart): Promise<void> {
  try {
    await part.toBuffer();
  } catch (error) {
    if (isFileTooLarge(error)) return;
    throw error;
  }
}

function finitePlacement(
  xText: string | undefined,
  yText: string | undefined,
): { x: number; y: number } | undefined {
  const x = finiteCoordinate(xText);
  const y = finiteCoordinate(yText);
  if (x === undefined || y === undefined) return undefined;
  return { x, y };
}

function finiteCoordinate(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const text = value.trim();
  if (text === '') return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function isFileTooLarge(error: unknown): boolean {
  return errorCode(error) === 'FST_REQ_FILE_TOO_LARGE';
}

function isMultipartReject(error: unknown): boolean {
  const code = errorCode(error);
  return code !== undefined && multipartRejectCodes.has(code);
}
