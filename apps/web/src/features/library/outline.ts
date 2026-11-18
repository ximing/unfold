import type { CreateNodeResult, GraphNode, InsertParentBody, InsertParentResult, OutlineItem, RestoreOutlineBody } from '@unfold/dto';
import { insertParentResultSchema, outlineVersionSchema, promoteOnRemove } from '@unfold/dto';
import type { LibraryState } from './library.service.js';
import { apiRead, apiSend, errorMessage } from './api.js';

export const OUTLINE_CONFLICT_TEXT = '另一台设备改动过这份大纲';

export type OutlineWrite =
  | { ok: true; outlineVersion: number }
  | { ok: false; conflict: boolean; offline: boolean };

function bumpCount(state: LibraryState, collectionId: string, delta: number): void {
  state.collections = state.collections.map((item) =>
    item.id === collectionId ? { ...item, nodeCount: Math.max(0, item.nodeCount + delta) } : item,
  );
}

export function adoptCreatedNode(state: LibraryState, collectionId: string, created: CreateNodeResult): void {
  if (state.graphId !== collectionId) return;
  const nodes = state.graph.nodes
    .filter((node) => node.id !== created.id)
    .map((node) => {
      if (node.parentId !== created.parentId || node.outlineOrder < created.outlineOrder) return node;
      return { ...node, outlineOrder: node.outlineOrder + 1 };
    });
  const fresh: GraphNode = {
    id: created.id,
    name: created.name,
    description: '',
    kind: 'text',
    x: null,
    y: null,
    z: null,
    imageWidth: null,
    assetId: null,
    cardCount: 0,
    cardTypes: [],
    parentId: created.parentId,
    outlineOrder: created.outlineOrder,
    layoutSide: null,
  };
  state.graph = { ...state.graph, outlineVersion: created.outlineVersion, nodes: [...nodes, fresh] };
}

function paintItems(state: LibraryState, collectionId: string, items: readonly OutlineItem[], outlineVersion: number): void {
  if (state.graphId !== collectionId) return;
  const byId = new Map(items.map((item) => [item.nodeId, item]));
  state.graph = {
    ...state.graph,
    outlineVersion,
    nodes: state.graph.nodes.map((node) => {
      const item = byId.get(node.id);
      if (!item || (node.parentId === item.parentId && node.outlineOrder === item.order)) return node;
      return { ...node, parentId: item.parentId, outlineOrder: item.order };
    }),
  };
}

function paintRemoval(state: LibraryState, collectionId: string, nodeId: string, outlineVersion: number): void {
  if (state.graphId !== collectionId) return;
  const items = state.graph.nodes.map((node) => ({
    nodeId: node.id,
    parentId: node.parentId,
    order: node.outlineOrder,
  }));
  const next = promoteOnRemove(items, nodeId);
  const byId = new Map(next.map((item) => [item.nodeId, item]));
  state.graph = {
    ...state.graph,
    outlineVersion,
    nodes: state.graph.nodes
      .filter((node) => node.id !== nodeId)
      .map((node) => {
        const item = byId.get(node.id);
        if (!item) return node;
        return { ...node, parentId: item.parentId, outlineOrder: item.order };
      }),
  };
  bumpCount(state, collectionId, -1);
}

async function readVersion(state: LibraryState, res: Response | null, fallback: string): Promise<OutlineWrite> {
  if (!res) {
    state.error = '网络没有连上';
    return { ok: false, conflict: false, offline: true };
  }
  if (res.status === 409) {
    await errorMessage(res, OUTLINE_CONFLICT_TEXT);
    state.error = OUTLINE_CONFLICT_TEXT;
    return { ok: false, conflict: true, offline: false };
  }
  const body = await apiRead(state, res, (data) => outlineVersionSchema.parse(data), fallback);
  if (!body) return { ok: false, conflict: false, offline: false };
  return { ok: true, outlineVersion: body.outlineVersion };
}

function adoptInsertedParent(state: LibraryState, collectionId: string, created: InsertParentResult): void {
  if (state.graphId !== collectionId) return;
  const nodes = state.graph.nodes.map((node) =>
    node.id === created.childId ? { ...node, parentId: created.id, outlineOrder: 0 } : node,
  );
  const fresh: GraphNode = {
    id: created.id,
    name: created.name,
    description: '',
    kind: 'text',
    x: null,
    y: null,
    z: null,
    imageWidth: null,
    assetId: null,
    cardCount: 0,
    cardTypes: [],
    parentId: created.parentId,
    outlineOrder: created.outlineOrder,
    layoutSide: null,
  };
  state.graph = { ...state.graph, outlineVersion: created.outlineVersion, nodes: [...nodes, fresh] };
}

export async function insertParent(
  state: LibraryState,
  collectionId: string,
  body: InsertParentBody,
): Promise<InsertParentResult | null> {
  state.error = '';
  const res = await apiSend(`/api/collections/${collectionId}/outline/parent`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res) {
    state.error = '网络没有连上';
    return null;
  }
  const created = await apiRead(state, res, (data) => insertParentResultSchema.parse(data), '父主题没有建成');
  if (!created) return null;
  adoptInsertedParent(state, collectionId, created);
  bumpCount(state, collectionId, 1);
  return created;
}

export async function putOutline(
  state: LibraryState,
  collectionId: string,
  expectedVersion: number,
  items: OutlineItem[],
): Promise<OutlineWrite> {
  state.error = '';
  const res = await apiSend(`/api/collections/${collectionId}/outline`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedVersion, items }),
  });
  const result = await readVersion(state, res, '大纲没有改成');
  if (result.ok) paintItems(state, collectionId, items, result.outlineVersion);
  return result;
}

export async function restoreOutline(
  state: LibraryState,
  collectionId: string,
  body: RestoreOutlineBody,
): Promise<OutlineWrite> {
  state.error = '';
  const res = await apiSend(`/api/collections/${collectionId}/outline/restore`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await readVersion(state, res, '没有恢复');
  if (result.ok && state.graphId === collectionId) {
    state.graph = { ...state.graph, outlineVersion: result.outlineVersion };
  }
  return result;
}

export async function removeMember(
  state: LibraryState,
  collectionId: string,
  nodeId: string,
  expectedVersion?: number,
): Promise<OutlineWrite> {
  state.error = '';
  const query = expectedVersion === undefined ? '' : `?expectedVersion=${expectedVersion}`;
  const res = await apiSend(`/api/collections/${collectionId}/members/${nodeId}${query}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const result = await readVersion(state, res, '没有移出');
  if (result.ok) paintRemoval(state, collectionId, nodeId, result.outlineVersion);
  return result;
}
