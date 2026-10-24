import { z } from 'zod';

export const searchHitSchema = z.object({
  id: z.string(),
  kind: z.enum(['object', 'block', 'question', 'decision', 'collection_sentence']),
  text: z.string(),
  promote: z.boolean(),
});

export const searchGroupSchema = z.object({
  objectId: z.string().nullable(),
  title: z.string(),
  domain: z.string(),
  core: z.string(),
  hits: z.array(searchHitSchema),
});

export const searchResponseSchema = z.object({
  degraded: z.boolean(),
  notice: z.string(),
  groups: z.array(searchGroupSchema),
});

export type SearchHit = z.infer<typeof searchHitSchema>;
export type SearchGroup = z.infer<typeof searchGroupSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
