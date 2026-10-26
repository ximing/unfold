import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { loadConfig } from '../config.js';

type S3Config = ReturnType<typeof loadConfig>['s3'];

export type AvatarStore = {
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** 私有桶每次现签一个临时地址；公开桶直接拼地址。 */
  url(key: string): Promise<string>;
};

export const AVATAR_URL_TTL_SECONDS = 3600;

const extByMime: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export function avatarKey(userId: string, mime: string): string {
  return `avatars/${userId}/${randomUUID()}.${extByMime[mime] ?? 'bin'}`;
}

export function createS3AvatarStore(config: S3Config): AvatarStore {
  const client = new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });

  function publicUrl(key: string): string {
    if (config.endpoint) {
      return `${config.endpoint.replace(/\/+$/, '')}/${config.bucket}/${key}`;
    }
    return `https://${config.bucket}.s3.${config.region}.amazonaws.com/${key}`;
  }

  return {
    async put(key, bytes, mime) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: bytes,
          ContentType: mime,
          CacheControl: 'private, max-age=31536000, immutable',
        }),
      );
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
    async url(key) {
      if (config.isPublic) return publicUrl(key);
      return getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
        expiresIn: AVATAR_URL_TTL_SECONDS,
      });
    },
  };
}
