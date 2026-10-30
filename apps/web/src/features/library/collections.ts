import type {
  Collection,
  CreateNodeResult,
  MemberResult,
} from '@unfold/dto';
import {
  collectionListSchema,
  collectionSchema,
  createNodeResultSchema,
  memberResultSchema,
} from '@unfold/dto';
import type { LibraryState } from './library.service.js';
import { apiSend, apiRead, apiDone } from './api.js';
import { adoptCreatedNode } from './outline.js';

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

export async function createNode(
  state: LibraryState,
  collectionId: string,
  name: string,
  place?: { parentId?: string | null; afterNodeId?: string },
): Promise<CreateNodeResult | null> {
  state.error = '';
  const body: { name: string; parentId?: string | null; afterNodeId?: string } = { name };
  if (place && 'parentId' in place) body.parentId = place.parentId;
  if (place?.afterNodeId) body.afterNodeId = place.afterNodeId;
  const res = await apiSend(`/api/collections/${collectionId}/nodes`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res) {
    state.error = '网络没有连上';
    return null;
  }
  const created = await apiRead(state, res, (data) => createNodeResultSchema.parse(data), '点没有建成');
  if (!created) return null;
  adoptCreatedNode(state, collectionId, created);
  state.collections = state.collections.map((item) =>
    item.id === collectionId ? { ...item, nodeCount: item.nodeCount + 1 } : item,
  );
  return created;
}

export async function addMember(
  state: LibraryState,
  collectionId: string,
  nodeId: string,
  parentId?: string | null,
): Promise<MemberResult | null> {
  state.error = '';
  const body: { nodeId: string; parentId?: string | null } = { nodeId };
  if (parentId !== undefined) body.parentId = parentId;
  const res = await apiSend(`/api/collections/${collectionId}/members`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res) {
    state.error = '网络没有连上';
    return null;
  }
  const joined = await apiRead(state, res, (data) => memberResultSchema.parse(data), '没有放进去');
  if (!joined) return null;
  if (state.graphId === collectionId) {
    state.graph = { ...state.graph, outlineVersion: joined.outlineVersion };
  }
  if (joined.status === 'joined') {
    state.collections = state.collections.map((item) =>
      item.id === collectionId ? { ...item, nodeCount: item.nodeCount + 1 } : item,
    );
  }
  return joined;
}
