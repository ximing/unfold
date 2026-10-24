import { z } from 'zod';

export const suggestionKindSchema = z.enum(['relation', 'personal_note']);

export const suggestionOriginSchema = z.enum(['rule', 'model']);

export const suggestionStatusSchema = z.enum(['pending', 'accepted', 'deferred', 'rejected']);

export const resolveSuggestionBodySchema = z.object({
  status: z.enum(['accepted', 'deferred', 'rejected']),
});

export const relationSuggestionPayloadSchema = z.object({
  type: z.enum(['evolves_from', 'implements', 'applies', 'contrasts', 'analogous']),
  fromId: z.uuid(),
  toId: z.uuid(),
  whatChanged: z.string(),
  distinction: z.string(),
  boundary: z.string(),
  note: z.string(),
});

export const personalNotePayloadSchema = z.object({
  text: z.string().min(1),
});

export const suggestionSchema = z.object({
  id: z.uuid(),
  objectId: z.uuid(),
  fragmentKey: z.string(),
  kind: suggestionKindSchema,
  origin: suggestionOriginSchema,
  status: suggestionStatusSchema,
  summary: z.string(),
  acceptLabel: z.string(),
  payload: z.union([relationSuggestionPayloadSchema, personalNotePayloadSchema]),
});

export const suggestionListSchema = z.object({
  suggestions: z.array(suggestionSchema),
});

export type SuggestionKind = z.infer<typeof suggestionKindSchema>;
export type SuggestionOrigin = z.infer<typeof suggestionOriginSchema>;
export type SuggestionStatus = z.infer<typeof suggestionStatusSchema>;
export type ResolveSuggestionBody = z.infer<typeof resolveSuggestionBodySchema>;
export type RelationSuggestionPayload = z.infer<typeof relationSuggestionPayloadSchema>;
export type PersonalNotePayload = z.infer<typeof personalNotePayloadSchema>;
export type Suggestion = z.infer<typeof suggestionSchema>;
export type SuggestionList = z.infer<typeof suggestionListSchema>;
