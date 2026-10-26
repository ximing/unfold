import { z } from 'zod';
import { canvasPrefsSchema } from './graph.js';

export const loginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const usernameSchema = z
  .string()
  .trim()
  .min(2, '用户名至少 2 个字')
  .max(32, '用户名最多 32 个字')
  .regex(/^\S+$/, '用户名里不能有空格');

export const registerBodySchema = z.strictObject({
  username: usernameSchema,
  password: z.string().min(8, '密码至少 8 位').max(72, '密码最多 72 位'),
});

export const usernameBodySchema = z.strictObject({
  username: usernameSchema,
});

export const accountSchema = z.object({
  username: z.string(),
  avatarUrl: z.string().nullable(),
  canvas: canvasPrefsSchema,
});

export const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
export type RegisterBody = z.infer<typeof registerBodySchema>;
export type UsernameBody = z.infer<typeof usernameBodySchema>;
export type Account = z.infer<typeof accountSchema>;
export type ErrorBody = z.infer<typeof errorBodySchema>;
