import type {
  CollectionEdgeDetail,
  Edge,
} from '@unfold/dto';
import {
  collectionEdgeDetailSchema,
  edgeSchema,
} from '@unfold/dto';
import type { LibraryState } from './library.service.js';
import { apiSend, apiRead, apiDone } from './api.js';

export async function createCollectionEdge(state: LibraryState, fromId: string, toId: string, label: string): Promise<Edge | null> {
  state.error = '';
  const res = await apiSend('/api/collection-edges', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fromId, toId, label }),
  });
  if (!res) {
    state.error = '网络没有连上';
    return null;
  }
  return apiRead(state, res, (data) => edgeSchema.parse(data), '合集没有连上');
}

export async function loadCollectionEdge(state: LibraryState, id: string): Promise<CollectionEdgeDetail | null> {
  const ticket = ++state.jobs.collectionEdge;
  state.error = '';
  state.collectionEdgeDetail = null;
  const res = await apiSend(`/api/collection-edges/${id}`, { credentials: 'include' });
  if (ticket !== state.jobs.collectionEdge) return null;
  if (!res) {
    state.error = '网络没有连上';
    return null;
  }
  const detail = await apiRead(state, res, (data) => collectionEdgeDetailSchema.parse(data), '关系没有找到');
  if (!detail || ticket !== state.jobs.collectionEdge) return null;
  state.collectionEdgeDetail = detail;
  return detail;
}

export async function renameCollectionEdge(state: LibraryState, id: string, label: string): Promise<boolean> {
  state.error = '';
  const res = await apiSend(`/api/collection-edges/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  if (!res) {
    state.error = '网络没有连上';
    return false;
  }
  const next = await apiRead(state, res, (data) => edgeSchema.parse(data), '关系说明没有改成');
  if (!next) return false;
  if (state.libraryGraph) {
    state.libraryGraph = {
      ...state.libraryGraph,
      edges: state.libraryGraph.edges.map((edge) => (edge.id === id ? { ...edge, label: next.label } : edge)),
    };
  }
  if (state.collectionEdgeDetail?.id === id) {
    state.collectionEdgeDetail = { ...state.collectionEdgeDetail, label: next.label };
  }
  return true;
}

export async function deleteCollectionEdge(state: LibraryState, id: string): Promise<boolean> {
  state.error = '';
  const res = await apiSend(`/api/collection-edges/${id}`, { method: 'DELETE', credentials: 'include' });
  if (!res) {
    state.error = '网络没有连上';
    return false;
  }
  const ok = await apiDone(state, res, '关系没有删掉');
  if (!ok) return false;
  if (state.collectionEdgeDetail?.id === id) state.collectionEdgeDetail = null;
  if (state.libraryGraph) {
    state.libraryGraph = {
      ...state.libraryGraph,
      edges: state.libraryGraph.edges.filter((edge) => edge.id !== id),
    };
  }
  return true;
}
