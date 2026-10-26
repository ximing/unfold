import { z } from 'zod';
import { richPatchContentSchema, richStoredContentSchema, richWriteContentSchema } from './rich-doc.js';

function trimmed(emptyMessage: string, max: number) {
  return z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1, emptyMessage).max(max));
}

export const ownerKindSchema = z.enum(['node', 'edge', 'collection_edge']);

export const cardTypeSchema = z.enum([
  'note',
  'code',
  'formula',
  'person',
  'event',
  'place',
  'period',
  'group',
  'rich',
]);

const noteContentSchema = z.strictObject({ body: z.string() });
const codeContentSchema = z.strictObject({ language: z.string(), source: z.string() });
const formulaContentSchema = z.strictObject({ latex: z.string() });
const personContentSchema = z.strictObject({ identity: z.string(), note: z.string() });
const eventContentSchema = z.strictObject({
  when: z.string(),
  where: z.string(),
  summary: z.string(),
});
const placeContentSchema = z.strictObject({ note: z.string() });
const periodContentSchema = z.strictObject({
  start: z.string(),
  end: z.string(),
  note: z.string(),
});
const groupContentSchema = z.strictObject({ note: z.string() });

export const cardContentSchemas = {
  note: noteContentSchema,
  code: codeContentSchema,
  formula: formulaContentSchema,
  person: personContentSchema,
  event: eventContentSchema,
  place: placeContentSchema,
  period: periodContentSchema,
  group: groupContentSchema,
  rich: richPatchContentSchema,
} as const;

export const collectionSchema = z.object({
  id: z.uuid(),
  title: z.string(),
});

export const createCollectionBodySchema = z.strictObject({
  title: trimmed('标题不能是空的', 80),
});

export const updateCollectionBodySchema = createCollectionBodySchema;

export const libraryCollectionSchema = collectionSchema.extend({
  nodeCount: z.int().nonnegative(),
});

export const collectionListSchema = z.object({
  collections: z.array(libraryCollectionSchema),
});

export const nodeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
});

export const createNodeBodySchema = z.strictObject({
  name: trimmed('名字不能是空的', 80),
});

export const updateNodeBodySchema = z
  .strictObject({
    name: trimmed('名字不能是空的', 80).optional(),
    description: z.string().trim().max(160).optional(),
  })
  .refine((body) => body.name !== undefined || body.description !== undefined, {
    message: '没有要改的内容',
  });

export const addMemberBodySchema = z.strictObject({
  nodeId: z.uuid(),
});

export const edgeSchema = z.object({
  id: z.uuid(),
  fromId: z.uuid(),
  toId: z.uuid(),
  label: z.string(),
});

const labelText = trimmed('关系说明不能是空的', 40);

export const graphNodeSchema = nodeSchema.extend({
  description: z.string(),
  kind: z.enum(['text', 'image']),
  x: z.number().nullable(),
  y: z.number().nullable(),
  z: z.int().nullable(),
  imageWidth: z.int().nullable(),
  assetId: z.uuid().nullable(),
  cardCount: z.int().nonnegative(),
  cardTypes: z.array(cardTypeSchema),
});

export const placementsBodySchema = z.strictObject({
  placements: z.array(
    z.strictObject({
      nodeId: z.uuid(),
      x: z.number(),
      y: z.number(),
      z: z.int(),
      imageWidth: z.int().optional(),
    }),
  ),
});

export const graphEdgeSchema = edgeSchema.extend({
  cardCount: z.int().nonnegative(),
});

export const createEdgeBodySchema = z.strictObject({
  fromId: z.uuid(),
  toId: z.uuid(),
  label: labelText,
});

export const updateEdgeBodySchema = z.strictObject({
  label: labelText,
});

export const librarySchema = z.object({
  collections: z.array(libraryCollectionSchema),
  edges: z.array(graphEdgeSchema),
});

export const collectionGraphSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
});

const cardRecord = {
  id: z.uuid(),
  ownerKind: ownerKindSchema,
  ownerId: z.uuid(),
  position: z.int().nonnegative(),
};

export const cardSchema = z.discriminatedUnion('type', [
  z.object({ ...cardRecord, type: z.literal('note'), content: noteContentSchema }),
  z.object({ ...cardRecord, type: z.literal('code'), content: codeContentSchema }),
  z.object({ ...cardRecord, type: z.literal('formula'), content: formulaContentSchema }),
  z.object({ ...cardRecord, type: z.literal('person'), content: personContentSchema }),
  z.object({ ...cardRecord, type: z.literal('event'), content: eventContentSchema }),
  z.object({ ...cardRecord, type: z.literal('place'), content: placeContentSchema }),
  z.object({ ...cardRecord, type: z.literal('period'), content: periodContentSchema }),
  z.object({ ...cardRecord, type: z.literal('group'), content: groupContentSchema }),
  z.object({ ...cardRecord, type: z.literal('rich'), content: richStoredContentSchema }),
]);

