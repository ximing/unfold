import { z } from 'zod';

export const createCollectionBodySchema = z.object({
  domainId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  intent: z.string().trim().max(500).default(''),
  parentCollectionId: z.uuid().nullable().optional(),
});

export const collectionSchema = z.object({
  id: z.uuid(),
  domainId: z.uuid(),
  title: z.string(),
  intent: z.string(),
  parentCollectionId: z.uuid().nullable(),
  position: z.int().nonnegative(),
  documentId: z.uuid().nullable(),
});

export const collectionListSchema = z.object({
  collections: z.array(collectionSchema),
});

export const collectionRefBodySchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), objectId: z.uuid() }),
  z.object({ op: z.literal('remove'), objectId: z.uuid() }),
  z.object({ op: z.literal('move'), objectId: z.uuid(), position: z.int().nonnegative() }),
]);

export const collectionPendingSchema = z.object({
  objectId: z.uuid(),
  message: z.literal('核心定义已更新，待确认'),
});

export const collectionDetailSchema = collectionSchema.extend({
  pending: z.array(collectionPendingSchema),
});

export const confirmCollectionReadBodySchema = z.object({
  objectId: z.uuid(),
});

export const collectionReadSchema = z.object({
  objectId: z.uuid(),
  seenCoreVersion: z.int().nonnegative(),
  seenStatement: z.string(),
});

export type CreateCollectionBody = z.infer<typeof createCollectionBodySchema>;
export type Collection = z.infer<typeof collectionSchema>;
export type CollectionList = z.infer<typeof collectionListSchema>;
export type CollectionRefBody = z.infer<typeof collectionRefBodySchema>;
export type CollectionPending = z.infer<typeof collectionPendingSchema>;
export type CollectionDetail = z.infer<typeof collectionDetailSchema>;
export type ConfirmCollectionReadBody = z.infer<typeof confirmCollectionReadBodySchema>;
export type CollectionRead = z.infer<typeof collectionReadSchema>;
