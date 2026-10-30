import {
  searchResponseSchema,
  type SearchResponse,
} from '@unfold/dto';
import type { LibraryState } from './library.service.js';
import { apiSend } from './api.js';

export type SearchArgs = {
  query: string;
  scope: 'account' | 'collection';
  collectionId?: string;
  preferCollectionId?: string;
  cursor?: string;
};

export function clearSearch(state: LibraryState): void {
  state.searchHits = [];
  state.searchCursor = null;
  state.searchError = '';
  state.searchLoading = false;
  state.jobs.search += 1;
}

export async function fetchSearch(args: SearchArgs): Promise<{ ok: true; body: SearchResponse } | { ok: false }> {
  const trimmed = args.query.trim();
  if (trimmed === '') return { ok: true, body: { hits: [], nextCursor: null } };
  const params = new URLSearchParams({ q: trimmed, scope: args.scope });
  if (args.scope === 'collection' && args.collectionId) params.set('collectionId', args.collectionId);
  if (args.preferCollectionId) params.set('preferCollectionId', args.preferCollectionId);
  if (args.cursor) params.set('cursor', args.cursor);
  const res = await apiSend(`/api/search?${params.toString()}`, { credentials: 'include' });
  if (!res?.ok) return { ok: false };
  try {
    return { ok: true, body: searchResponseSchema.parse(await res.json()) };
  } catch {
    return { ok: false };
  }
}

export async function search(state: LibraryState, args: SearchArgs): Promise<void> {
  const trimmed = args.query.trim();
  const ticket = ++state.jobs.search;
  if (trimmed === '') {
    state.searchHits = [];
    state.searchCursor = null;
    state.searchError = '';
    state.searchLoading = false;
    return;
  }
  state.searchError = '';
  state.searchLoading = true;
  if (!args.cursor) {
    state.searchHits = [];
    state.searchCursor = null;
  }
  const result = await fetchSearch(args);
  if (ticket !== state.jobs.search) return;
  state.searchLoading = false;
  if (!result.ok) {
    state.searchError = '没有加载出来';
    if (!args.cursor) state.searchHits = [];
    return;
  }
  state.searchHits = args.cursor ? [...state.searchHits, ...result.body.hits] : result.body.hits;
  state.searchCursor = result.body.nextCursor;
}
