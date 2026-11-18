import {
  layoutBodySchema,
  memberSideBodySchema,
  mindmapAdoptResultSchema,
  mindmapCommitResultSchema,
  type LayoutDirection,
  type LayoutSide,
  type MindmapAdoptResult,
} from '@unfold/dto';
import type { LibraryState } from './library.service.js';
import { apiRead, apiSend, errorMessage } from './api.js';

const layoutTickets = new WeakMap<LibraryState, number>();
const sideTickets = new WeakMap<LibraryState, Map<string, number>>();

const COMMIT_FALLBACK = '旧位置还没记下来，没有重排';

export async function adoptCollectionMindmap(
  state: LibraryState,
  collectionId: string,
): Promise<MindmapAdoptResult | null> {
  state.error = '';
  const res = await apiSend(`/api/collections/${collectionId}/mindmap-adopt`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res) {
    state.error = '网络没有连上';
    return null;
  }
  const body = await apiRead(state, res, (data) => mindmapAdoptResultSchema.parse(data), COMMIT_FALLBACK);
  if (!body) return null;
  if (body.mindmapAnchored && state.graphId === collectionId) {
    state.graph = { ...state.graph, mindmapAnchored: true };
  }
  return body;
}

export async function commitCollectionMindmap(
  state: LibraryState,
  collectionId: string,
): Promise<'ok' | 'conflict' | 'fail'> {
  state.error = '';
  const res = await apiSend(`/api/collections/${collectionId}/mindmap-commit`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res) {
    state.error = '网络没有连上';
    return 'fail';
  }
  if (res.status === 409) {
    state.error = await errorMessage(res, COMMIT_FALLBACK);
    return 'conflict';
  }
  const body = await apiRead(state, res, (data) => mindmapCommitResultSchema.parse(data), COMMIT_FALLBACK);
  if (!body) return 'fail';
  if (state.graphId === collectionId) {
    state.graph = { ...state.graph, mindmapAnchored: true };
  }
  return 'ok';
}

function nextSideTicket(state: LibraryState, nodeId: string): number {
  let tickets = sideTickets.get(state);
  if (!tickets) {
    tickets = new Map();
    sideTickets.set(state, tickets);
  }
  const ticket = (tickets.get(nodeId) ?? 0) + 1;
  tickets.set(nodeId, ticket);
  return ticket;
}

/** 只确认服务端收下了朝向。左右由随后的读图带回，这里不写本地图。 */
export async function saveLayout(
  state: LibraryState,
  collectionId: string,
  direction: LayoutDirection,
): Promise<boolean> {
  if (state.graphId !== collectionId) return false;
  const ticket = (layoutTickets.get(state) ?? 0) + 1;
  layoutTickets.set(state, ticket);
  state.error = '';
  const res = await apiSend(`/api/collections/${collectionId}/layout`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ direction }),
  });
  if (layoutTickets.get(state) !== ticket || state.graphId !== collectionId) return false;
  if (!res) {
    state.error = '网络没有连上';
    return false;
  }
  if (!res.ok) {
    const message = await errorMessage(res, '朝向没有改成');
    if (layoutTickets.get(state) !== ticket) return false;
    state.error = message;
    return false;
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    if (layoutTickets.get(state) !== ticket) return false;
    state.error = '响应没法读取';
    return false;
  }
  if (layoutTickets.get(state) !== ticket || state.graphId !== collectionId) return false;
  if (!layoutBodySchema.safeParse(data).success) {
    state.error = '响应没法读取';
    return false;
  }
  return true;
}

/** 成功后只改这个点的 layoutSide。失败不改本地。 */
export async function saveMemberSide(
  state: LibraryState,
  collectionId: string,
  nodeId: string,
  side: LayoutSide,
): Promise<boolean> {
  if (state.graphId !== collectionId) return false;
  const ticket = nextSideTicket(state, nodeId);
  state.error = '';
  const res = await apiSend(`/api/collections/${collectionId}/members/${nodeId}/side`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ side }),
  });
  if (sideTickets.get(state)?.get(nodeId) !== ticket || state.graphId !== collectionId) return false;
  if (!res) {
    state.error = '网络没有连上';
    return false;
  }
  if (!res.ok) {
    const message = await errorMessage(res, '没有换到另一侧');
    if (sideTickets.get(state)?.get(nodeId) !== ticket) return false;
    state.error = message;
    return false;
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    if (sideTickets.get(state)?.get(nodeId) !== ticket) return false;
    state.error = '响应没法读取';
    return false;
  }
  if (sideTickets.get(state)?.get(nodeId) !== ticket || state.graphId !== collectionId) return false;
  const parsed = memberSideBodySchema.safeParse(data);
  if (!parsed.success) {
    state.error = '响应没法读取';
    return false;
  }
  if (!state.graph.nodes.some((node) => node.id === nodeId)) return false;
  state.graph = {
    ...state.graph,
    nodes: state.graph.nodes.map((node) => (node.id === nodeId ? { ...node, layoutSide: parsed.data.side } : node)),
  };
  return true;
}
