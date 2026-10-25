import { z } from 'zod';

export const loginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
export type ErrorBody = z.infer<typeof errorBodySchema>;
