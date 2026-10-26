import {
  collectionEdgeDetailSchema,
  collectionGraphSchema,
  edgeDetailSchema,
  librarySchema,
  nodeDetailSchema,
} from '@unfold/dto';
import type { LibraryState } from './library.service.js';
import { apiSend, mutationStamp } from './api.js';

export type SyncView =
  | { kind: 'library'; edgeId: string | null }
  | { kind: 'collection'; id: string; nodeId: string | null; edgeId: string | null };

const views = new WeakMap<LibraryState, SyncView | null>();
const tickets = { library: 0, graph: 0, node: 0, edge: 0, collectionEdge: 0 };

type Slot = keyof typeof tickets;
type Job = 'graph' | 'node' | 'edge' | 'collectionEdge';

type Gate = {
  slot: Slot;
  ticket: number;
  stamp: number;
  job: Job | null;
  jobs: number;
};

export function setSyncView(state: LibraryState, view: SyncView | null): void {
  views.set(state, view);
}

function readView(state: LibraryState): SyncView | null {
  return views.get(state) ?? null;
}

function openGate(state: LibraryState, slot: Slot, job: Job | null): Gate {
  const ticket = ++tickets[slot];
  return {
    slot,
    ticket,
    stamp: mutationStamp(),
    job,
    jobs: job === null ? 0 : state.jobs[job],
  };
}

function stale(state: LibraryState, gate: Gate): boolean {
  if (gate.ticket !== tickets[gate.slot]) return true;
  if (gate.stamp !== mutationStamp()) return true;
  if (gate.job !== null && gate.jobs !== state.jobs[gate.job]) return true;
  return false;
}

async function fetchJson(url: string): Promise<{ status: number; data: unknown } | null> {
  const res = await apiSend(url, { credentials: 'include' });
  if (!res) return null;
  try {
    return { status: res.status, data: await res.json() };
  } catch {
    return { status: res.status, data: null };
  }
}

function replace<T>(current: T, next: T, write: (value: T) => void): void {
  if (JSON.stringify(current) === JSON.stringify(next)) return;
  write(next);
}

async function pullLibrary(state: LibraryState): Promise<void> {
  const gate = openGate(state, 'library', null);
  const body = await fetchJson('/api/library');
  if (!body || stale(state, gate) || readView(state)?.kind !== 'library') return;
  const parsed = librarySchema.safeParse(body.data);
  if (!parsed.success) return;
  replace(state.libraryGraph, parsed.data, (value) => {
    state.libraryGraph = value;
  });
}

async function pullGraph(state: LibraryState, id: string): Promise<void> {
  const gate = openGate(state, 'graph', 'graph');
  const body = await fetchJson(`/api/collections/${id}/graph`);
  const view = readView(state);
  if (!body || stale(state, gate) || view?.kind !== 'collection' || view.id !== id) return;
  if (state.graphId !== id && state.graphId !== '') return;
  if (body.status === 404) return;
  const parsed = collectionGraphSchema.safeParse(body.data);
  if (!parsed.success) return;
  replace(state.graph, parsed.data, (value) => {
    state.graph = value;
  });
  if (state.graphId !== id) state.graphId = id;
}

async function pullNode(state: LibraryState, id: string): Promise<void> {
  const gate = openGate(state, 'node', 'node');
  const body = await fetchJson(`/api/nodes/${id}`);
  const view = readView(state);
  if (!body || stale(state, gate) || view?.kind !== 'collection' || view.nodeId !== id) return;
  if (body.status === 404) {
    if (state.nodeDetail?.id === id) state.nodeDetail = null;
    return;
  }
  const parsed = nodeDetailSchema.safeParse(body.data);
  if (!parsed.success) return;
  replace(state.nodeDetail, parsed.data, (value) => {
    state.nodeDetail = value;
  });
}

async function pullEdge(state: LibraryState, id: string): Promise<void> {
  const gate = openGate(state, 'edge', 'edge');
  const body = await fetchJson(`/api/edges/${id}`);
  const view = readView(state);
  if (!body || stale(state, gate) || view?.kind !== 'collection' || view.edgeId !== id) return;
  if (body.status === 404) {
    if (state.edgeDetail?.id === id) state.edgeDetail = null;
    return;
  }
  const parsed = edgeDetailSchema.safeParse(body.data);
  if (!parsed.success) return;
  replace(state.edgeDetail, parsed.data, (value) => {
    state.edgeDetail = value;
  });
}

async function pullCollectionEdge(state: LibraryState, id: string): Promise<void> {
  const gate = openGate(state, 'collectionEdge', 'collectionEdge');
  const body = await fetchJson(`/api/collection-edges/${id}`);
  const view = readView(state);
  if (!body || stale(state, gate) || view?.kind !== 'library' || view.edgeId !== id) return;
  if (body.status === 404) {
    if (state.collectionEdgeDetail?.id === id) state.collectionEdgeDetail = null;
    return;
  }
  const parsed = collectionEdgeDetailSchema.safeParse(body.data);
  if (!parsed.success) return;
  replace(state.collectionEdgeDetail, parsed.data, (value) => {
    state.collectionEdgeDetail = value;
  });
}

export async function pullView(state: LibraryState): Promise<void> {
  const view = readView(state);
  if (!view) return;
  if (view.kind === 'library') {
    await pullLibrary(state);
    const again = readView(state);
    if (again?.kind === 'library' && again.edgeId) await pullCollectionEdge(state, again.edgeId);
    return;
  }
  await pullGraph(state, view.id);
  const next = readView(state);
  if (next?.kind !== 'collection' || next.id !== view.id) return;
  if (next.nodeId) await pullNode(state, next.nodeId);
  if (next.edgeId) await pullEdge(state, next.edgeId);
}
