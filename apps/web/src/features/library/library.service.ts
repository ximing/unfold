import { Service } from '@rabjs/react';
import type {
  Card,
  Collection,
  CollectionEdgeDetail,
  CollectionGraph,
  CreateCardBody,
  CreateInclusionBody,
  Edge,
  EdgeAppearance,
  EdgeDetail,
  CreateNodeResult,
  InclusionCandidates,
  Library,
  LibraryCollection,
  NodeDetail,
  OutlineItem,
  RestoreOutlineBody,
  SearchHit,
  UpdateInclusionBody,
} from '@unfold/dto';
import { defaultEdgeAppearance } from '@unfold/dto';
import { watchWrite } from '../../shared/save/save-bus.js';
import { saveAppearance } from './appearance.js';
import { createCard, deleteCard, updateCard } from './cards.js';
import { createCollection, addMember, createNode, deleteCollection, loadCollections, renameCollection } from './collections.js';
import {
  createCollectionEdge,
  deleteCollectionEdge,
  loadCollectionEdge,
  renameCollectionEdge,
} from './collection-edges.js';
import { createEdge, deleteEdge, loadEdge, renameEdge } from './edges.js';
import { loadGraph, loadLibrary } from './graph.js';
import { createInclusion, loadInclusionCandidates, removeInclusion, updateInclusion } from './inclusions.js';
import { putOutline, removeMember, restoreOutline, type OutlineWrite } from './outline.js';
import { clearPeek, deleteNode, describeNode, loadNode, loadPeek, renameNode } from './nodes.js';
import { savePlacements, type PlacementWrite } from './placements.js';
import { pullView, setSyncView, type SyncView } from './pull.js';
import { clearSearch, search, type SearchArgs } from './search.js';

export type LibraryJobs = {
  graph: number;
  node: number;
  edge: number;
  collectionEdge: number;
  peek: number;
  search: number;
};

export type LibraryState = {
  collections: LibraryCollection[];
  libraryGraph: Library | null;
  graph: CollectionGraph;
  graphId: string;
  nodeDetail: NodeDetail | null;
  edgeDetail: EdgeDetail | null;
  collectionEdgeDetail: CollectionEdgeDetail | null;
  peek: NodeDetail | null;
  searchHits: SearchHit[];
  searchCursor: string | null;
  searchError: string;
  searchLoading: boolean;
  error: string;
  jobs: LibraryJobs;
};

export class LibraryService extends Service implements LibraryState {
  collections: LibraryCollection[] = [];
  libraryGraph: Library | null = null;
  graph: CollectionGraph = {
    nodes: [],
    edges: [],
    bridges: [],
    inclusions: [],
    appearance: defaultEdgeAppearance,
    outlineVersion: 0,
  };
  graphId = '';
  nodeDetail: NodeDetail | null = null;
  edgeDetail: EdgeDetail | null = null;
  collectionEdgeDetail: CollectionEdgeDetail | null = null;
  peek: NodeDetail | null = null;
  searchHits: SearchHit[] = [];
  searchCursor: string | null = null;
  searchError = '';
  searchLoading = false;
  error = '';
  jobs: LibraryJobs = { graph: 0, node: 0, edge: 0, collectionEdge: 0, peek: 0, search: 0 };

  clearError(): void {
    this.error = '';
  }

  private write<T>(run: () => Promise<T>, ok: (value: T) => boolean): Promise<T> {
    return watchWrite(run, ok, () => (this.error === '' ? '没有保存' : this.error));
  }

  async loadCollections(): Promise<boolean> {
    return loadCollections(this);
  }

  async createCollection(title: string): Promise<Collection | null> {
    return createCollection(this, title);
  }

  async renameCollection(id: string, title: string): Promise<boolean> {
    return this.write(() => renameCollection(this, id, title), (ok) => ok);
  }

  async deleteCollection(id: string): Promise<boolean> {
    return deleteCollection(this, id);
  }

  async createNode(
    collectionId: string,
    name: string,
    place?: { parentId?: string | null; afterNodeId?: string },
  ): Promise<CreateNodeResult | null> {
    return this.write(() => createNode(this, collectionId, name, place), (node) => node !== null);
  }

  async addMember(collectionId: string, nodeId: string, parentId?: string | null) {
    return addMember(this, collectionId, nodeId, parentId);
  }

