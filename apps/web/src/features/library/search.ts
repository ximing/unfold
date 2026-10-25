import {
  searchResponseSchema,
} from '@unfold/dto';
import type { LibraryState } from './library.service.js';
import { apiSend, apiRead } from './api.js';

export function clearSearch(state: LibraryState): void {
  state.searchHits = [];
  state.jobs.search += 1;
}

export async function search(state: LibraryState, query: string): Promise<void> {
  const trimmed = query.trim();
  const ticket = ++state.jobs.search;
  if (trimmed === '') {
    state.searchHits = [];
    return;
  }
  state.error = '';
  const res = await apiSend(`/api/search?q=${encodeURIComponent(trimmed)}`, { credentials: 'include' });
  if (ticket !== state.jobs.search) return;
  if (!res) {
    state.error = '网络没有连上';
    return;
  }
  const body = await apiRead(state, res, (data) => searchResponseSchema.parse(data), '没有搜到');
  if (!body || ticket !== state.jobs.search) return;
  state.searchHits = body.hits;
}
