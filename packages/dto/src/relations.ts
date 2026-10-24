import { z } from 'zod';

export const relationTypeSchema = z.enum([
  'evolves_from',
  'prerequisite',
  'applies',
  'implements',
  'contrasts',
  'analogous',
  'variant',
  'fails_when',
]);

export const relationStatusSchema = z.enum(['suggested', 'accepted', 'deferred', 'rejected']);

export const createRelationBodySchema = z.object({
  fromId: z.uuid(),
  toId: z.uuid(),
  type: relationTypeSchema,
  distinction: z.string().optional(),
  whatChanged: z.string().optional(),
  condition: z.string().optional(),
  boundary: z.string().optional(),
  note: z.string().optional(),
});

export const updateRelationStatusSchema = z.object({
  status: z.enum(['accepted', 'deferred', 'rejected']),
});

export type RelationType = z.infer<typeof relationTypeSchema>;
export type RelationStatus = z.infer<typeof relationStatusSchema>;
export type CreateRelationBody = z.infer<typeof createRelationBodySchema>;
export type UpdateRelationStatus = z.infer<typeof updateRelationStatusSchema>;