export const nodeDetailSchema = nodeSchema.extend({
  description: z.string(),
  collections: z.array(collectionSchema),
  cards: z.array(cardSchema),
});

export const edgeDetailSchema = edgeSchema.extend({
  fromName: z.string(),
  toName: z.string(),
  cards: z.array(cardSchema),
});

export const collectionEdgeDetailSchema = edgeSchema.extend({
  fromTitle: z.string(),
  toTitle: z.string(),
  cards: z.array(cardSchema),
});

export const createCardBodySchema = z.discriminatedUnion('type', [
  z.strictObject({
    ownerKind: ownerKindSchema,
    ownerId: z.uuid(),
    type: z.literal('note'),
    content: noteContentSchema,
  }),
  z.strictObject({
    ownerKind: ownerKindSchema,
    ownerId: z.uuid(),
    type: z.literal('code'),
    content: codeContentSchema,
  }),
  z.strictObject({
    ownerKind: ownerKindSchema,
    ownerId: z.uuid(),
    type: z.literal('formula'),
    content: formulaContentSchema,
  }),
  z.strictObject({
    ownerKind: ownerKindSchema,
    ownerId: z.uuid(),
    type: z.literal('person'),
    content: personContentSchema,
  }),
  z.strictObject({
    ownerKind: ownerKindSchema,
    ownerId: z.uuid(),
    type: z.literal('event'),
    content: eventContentSchema,
  }),
  z.strictObject({
    ownerKind: ownerKindSchema,
    ownerId: z.uuid(),
    type: z.literal('place'),
    content: placeContentSchema,
  }),
  z.strictObject({
    ownerKind: ownerKindSchema,
    ownerId: z.uuid(),
    type: z.literal('period'),
    content: periodContentSchema,
  }),
  z.strictObject({
    ownerKind: ownerKindSchema,
    ownerId: z.uuid(),
    type: z.literal('group'),
    content: groupContentSchema,
  }),
  z.strictObject({
    ownerKind: ownerKindSchema,
    ownerId: z.uuid(),
    type: z.literal('rich'),
    content: richWriteContentSchema,
  }),
]);

export const updateCardBodySchema = z.strictObject({
  content: z.unknown(),
});

export const searchHitSchema = z.object({
  nodeId: z.uuid(),
  name: z.string(),
  collectionId: z.string(),
  collectionTitle: z.string(),
  snippet: z.string(),
});

export const searchResponseSchema = z.object({
  hits: z.array(searchHitSchema).max(30),
});

export type OwnerKind = z.infer<typeof ownerKindSchema>;
export type CardType = z.infer<typeof cardTypeSchema>;
export type Collection = z.infer<typeof collectionSchema>;
export type CreateCollectionBody = z.infer<typeof createCollectionBodySchema>;
export type UpdateCollectionBody = z.infer<typeof updateCollectionBodySchema>;
export type CollectionList = z.infer<typeof collectionListSchema>;
export type Node = z.infer<typeof nodeSchema>;
export type CreateNodeBody = z.infer<typeof createNodeBodySchema>;
export type UpdateNodeBody = z.infer<typeof updateNodeBodySchema>;
export type AddMemberBody = z.infer<typeof addMemberBodySchema>;
export type PlacementsBody = z.infer<typeof placementsBodySchema>;
export type Edge = z.infer<typeof edgeSchema>;
export type CreateEdgeBody = z.infer<typeof createEdgeBodySchema>;
export type UpdateEdgeBody = z.infer<typeof updateEdgeBodySchema>;
export type Library = z.infer<typeof librarySchema>;
export type CollectionGraph = z.infer<typeof collectionGraphSchema>;
export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type LibraryCollection = z.infer<typeof libraryCollectionSchema>;
export type Card = z.infer<typeof cardSchema>;
export type NodeDetail = z.infer<typeof nodeDetailSchema>;
export type EdgeDetail = z.infer<typeof edgeDetailSchema>;
export type CollectionEdgeDetail = z.infer<typeof collectionEdgeDetailSchema>;
export type CreateCardBody = z.infer<typeof createCardBodySchema>;
export type UpdateCardBody = z.infer<typeof updateCardBodySchema>;
export type SearchHit = z.infer<typeof searchHitSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
