import type { CanvasPrefs } from '@unfold/dto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

export type SessionUser = {
  id: string;
  username: string;
  avatarKey: string | null;
  canvas: CanvasPrefs;
};

export type SessionLookup = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<SessionUser | undefined>;

export const idParamsSchema = z.object({ id: z.uuid() });

export const memberParamsSchema = z.object({
  id: z.uuid(),
  nodeId: z.uuid(),
});

export const inclusionParamsSchema = z.object({
  id: z.uuid(),
  childId: z.uuid(),
});

const knownMessages = new Set([
  '标题不能是空的',
  '名字不能是空的',
  '关系说明不能是空的',
  '用户名至少 2 个字',
  '用户名最多 32 个字',
  '用户名里不能有空格',
  '密码至少 8 位',
  '密码最多 72 位',
]);

export function invalidBody(message = '请求不正确') {
  return { error: { code: 'invalid_body' as const, message } };
}

export function bodyMessage(error: { issues: { message: string }[] }): string {
  const known = error.issues.find((issue) => knownMessages.has(issue.message));
  return known?.message ?? '请求不正确';
}

export const collectionNotFound = { error: { code: 'not_found' as const, message: '合集没有找到' } };
export const nodeNotFound = { error: { code: 'not_found' as const, message: '点没有找到' } };
export const edgeNotFound = { error: { code: 'not_found' as const, message: '关系没有找到' } };
export const cardNotFound = { error: { code: 'not_found' as const, message: '卡片没有找到' } };
export const edgeConflict = { error: { code: 'conflict' as const, message: '这条关系已经有了' } };
export const outlineConflict = { error: { code: 'conflict' as const, message: '大纲已经在别处改过，请刷新' } };
export const inclusionSelf = { error: { code: 'invalid_body' as const, message: '不能把合集放进自己' } };
export const inclusionCycle = { error: { code: 'invalid_body' as const, message: '这样放会绕回自己' } };
export const inclusionExists = { error: { code: 'conflict' as const, message: '这个合集已经在里面了' } };
export const inclusionNeedsLabel = { error: { code: 'invalid_body' as const, message: '要先写下两者的关系' } };
export const inclusionNotFound = { error: { code: 'not_found' as const, message: '这个合集不在里面' } };
export const usernameTaken = { error: { code: 'conflict' as const, message: '这个用户名已经被用了' } };

export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    if ('code' in current && current.code === '23505') return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}
