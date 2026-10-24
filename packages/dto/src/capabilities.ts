import { z } from 'zod';

export const capabilityKindSchema = z.enum([
  'explain',
  'derive',
  'discriminate',
  'vary',
  'counter',
  'implement',
  'transfer',
  'tradeoff',
]);

export const evidenceModeSchema = z.enum([
  'recall',
  'derive',
  'practice',
  'review',
  'self_report_failure',
  'reread',
]);

export const evidenceRatingSchema = z.enum([
  'fail',
  'partial',
  'with_hint',
  'independent',
  'saw_material',
]);

export const createCapabilityBodySchema = z.object({
  statement: z.string().trim().min(1).max(500),
  kind: capabilityKindSchema,
  primaryObjectId: z.uuid(),
  prompt: z.string().trim().max(2000).default(''),
  referenceNote: z.string().trim().max(2000).default(''),
  hintThreshold: z.int().min(1).default(3),
  hints: z.array(z.string()).default([]),
  objectIds: z.array(z.uuid()).default([]),
});

export const capabilitySchema = z.object({
  id: z.uuid(),
  statement: z.string(),
  kind: capabilityKindSchema,
  prompt: z.string(),
  hints: z.array(z.string()),
  hintThreshold: z.int().min(1),
  referenceNote: z.string(),
  primaryObjectId: z.uuid(),
  objectIds: z.array(z.uuid()),
  practiceLocked: z.boolean(),
  practiceLockMessage: z.string(),
});

export const createEvidenceBodySchema = z.object({
  mode: evidenceModeSchema,
  hintLevel: z.int().nonnegative(),
  rating: evidenceRatingSchema,
  obstacle: z.string().default(''),
  body: z.string().default(''),
});

export const evidenceSchema = z.object({
  id: z.uuid(),
  capabilityId: z.uuid(),
  mode: evidenceModeSchema,
  hintLevel: z.int().nonnegative(),
  rating: evidenceRatingSchema,
  obstacle: z.string(),
  body: z.string(),
  createdAt: z.string(),
  dueAt: z.string().optional(),
});

export type CapabilityKind = z.infer<typeof capabilityKindSchema>;
export type EvidenceMode = z.infer<typeof evidenceModeSchema>;
export type EvidenceRating = z.infer<typeof evidenceRatingSchema>;
export type CreateCapabilityBody = z.infer<typeof createCapabilityBodySchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export type CreateEvidenceBody = z.infer<typeof createEvidenceBodySchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
