import type { CreateInclusionBody, InclusionCandidates, UpdateInclusionBody } from '@unfold/dto';
import { inclusionCandidatesSchema } from '@unfold/dto';
import type { LibraryState } from './library.service.js';
import { apiDone, apiRead, apiSend, errorMessage } from './api.js';

export async function loadInclusionCandidates(
  state: LibraryState,
  collectionId: string,
): Promise<InclusionCandidates | null> {
  state.error = '';
  const res = await apiSend(`/api/collections/${collectionId}/inclusion-candidates`, {
    credentials: 'include',
  });
  if (!res) {
    state.error = '网络没有连上';
    return null;
  }
  return apiRead(state, res, (data) => inclusionCandidatesSchema.parse(data), '合集没有加载出来');
}

export async function createInclusion(
  state: LibraryState,
  collectionId: string,
  body: CreateInclusionBody,
): Promise<boolean> {
  state.error = '';
  const res = await apiSend(`/api/collections/${collectionId}/inclusions`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res) {
    state.error = '网络没有连上';
    return false;
  }
  return apiDone(state, res, '没有放进去');
}

export async function updateInclusion(
  state: LibraryState,
  parentId: string,
  childId: string,
  body: UpdateInclusionBody,
): Promise<boolean> {
  if (state.graphId !== parentId) return true;
  const before = state.graph;
  const known = state.graph.inclusions.some((item) => item.childId === childId);
  if (known) {
    state.graph = {
      ...state.graph,
      inclusions: state.graph.inclusions.map((item) => {
        if (item.childId !== childId) return item;
        return {
          ...item,
          x: body.x ?? item.x,
          y: body.y ?? item.y,
          collapsed: body.collapsed ?? item.collapsed,
        };
      }),
    };
  }
  const res = await apiSend(`/api/collections/${parentId}/inclusions/${childId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (state.graphId !== parentId) return true;
  if (!res) {
    if (known) state.graph = before;
    state.error = '网络没有连上';
    return false;
  }
  if (!res.ok) {
    if (known) state.graph = before;
    state.error = await errorMessage(res, '没有改成');
    return false;
  }
  return true;
}

export async function removeInclusion(
  state: LibraryState,
  parentId: string,
  childId: string,
): Promise<boolean> {
  state.error = '';
  const res = await apiSend(`/api/collections/${parentId}/inclusions/${childId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res) {
    state.error = '网络没有连上';
    return false;
  }
  const ok = await apiDone(state, res, '没有移出');
  if (!ok || state.graphId !== parentId) return ok;
  state.graph = {
    ...state.graph,
    inclusions: state.graph.inclusions.filter((item) => item.childId !== childId),
  };
  return true;
}
