import { z } from 'zod';
import { richPatchContentSchema, richStoredContentSchema, richWriteContentSchema } from './rich-doc.js';

function trimmed(emptyMessage: string, max: number) {
  return z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1, emptyMessage).max(max));
}

export const ownerKindSchema = z.enum(['node', 'edge', 'collection_edge']);

export const nodeKindSchema = z.enum(['text', 'image']);

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
  parentId: z.uuid().nullable().optional(),
  afterNodeId: z.uuid().optional(),
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
  parentId: z.uuid().nullable().optional(),
});

export const outlineItemSchema = z.strictObject({
  nodeId: z.uuid(),
  parentId: z.uuid().nullable(),
  order: z.int().nonnegative(),
});

export const putOutlineBodySchema = z.strictObject({
  expectedVersion: z.int().nonnegative(),
  items: z.array(outlineItemSchema),
});

export const outlineVersionSchema = z.object({
  outlineVersion: z.int().nonnegative(),
});

export const duplicateNodeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  collections: z.array(collectionSchema),
});

export const createNodeResultSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  parentId: z.uuid().nullable(),
  outlineOrder: z.int().nonnegative(),
  outlineVersion: z.int().nonnegative(),
  duplicates: z.array(duplicateNodeSchema).max(5),
});

export const memberResultSchema = z.object({
  status: z.enum(['joined', 'exists']),
  parentId: z.uuid().nullable(),
  outlineOrder: z.int().nonnegative(),
  outlineVersion: z.int().nonnegative(),
});

export const restoreOutlineBodySchema = z.strictObject({
  expectedVersion: z.int().nonnegative(),
  nodeId: z.uuid(),
  parentId: z.uuid().nullable(),
  order: z.int().nonnegative(),
  placement: z.strictObject({
    x: z.number().finite().nullable(),
    y: z.number().finite().nullable(),
    z: z.int().nullable(),
    imageWidth: z.int().min(120).max(480).nullable(),
  }),
  children: z.array(outlineItemSchema),
});

export const edgeSchema = z.object({
  id: z.uuid(),
  fromId: z.uuid(),
  toId: z.uuid(),
  label: z.string(),
});

export const edgeDashSchema = z.enum(['solid', 'dashed', 'dotted']);
export const edgeWidthSchema = z.enum(['thin', 'medium', 'thick']);
export const edgeColorSchema = z.enum(['gray', 'blue', 'green', 'red']);
export const edgeArrowSchema = z.enum(['end', 'none']);

export const edgeAppearanceSchema = z.strictObject({
  dash: edgeDashSchema,
  width: edgeWidthSchema,
  color: edgeColorSchema,
  arrow: edgeArrowSchema,
});

export const defaultEdgeAppearance = {
  dash: 'solid',
  width: 'thin',
  color: 'gray',
  arrow: 'end',
} as const satisfies z.infer<typeof edgeAppearanceSchema>;

export const canvasRouteSchema = z.enum(['straight', 'curve', 'orthogonal']);
export const canvasLabelsSchema = z.enum(['always', 'focus']);
export const canvasGrowSchema = z.enum(['up', 'down', 'left', 'right']);

export const canvasPrefsSchema = z.strictObject({
  route: canvasRouteSchema,
  grid: z.boolean(),
  snap: z.boolean(),
  labels: canvasLabelsSchema,
  markers: z.boolean(),
  minimap: z.boolean(),
  grow: canvasGrowSchema,
});

export const defaultCanvasPrefs = {
  route: 'straight',
  grid: true,
  snap: false,
  labels: 'always',
  markers: true,
  minimap: true,
  grow: 'down',
} as const satisfies z.infer<typeof canvasPrefsSchema>;

const labelText = trimmed('关系说明不能是空的', 40);

export const graphNodeSchema = nodeSchema.extend({
  description: z.string(),
  kind: nodeKindSchema,
  x: z.number().nullable(),
  y: z.number().nullable(),
  z: z.int().nullable(),
  imageWidth: z.int().nullable(),
  assetId: z.uuid().nullable(),
  cardCount: z.int().nonnegative(),
  cardTypes: z.array(cardTypeSchema),
  parentId: z.uuid().nullable(),
  outlineOrder: z.int().nonnegative(),
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

export const graphInclusionSchema = z.object({
  childId: z.uuid(),
  title: z.string(),
  x: z.number(),
  y: z.number(),
  collapsed: z.boolean(),
  labels: z.array(z.string()),
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
});

export const collectionGraphSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  bridges: z.array(graphEdgeSchema),
  inclusions: z.array(graphInclusionSchema),
  appearance: edgeAppearanceSchema,
  outlineVersion: z.int().nonnegative(),
});

