import {
  collectionGraphSchema,
  defaultEdgeAppearance,
  librarySchema,
} from '@unfold/dto';
import type { LibraryState } from './library.service.js';
import { apiRead, apiSend, errorMessage } from './api.js';

export async function loadLibrary(state: LibraryState): Promise<boolean> {
  state.error = '';
  const res = await apiSend('/api/library', { credentials: 'include' });
  if (!res) {
    state.error = '网络没有连上';
    return false;
  }
  const body = await apiRead(state, res, (data) => librarySchema.parse(data), '全貌没有加载出来');
  if (!body) return false;
  state.libraryGraph = body;
  return true;
}

export async function loadGraph(state: LibraryState, collectionId: string): Promise<boolean> {
  const ticket = ++state.jobs.graph;
  state.error = '';
  const res = await apiSend(`/api/collections/${collectionId}/graph`, { credentials: 'include' });
  if (ticket !== state.jobs.graph) return false;
  if (!res) {
    state.error = '网络没有连上';
    return false;
  }
  if (!res.ok) {
    state.error = await errorMessage(res, '这个合集没有找到');
    state.graph = { nodes: [], edges: [], bridges: [], inclusions: [], appearance: defaultEdgeAppearance, outlineVersion: 0 };
    state.graphId = collectionId;
    return false;
  }
  try {
    state.graph = collectionGraphSchema.parse(await res.json());
  } catch {
    state.error = '响应没法读取';
    return false;
  }
  state.graphId = collectionId;
  return true;
}
