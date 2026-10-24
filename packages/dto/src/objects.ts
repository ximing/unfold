import { z } from 'zod';
import { knowledgeObjectTypeSchema } from './api.js';

const nonnegativeInt = z.int().nonnegative();

const proseMirrorContentSchema = z.object({ type: z.string() }).catchall(z.unknown());

export const createDomainBodySchema = z.object({
  name: z.string().min(1),
});

export const domainSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  freeCount: nonnegativeInt,
});

export const domainListSchema = z.object({
  domains: z.array(domainSchema),
});

export const createObjectBodySchema = z.object({
  domainId: z.uuid(),
  type: knowledgeObjectTypeSchema,
  canonicalName: z.string().min(1),
  coreStatement: z.string(),
});

export const updateObjectBodySchema = z
  .object({
    canonicalName: z.string().min(1).optional(),
    coreStatement: z.string().optional(),
    aliases: z.array(z.string().min(1)).optional(),
  })
  .refine(
    (body) =>
      body.canonicalName !== undefined ||
      body.coreStatement !== undefined ||
      body.aliases !== undefined,
    'at least one field is required',
  );

export const objectSummarySchema = z.object({
  id: z.uuid(),
  type: knowledgeObjectTypeSchema,
  domainId: z.uuid(),
  domainName: z.string(),
  canonicalName: z.string(),
  normalizedName: z.string(),
  coreStatement: z.string(),
  coreVersion: nonnegativeInt,
  status: z.enum(['active', 'merged']),
  aliases: z.array(z.string()),
});

export const documentBodySchema = z.object({
  schemaVersion: z.int().positive(),
  content: proseMirrorContentSchema,
  plainText: z.string(),
});

export const documentResponseSchema = documentBodySchema.extend({
  savedAt: z.string(),
});

export type CreateDomainBody = z.infer<typeof createDomainBodySchema>;
export type Domain = z.infer<typeof domainSchema>;
export type DomainList = z.infer<typeof domainListSchema>;
export type CreateObjectBody = z.infer<typeof createObjectBodySchema>;
export type UpdateObjectBody = z.infer<typeof updateObjectBodySchema>;
export type ObjectSummary = z.infer<typeof objectSummarySchema>;
export type DocumentBody = z.infer<typeof documentBodySchema>;
export type DocumentResponse = z.infer<typeof documentResponseSchema>;
