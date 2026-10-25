import type {
  Collection,
  Node,
} from '@unfold/dto';
import {
  collectionListSchema,
  collectionSchema,
  nodeSchema,
} from '@unfold/dto';
import type { LibraryState } from './library.service.js';
import { apiSend, apiRead, apiDone } from './api.js';

export async function loadCollections(state: LibraryState): Promise<boolean> {
  state.error = '';
  const res = await apiSend('/api/collections', { credentials: 'include' });
  if (!res) {
    state.error = '网络没有连上';
    return false;
  }
  const body = await apiRead(state, res, (data) => collectionListSchema.parse(data), '合集没有加载出来');
  if (!body) return false;
  state.collections = body.collections;
  return true;
}

export async function createCollection(state: LibraryState, title: string): Promise<Collection | null> {
  state.error = '';
  const res = await apiSend('/api/collections', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res) {
    state.error = '网络没有连上';
    return null;
  }
  const created = await apiRead(state, res, (data) => collectionSchema.parse(data), '合集没有建成');
  if (!created) return null;
  state.collections = [
    ...state.collections.filter((item) => item.id !== created.id),
    { ...created, nodeCount: 0 },
  ];
  return created;
}

export async function renameCollection(state: LibraryState, id: string, title: string): Promise<boolean> {
  state.error = '';
  const res = await apiSend(`/api/collections/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res) {
    state.error = '网络没有连上';
    return false;
  }
  const next = await apiRead(state, res, (data) => collectionSchema.parse(data), '标题没有改成');
  if (!next) return false;
  state.collections = state.collections.map((item) => (item.id === id ? { ...item, title: next.title } : item));
  if (state.libraryGraph) {
    state.libraryGraph = {
      ...state.libraryGraph,
      collections: state.libraryGraph.collections.map((item) =>
        item.id === id ? { ...item, title: next.title } : item,
      ),
    };
  }
  return true;
}

export async function deleteCollection(state: LibraryState, id: string): Promise<boolean> {
  state.error = '';
  const res = await apiSend(`/api/collections/${id}`, { method: 'DELETE', credentials: 'include' });
  if (!res) {
    state.error = '网络没有连上';
    return false;
  }
  const ok = await apiDone(state, res, '合集没有删掉');
  if (!ok) return false;
  state.collections = state.collections.filter((item) => item.id !== id);
  if (state.libraryGraph) {
    state.libraryGraph = {
      collections: state.libraryGraph.collections.filter((item) => item.id !== id),
      edges: state.libraryGraph.edges.filter((edge) => edge.fromId !== id && edge.toId !== id),
    };
  }
  return true;
}

export async function createNode(state: LibraryState, collectionId: string, name: string): Promise<Node | null> {
  state.error = '';
  const res = await apiSend(`/api/collections/${collectionId}/nodes`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res) {
    state.error = '网络没有连上';
    return null;
  }
  return apiRead(state, res, (data) => nodeSchema.parse(data), '点没有建成');
}

export async function addMember(state: LibraryState, collectionId: string, nodeId: string): Promise<boolean> {
  state.error = '';
  const res = await apiSend(`/api/collections/${collectionId}/members`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId }),
  });
  if (!res) {
    state.error = '网络没有连上';
    return false;
  }
  return apiDone(state, res, '没有放进去');
}

export async function removeMember(state: LibraryState, collectionId: string, nodeId: string): Promise<boolean> {
  state.error = '';
  const res = await apiSend(`/api/collections/${collectionId}/members/${nodeId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res) {
    state.error = '网络没有连上';
    return false;
  }
  return apiDone(state, res, '没有移出');
}