export const createInclusionBodySchema = z.strictObject({
  childId: z.uuid(),
  originX: z.number().finite(),
  originY: z.number().finite(),
  label: labelText.optional(),
});

export const updateInclusionBodySchema = z.strictObject({
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  collapsed: z.boolean().optional(),
});

export const inclusionCandidateSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  nodeCount: z.int().nonnegative(),
  linked: z.boolean(),
  labels: z.array(z.string()),
});

export const inclusionCandidatesSchema = z.object({
  collections: z.array(inclusionCandidateSchema),
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
  kind: z.enum(['collection', 'node', 'edge', 'collection_edge', 'card']),
  id: z.uuid(),
  title: z.string(),
  field: z.enum(['title', 'name', 'description', 'label', 'content']),
  snippet: z.string(),
  collectionId: z.uuid().nullable(),
  collectionTitle: z.string().nullable(),
  nodeId: z.uuid().nullable(),
  edgeId: z.uuid().nullable(),
  cardId: z.uuid().nullable(),
  ownerKind: z.enum(['node', 'edge', 'collection_edge']).nullable(),
});

export const searchResponseSchema = z.object({
  hits: z.array(searchHitSchema).max(30),
  nextCursor: z.string().nullable(),
});

export const unassignedNodeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  kind: nodeKindSchema,
  cardCount: z.int().nonnegative(),
});

export const unassignedNodesSchema = z.object({
  nodes: z.array(unassignedNodeSchema).max(30),
  nextCursor: z.string().nullable(),
});

export const edgeLabelsSchema = z.object({
  labels: z.array(z.string()).max(20),
});

export const liveNoticeSchema = z.object({
  client: z.uuid(),
});

export type OwnerKind = z.infer<typeof ownerKindSchema>;
export type NodeKind = z.infer<typeof nodeKindSchema>;
export type CardType = z.infer<typeof cardTypeSchema>;
export type Collection = z.infer<typeof collectionSchema>;
export type CreateCollectionBody = z.infer<typeof createCollectionBodySchema>;
export type UpdateCollectionBody = z.infer<typeof updateCollectionBodySchema>;
export type CollectionList = z.infer<typeof collectionListSchema>;
export type Node = z.infer<typeof nodeSchema>;
export type CreateNodeBody = z.infer<typeof createNodeBodySchema>;
export type UpdateNodeBody = z.infer<typeof updateNodeBodySchema>;
export type AddMemberBody = z.infer<typeof addMemberBodySchema>;
export type OutlineItemBody = z.infer<typeof outlineItemSchema>;
export type PutOutlineBody = z.infer<typeof putOutlineBodySchema>;
export type OutlineVersion = z.infer<typeof outlineVersionSchema>;
export type DuplicateNode = z.infer<typeof duplicateNodeSchema>;
export type CreateNodeResult = z.infer<typeof createNodeResultSchema>;
export type MemberResult = z.infer<typeof memberResultSchema>;
export type RestoreOutlineBody = z.infer<typeof restoreOutlineBodySchema>;
export type PlacementsBody = z.infer<typeof placementsBodySchema>;
export type EdgeDash = z.infer<typeof edgeDashSchema>;
export type EdgeWidth = z.infer<typeof edgeWidthSchema>;
export type EdgeColor = z.infer<typeof edgeColorSchema>;
export type EdgeArrow = z.infer<typeof edgeArrowSchema>;
export type EdgeAppearance = z.infer<typeof edgeAppearanceSchema>;
export type CanvasRoute = z.infer<typeof canvasRouteSchema>;
export type CanvasLabels = z.infer<typeof canvasLabelsSchema>;
export type CanvasGrow = z.infer<typeof canvasGrowSchema>;
export type CanvasPrefs = z.infer<typeof canvasPrefsSchema>;
export type Edge = z.infer<typeof edgeSchema>;
export type CreateEdgeBody = z.infer<typeof createEdgeBodySchema>;
export type UpdateEdgeBody = z.infer<typeof updateEdgeBodySchema>;
export type Library = z.infer<typeof librarySchema>;
export type CollectionGraph = z.infer<typeof collectionGraphSchema>;
export type GraphInclusion = z.infer<typeof graphInclusionSchema>;
export type CreateInclusionBody = z.infer<typeof createInclusionBodySchema>;
export type UpdateInclusionBody = z.infer<typeof updateInclusionBodySchema>;
export type InclusionCandidate = z.infer<typeof inclusionCandidateSchema>;
export type InclusionCandidates = z.infer<typeof inclusionCandidatesSchema>;
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
export type UnassignedNode = z.infer<typeof unassignedNodeSchema>;
export type UnassignedNodes = z.infer<typeof unassignedNodesSchema>;
export type EdgeLabels = z.infer<typeof edgeLabelsSchema>;
export type LiveNotice = z.infer<typeof liveNoticeSchema>;
