import { z } from 'zod';

const nonnegativeInt = z.int().nonnegative();

export const knowledgeObjectTypeSchema = z.enum([
  'concept',
  'principle',
  'method',
  'model',
  'problem',
]);

export const todayFocusSchema = z.object({
  id: z.uuid(),
  canonicalName: z.string(),
  coreStatement: z.string(),
  domainName: z.string(),
  type: knowledgeObjectTypeSchema,
});

export const dueCapabilitySchema = z.object({
  capabilityId: z.uuid(),
  statement: z.string(),
  evidenceNote: z.string(),
  dueAt: z.string(),
});

export const openQuestionSchema = z.object({
  blockId: z.uuid(),
  text: z.string(),
  objectId: z.uuid(),
  objectName: z.string(),
});

export const todayResponseSchema = z.object({
  focus: todayFocusSchema.nullable(),
  due: z.array(dueCapabilitySchema),
  freeCount: nonnegativeInt,
  pendingSuggestions: nonnegativeInt,
  openQuestions: z.array(openQuestionSchema),
});

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

export type KnowledgeObjectType = z.infer<typeof knowledgeObjectTypeSchema>;
export type TodayFocus = z.infer<typeof todayFocusSchema>;
export type DueCapability = z.infer<typeof dueCapabilitySchema>;
export type OpenQuestion = z.infer<typeof openQuestionSchema>;
export type TodayResponse = z.infer<typeof todayResponseSchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type ErrorBody = z.infer<typeof errorBodySchema>;