  async removeMember(collectionId: string, nodeId: string, expectedVersion?: number): Promise<OutlineWrite> {
    return this.write(() => removeMember(this, collectionId, nodeId, expectedVersion), (result) => result.ok);
  }

  async putOutline(collectionId: string, expectedVersion: number, items: OutlineItem[]): Promise<OutlineWrite> {
    return this.write(() => putOutline(this, collectionId, expectedVersion, items), (result) => result.ok);
  }

  async restoreOutline(collectionId: string, body: RestoreOutlineBody): Promise<OutlineWrite> {
    return this.write(() => restoreOutline(this, collectionId, body), (result) => result.ok);
  }

  async loadLibrary(): Promise<boolean> {
    return loadLibrary(this);
  }

  async loadGraph(collectionId: string): Promise<boolean> {
    return loadGraph(this, collectionId);
  }

  /** 改这个合集的连线外观。不进入未保存状态。 */
  async updateAppearance(collectionId: string, next: EdgeAppearance): Promise<boolean> {
    return saveAppearance(this, collectionId, next);
  }

  async savePlacements(collectionId: string, placements: PlacementWrite[]): Promise<boolean> {
    return this.write(() => savePlacements(this, collectionId, placements), (ok) => ok);
  }

  loadInclusionCandidates(collectionId: string): Promise<InclusionCandidates | null> {
    return loadInclusionCandidates(this, collectionId);
  }

  createInclusion(collectionId: string, body: CreateInclusionBody): Promise<boolean> {
    return this.write(() => createInclusion(this, collectionId, body), (ok) => ok);
  }

  updateInclusion(collectionId: string, childId: string, body: UpdateInclusionBody): Promise<boolean> {
    return this.write(() => updateInclusion(this, collectionId, childId, body), (ok) => ok);
  }

  removeInclusion(collectionId: string, childId: string): Promise<boolean> {
    return this.write(() => removeInclusion(this, collectionId, childId), (ok) => ok);
  }

  async loadNode(id: string): Promise<NodeDetail | null> {
    return loadNode(this, id);
  }

  async loadPeek(id: string): Promise<void> {
    return loadPeek(this, id);
  }

  clearPeek(): void {
    clearPeek(this);
  }

  async renameNode(id: string, name: string): Promise<boolean> {
    return this.write(() => renameNode(this, id, name), (ok) => ok);
  }

  async describeNode(id: string, description: string): Promise<boolean> {
    return this.write(() => describeNode(this, id, description), (ok) => ok);
  }

  async deleteNode(id: string): Promise<boolean> {
    return deleteNode(this, id);
  }

  async createEdge(fromId: string, toId: string, label: string): Promise<Edge | null> {
    return this.write(() => createEdge(this, fromId, toId, label), (edge) => edge !== null);
  }

  async loadEdge(id: string): Promise<EdgeDetail | null> {
    return loadEdge(this, id);
  }

  async renameEdge(id: string, label: string): Promise<boolean> {
    return this.write(() => renameEdge(this, id, label), (ok) => ok);
  }

  async deleteEdge(id: string): Promise<boolean> {
    return deleteEdge(this, id);
  }

  async createCollectionEdge(fromId: string, toId: string, label: string): Promise<Edge | null> {
    return this.write(
      () => createCollectionEdge(this, fromId, toId, label),
      (edge) => edge !== null,
    );
  }

  async loadCollectionEdge(id: string): Promise<CollectionEdgeDetail | null> {
    return loadCollectionEdge(this, id);
  }

  async renameCollectionEdge(id: string, label: string): Promise<boolean> {
    return this.write(() => renameCollectionEdge(this, id, label), (ok) => ok);
  }

  async deleteCollectionEdge(id: string): Promise<boolean> {
    return deleteCollectionEdge(this, id);
  }

  async createCard(body: CreateCardBody): Promise<Card | null> {
    return createCard(this, body);
  }

  async updateCard(id: string, content: Card['content']): Promise<boolean> {
    return this.write(() => updateCard(this, id, content), (ok) => ok);
  }

  async deleteCard(id: string): Promise<boolean> {
    return deleteCard(this, id);
  }

  clearSearch(): void {
    clearSearch(this);
  }

  async search(args: SearchArgs): Promise<void> {
    return search(this, args);
  }

  watchView(view: SyncView | null): void {
    setSyncView(this, view);
  }

  async pull(): Promise<void> {
    await pullView(this);
  }
}
