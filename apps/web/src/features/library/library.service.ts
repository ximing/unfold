import { Service } from '@rabjs/react';
import type {
  Card,
  Collection,
  CollectionEdgeDetail,
  CollectionGraph,
  CreateCardBody,
  Edge,
  EdgeDetail,
  Library,
  LibraryCollection,
  Node,
  NodeDetail,
  SearchHit,
} from '@unfold/dto';
import { createCard, deleteCard, updateCard } from './cards.js';
import { createCollection, addMember, createNode, deleteCollection, loadCollections, removeMember, renameCollection } from './collections.js';
import {
  createCollectionEdge,
  deleteCollectionEdge,
  loadCollectionEdge,
  renameCollectionEdge,
} from './collection-edges.js';
import { createEdge, deleteEdge, loadEdge, renameEdge } from './edges.js';
import { loadGraph, loadLibrary } from './graph.js';
import { clearPeek, deleteNode, describeNode, loadNode, loadPeek, renameNode } from './nodes.js';
import { savePlacements, type PlacementWrite } from './placements.js';
import { clearSearch, search } from './search.js';

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
  error: string;
  jobs: LibraryJobs;
};

export class LibraryService extends Service implements LibraryState {
  collections: LibraryCollection[] = [];
  libraryGraph: Library | null = null;
  graph: CollectionGraph = { nodes: [], edges: [] };
  graphId = '';
  nodeDetail: NodeDetail | null = null;
  edgeDetail: EdgeDetail | null = null;
  collectionEdgeDetail: CollectionEdgeDetail | null = null;
  peek: NodeDetail | null = null;
  searchHits: SearchHit[] = [];
  error = '';
  jobs: LibraryJobs = { graph: 0, node: 0, edge: 0, collectionEdge: 0, peek: 0, search: 0 };

  clearError(): void {
    this.error = '';
  }

  async loadCollections(): Promise<boolean> {
    return loadCollections(this);
  }

  async createCollection(title: string): Promise<Collection | null> {
    return createCollection(this, title);
  }

  async renameCollection(id: string, title: string): Promise<boolean> {
    return renameCollection(this, id, title);
  }

  async deleteCollection(id: string): Promise<boolean> {
    return deleteCollection(this, id);
  }

  async createNode(collectionId: string, name: string): Promise<Node | null> {
    return createNode(this, collectionId, name);
  }

  async addMember(collectionId: string, nodeId: string): Promise<boolean> {
    return addMember(this, collectionId, nodeId);
  }

  async removeMember(collectionId: string, nodeId: string): Promise<boolean> {
    return removeMember(this, collectionId, nodeId);
  }

  async loadLibrary(): Promise<boolean> {
    return loadLibrary(this);
  }

  async loadGraph(collectionId: string): Promise<boolean> {
    return loadGraph(this, collectionId);
  }

  async savePlacements(collectionId: string, placements: PlacementWrite[]): Promise<boolean> {
    return savePlacements(this, collectionId, placements);
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
    return renameNode(this, id, name);
  }

  async describeNode(id: string, description: string): Promise<boolean> {
    return describeNode(this, id, description);
  }

  async deleteNode(id: string): Promise<boolean> {
    return deleteNode(this, id);
  }

  async createEdge(fromId: string, toId: string, label: string): Promise<Edge | null> {
    return createEdge(this, fromId, toId, label);
  }

  async loadEdge(id: string): Promise<EdgeDetail | null> {
    return loadEdge(this, id);
  }

  async renameEdge(id: string, label: string): Promise<boolean> {
    return renameEdge(this, id, label);
  }

  async deleteEdge(id: string): Promise<boolean> {
    return deleteEdge(this, id);
  }

  async createCollectionEdge(fromId: string, toId: string, label: string): Promise<Edge | null> {
    return createCollectionEdge(this, fromId, toId, label);
  }

  async loadCollectionEdge(id: string): Promise<CollectionEdgeDetail | null> {
    return loadCollectionEdge(this, id);
  }

  async renameCollectionEdge(id: string, label: string): Promise<boolean> {
    return renameCollectionEdge(this, id, label);
  }

  async deleteCollectionEdge(id: string): Promise<boolean> {
    return deleteCollectionEdge(this, id);
  }

  async createCard(body: CreateCardBody): Promise<Card | null> {
    return createCard(this, body);
  }

  async updateCard(id: string, content: Card['content']): Promise<boolean> {
    return updateCard(this, id, content);
  }

  async deleteCard(id: string): Promise<boolean> {
    return deleteCard(this, id);
  }

  clearSearch(): void {
    clearSearch(this);
  }

  async search(query: string): Promise<void> {
    return search(this, query);
  }
}
