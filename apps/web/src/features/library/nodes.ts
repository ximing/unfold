import type {
  NodeDetail,
} from '@unfold/dto';
import {
  nodeDetailSchema,
  nodeSchema,
} from '@unfold/dto';
import type { LibraryState } from './library.service.js';
import { apiSend, apiRead, apiDone } from './api.js';

export async function loadNode(state: LibraryState, id: string): Promise<NodeDetail | null> {
  const ticket = ++state.jobs.node;
  state.error = '';
  state.nodeDetail = null;
  const res = await apiSend(`/api/nodes/${id}`, { credentials: 'include' });
  if (ticket !== state.jobs.node) return null;
  if (!res) {
    state.error = '网络没有连上';
    return null;
  }
  const detail = await apiRead(state, res, (data) => nodeDetailSchema.parse(data), '点没有找到');
  if (!detail || ticket !== state.jobs.node) return null;
  state.nodeDetail = detail;
  return detail;
}

export async function loadPeek(state: LibraryState, id: string): Promise<void> {
  const ticket = ++state.jobs.peek;
  const res = await apiSend(`/api/nodes/${id}`, { credentials: 'include' });
  if (ticket !== state.jobs.peek || !res || !res.ok) return;
  try {
    const detail = nodeDetailSchema.parse(await res.json());
    if (ticket !== state.jobs.peek) return;
    state.peek = detail;
  } catch {
    // 预览失败不打断
  }
}

export function clearPeek(state: LibraryState): void {
  state.jobs.peek += 1;
  state.peek = null;
}

export async function renameNode(state: LibraryState, id: string, name: string): Promise<boolean> {
  state.error = '';
  const res = await apiSend(`/api/nodes/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res) {
    state.error = '网络没有连上';
    return false;
  }
  const next = await apiRead(state, res, (data) => nodeSchema.parse(data), '名字没有改成');
  if (!next) return false;
  state.graph = {
    ...state.graph,
    nodes: state.graph.nodes.map((node) => (node.id === id ? { ...node, name: next.name } : node)),
  };
  if (state.nodeDetail?.id === id) state.nodeDetail = { ...state.nodeDetail, name: next.name };
  return true;
}

export async function describeNode(state: LibraryState, id: string, description: string): Promise<boolean> {
  state.error = '';
  const res = await apiSend(`/api/nodes/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  if (!res) {
    state.error = '网络没有连上';
    return false;
  }
  const next = await apiRead(state, res, (data) => nodeSchema.parse(data), '描述没有改成');
  if (!next) return false;
  state.graph = {
    ...state.graph,
    nodes: state.graph.nodes.map((node) => (node.id === id ? { ...node, description } : node)),
  };
  if (state.nodeDetail?.id === id) state.nodeDetail = { ...state.nodeDetail, description };
  return true;
}

export async function deleteNode(state: LibraryState, id: string): Promise<boolean> {
  state.error = '';
  const res = await apiSend(`/api/nodes/${id}`, { method: 'DELETE', credentials: 'include' });
  if (!res) {
    state.error = '网络没有连上';
    return false;
  }
  const ok = await apiDone(state, res, '点没有删掉');
  if (!ok) return false;
  if (state.nodeDetail?.id === id) state.nodeDetail = null;
  return true;
}
