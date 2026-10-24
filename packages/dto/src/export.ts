import { z } from 'zod';

export const exportPackageSchema = z.object({
  format: z.literal('unfold-export'),
  version: z.literal(1),
  domains: z.array(z.object({
    id: z.uuid(),
    name: z.string(),
  })),
  objects: z.array(z.object({
    id: z.uuid(),
    domainId: z.uuid(),
    type: z.enum(['concept', 'principle', 'method', 'model', 'problem']),
    canonicalName: z.string(),
    coreStatement: z.string(),
    aliases: z.array(z.string()),
    coreVersion: z.int().nonnegative(),
    documentId: z.uuid().nullable(),
    status: z.enum(['active', 'merged']),
  })),
  documents: z.array(z.object({
    id: z.uuid(),
    ownerType: z.enum(['object', 'collection']),
    ownerId: z.uuid(),
    schemaVersion: z.int().nonnegative(),
    content: z.unknown(),
    plainText: z.string(),
    markdown: z.string(),
  })),
  relations: z.array(z.object({
    id: z.uuid(),
    type: z.enum(['evolves_from', 'prerequisite', 'applies', 'implements', 'contrasts', 'analogous', 'variant', 'fails_when']),
    fromId: z.uuid(),
    toId: z.uuid(),
    status: z.enum(['suggested', 'accepted', 'deferred', 'rejected']),
    origin: z.enum(['user', 'rule', 'model']),
    whatChanged: z.string(),
    distinction: z.string(),
    boundary: z.string(),
    condition: z.string(),
    note: z.string(),
  })),
  collections: z.array(z.object({
    id: z.uuid(),
    domainId: z.uuid(),
    title: z.string(),
    intent: z.string(),
    parentCollectionId: z.uuid().nullable(),
    position: z.int().nonnegative(),
    documentId: z.uuid().nullable(),
  })),
});

export type ExportPackage = z.infer<typeof exportPackageSchema>;
