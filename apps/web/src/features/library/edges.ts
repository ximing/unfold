import type {
  Edge,
  EdgeDetail,
} from '@unfold/dto';
import {
  edgeDetailSchema,
  edgeLabelsSchema,
  edgeSchema,
} from '@unfold/dto';
import type { LibraryState } from './library.service.js';
import { apiSend, apiRead, apiDone } from './api.js';

export async function createEdge(state: LibraryState, fromId: string, toId: string, label: string): Promise<Edge | null> {
  state.error = '';
  const res = await apiSend('/api/edges', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fromId, toId, label }),
  });
  if (!res) {
    state.error = '网络没有连上';
    return null;
  }
  return apiRead(state, res, (data) => edgeSchema.parse(data), '关系没有连上');
}

export async function loadEdge(state: LibraryState, id: string): Promise<EdgeDetail | null> {
  const ticket = ++state.jobs.edge;
  state.error = '';
  state.edgeDetail = null;
  const res = await apiSend(`/api/edges/${id}`, { credentials: 'include' });
  if (ticket !== state.jobs.edge) return null;
  if (!res) {
    state.error = '网络没有连上';
    return null;
  }
  const detail = await apiRead(state, res, (data) => edgeDetailSchema.parse(data), '关系没有找到');
  if (!detail || ticket !== state.jobs.edge) return null;
  state.edgeDetail = detail;
  return detail;
}

export async function renameEdge(state: LibraryState, id: string, label: string): Promise<boolean> {
  state.error = '';
  const res = await apiSend(`/api/edges/${id}`, {
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
  state.graph = {
    ...state.graph,
    edges: state.graph.edges.map((edge) => (edge.id === id ? { ...edge, label: next.label } : edge)),
  };
  if (state.edgeDetail?.id === id) state.edgeDetail = { ...state.edgeDetail, label: next.label };
  return true;
}

export async function fetchEdgeLabels(): Promise<string[]> {
  const res = await apiSend('/api/edge-labels', { credentials: 'include' });
  if (!res?.ok) return [];
  try {
    return edgeLabelsSchema.parse(await res.json()).labels;
  } catch {
    return [];
  }
}

export async function deleteEdge(state: LibraryState, id: string): Promise<boolean> {
  state.error = '';
  const res = await apiSend(`/api/edges/${id}`, { method: 'DELETE', credentials: 'include' });
  if (!res) {
    state.error = '网络没有连上';
    return false;
  }
  const ok = await apiDone(state, res, '关系没有删掉');
  if (!ok) return false;
  if (state.edgeDetail?.id === id) state.edgeDetail = null;
  return true;
}
