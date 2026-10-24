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

export const relationSchema = z.object({
  id: z.uuid(),
  fromId: z.uuid(),
  toId: z.uuid(),
  type: relationTypeSchema,
  distinction: z.string(),
  whatChanged: z.string(),
  condition: z.string(),
  boundary: z.string(),
  note: z.string(),
  status: relationStatusSchema,
  origin: z.enum(['user', 'rule', 'model']),
  needsCrossDomainConfirm: z.boolean(),
});

export const fanRelationSchema = relationSchema.extend({
  sector: z.enum(['origin', 'destination', 'contrast', 'change']),
  otherId: z.uuid(),
  otherName: z.string(),
  otherCore: z.string(),
});

export const fanRelationListSchema = z.object({
  relations: z.array(fanRelationSchema),
});

export type RelationType = z.infer<typeof relationTypeSchema>;
export type RelationStatus = z.infer<typeof relationStatusSchema>;
export type CreateRelationBody = z.infer<typeof createRelationBodySchema>;
export type UpdateRelationStatus = z.infer<typeof updateRelationStatusSchema>;
export type Relation = z.infer<typeof relationSchema>;
export type FanRelation = z.infer<typeof fanRelationSchema>;
export type FanRelationList = z.infer<typeof fanRelationListSchema>;
