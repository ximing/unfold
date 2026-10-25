import { Service } from '@rabjs/react';
import {
  cardSchema,
  collectionEdgeDetailSchema,
  collectionGraphSchema,
  collectionListSchema,
  collectionSchema,
  edgeDetailSchema,
  edgeSchema,
  errorBodySchema,
  librarySchema,
  nodeDetailSchema,
  nodeSchema,
  searchResponseSchema,
  type Card,
  type Collection,
  type CollectionEdgeDetail,
  type CollectionGraph,
  type CreateCardBody,
  type Edge,
  type EdgeDetail,
  type Library,
  type LibraryCollection,
  type Node,
  type NodeDetail,
  type SearchHit,
} from '@unfold/dto';

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    return errorBodySchema.parse(await res.json()).error.message;
  } catch {
    return fallback;
  }
}

export class LibraryService extends Service {
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

  private graphTicket = 0;
  private nodeTicket = 0;
  private edgeTicket = 0;
  private collectionEdgeTicket = 0;
  private peekTicket = 0;
  private searchTicket = 0;

  clearError(): void {
    this.error = '';
  }

  clearSearch(): void {
    this.searchHits = [];
    this.searchTicket += 1;
  }

  private async read<T>(res: Response, parse: (data: unknown) => T, fallback: string): Promise<T | null> {
    if (!res.ok) {
      this.error = await errorMessage(res, fallback);
      return null;
    }
    try {
      return parse(await res.json());
    } catch {
      this.error = '响应没法读取';
      return null;
    }
  }

  private async done(res: Response, fallback: string): Promise<boolean> {
    if (res.ok) return true;
    this.error = await errorMessage(res, fallback);
    return false;
  }

  async loadCollections(): Promise<boolean> {
    this.error = '';
    const res = await fetch('/api/collections', { credentials: 'include' });
    const body = await this.read(res, (data) => collectionListSchema.parse(data), '合集没有加载出来');
    if (!body) return false;
    this.collections = body.collections;
    return true;
  }

  async createCollection(title: string): Promise<Collection | null> {
    this.error = '';
    const res = await fetch('/api/collections', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const created = await this.read(res, (data) => collectionSchema.parse(data), '合集没有建成');
    if (!created) return null;
    this.collections = [
      ...this.collections.filter((item) => item.id !== created.id),
      { ...created, nodeCount: 0 },
    ];
    return created;
  }

  async renameCollection(id: string, title: string): Promise<boolean> {
    this.error = '';
    const res = await fetch(`/api/collections/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const next = await this.read(res, (data) => collectionSchema.parse(data), '标题没有改成');
    if (!next) return false;
    this.collections = this.collections.map((item) => (item.id === id ? { ...item, title: next.title } : item));
    if (this.libraryGraph) {
      this.libraryGraph = {
        ...this.libraryGraph,
        collections: this.libraryGraph.collections.map((item) =>
          item.id === id ? { ...item, title: next.title } : item,
        ),
      };
    }
    return true;
  }

  async deleteCollection(id: string): Promise<boolean> {
    this.error = '';
    const res = await fetch(`/api/collections/${id}`, { method: 'DELETE', credentials: 'include' });
    const ok = await this.done(res, '合集没有删掉');
    if (!ok) return false;
    this.collections = this.collections.filter((item) => item.id !== id);
    if (this.libraryGraph) {
      this.libraryGraph = {
        collections: this.libraryGraph.collections.filter((item) => item.id !== id),
        edges: this.libraryGraph.edges.filter((edge) => edge.fromId !== id && edge.toId !== id),
      };
    }
    return true;
  }

  async loadLibrary(): Promise<boolean> {
    this.error = '';
    const res = await fetch('/api/library', { credentials: 'include' });
    const body = await this.read(res, (data) => librarySchema.parse(data), '全貌没有加载出来');
    if (!body) return false;
    this.libraryGraph = body;
    return true;
  }

  async loadGraph(collectionId: string): Promise<boolean> {
    const ticket = ++this.graphTicket;
    this.error = '';
    const res = await fetch(`/api/collections/${collectionId}/graph`, { credentials: 'include' });
    if (ticket !== this.graphTicket) return false;
    if (!res.ok) {
      this.error = await errorMessage(res, '这个合集没有找到');
      this.graph = { nodes: [], edges: [] };
      this.graphId = collectionId;
      return false;
    }
    try {
      this.graph = collectionGraphSchema.parse(await res.json());
    } catch {
      this.error = '响应没法读取';
      return false;
    }
    this.graphId = collectionId;
    return true;
  }

  async createNode(collectionId: string, name: string): Promise<Node | null> {
    this.error = '';
    const res = await fetch(`/api/collections/${collectionId}/nodes`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return this.read(res, (data) => nodeSchema.parse(data), '点没有建成');
  }

  async addMember(collectionId: string, nodeId: string): Promise<boolean> {
    this.error = '';
    const res = await fetch(`/api/collections/${collectionId}/members`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    });
    return this.done(res, '没有放进去');
  }

  async removeMember(collectionId: string, nodeId: string): Promise<boolean> {
    this.error = '';
    const res = await fetch(`/api/collections/${collectionId}/members/${nodeId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    return this.done(res, '没有移出');
  }

  async loadNode(id: string): Promise<NodeDetail | null> {
    const ticket = ++this.nodeTicket;
    this.error = '';
    this.nodeDetail = null;
    const res = await fetch(`/api/nodes/${id}`, { credentials: 'include' });
    if (ticket !== this.nodeTicket) return null;
    const detail = await this.read(res, (data) => nodeDetailSchema.parse(data), '点没有找到');
    if (!detail || ticket !== this.nodeTicket) return null;
    this.nodeDetail = detail;
    return detail;
  }

  /** 悬停预览：不动 nodeDetail，失败静默 */
  async loadPeek(id: string): Promise<void> {
    const ticket = ++this.peekTicket;
    const res = await fetch(`/api/nodes/${id}`, { credentials: 'include' });
    if (ticket !== this.peekTicket || !res.ok) return;
    try {
      const detail = nodeDetailSchema.parse(await res.json());
      if (ticket !== this.peekTicket) return;
      this.peek = detail;
    } catch {
      // 预览失败不打断
    }
  }

  clearPeek(): void {
    this.peekTicket += 1;
    this.peek = null;
  }

  async renameNode(id: string, name: string): Promise<boolean> {
    this.error = '';
    const res = await fetch(`/api/nodes/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const next = await this.read(res, (data) => nodeSchema.parse(data), '名字没有改成');
    if (!next) return false;
    this.graph = {
      ...this.graph,
      nodes: this.graph.nodes.map((node) => (node.id === id ? { ...node, name: next.name } : node)),
    };
    if (this.nodeDetail?.id === id) this.nodeDetail = { ...this.nodeDetail, name: next.name };
    return true;
  }

  async describeNode(id: string, description: string): Promise<boolean> {
    this.error = '';
    const res = await fetch(`/api/nodes/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description }),
    });
    const next = await this.read(res, (data) => nodeSchema.parse(data), '描述没有改成');
    if (!next) return false;
    this.graph = {
      ...this.graph,
      nodes: this.graph.nodes.map((node) => (node.id === id ? { ...node, description } : node)),
    };
    if (this.nodeDetail?.id === id) this.nodeDetail = { ...this.nodeDetail, description };
    return true;
  }

  async deleteNode(id: string): Promise<boolean> {
    this.error = '';
    const res = await fetch(`/api/nodes/${id}`, { method: 'DELETE', credentials: 'include' });
    const ok = await this.done(res, '点没有删掉');
    if (!ok) return false;
    if (this.nodeDetail?.id === id) this.nodeDetail = null;
    return true;
  }

  async createEdge(fromId: string, toId: string, label: string): Promise<Edge | null> {
    this.error = '';
    const res = await fetch('/api/edges', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromId, toId, label }),
    });
    return this.read(res, (data) => edgeSchema.parse(data), '关系没有连上');
  }

  async loadEdge(id: string): Promise<EdgeDetail | null> {
    const ticket = ++this.edgeTicket;
    this.error = '';
    this.edgeDetail = null;
    const res = await fetch(`/api/edges/${id}`, { credentials: 'include' });
    if (ticket !== this.edgeTicket) return null;
    const detail = await this.read(res, (data) => edgeDetailSchema.parse(data), '关系没有找到');
    if (!detail || ticket !== this.edgeTicket) return null;
    this.edgeDetail = detail;
    return detail;
  }

  async renameEdge(id: string, label: string): Promise<boolean> {
    this.error = '';
    const res = await fetch(`/api/edges/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label }),
    });
    const next = await this.read(res, (data) => edgeSchema.parse(data), '关系说明没有改成');
    if (!next) return false;
    this.graph = {
      ...this.graph,
      edges: this.graph.edges.map((edge) => (edge.id === id ? { ...edge, label: next.label } : edge)),
    };
    if (this.edgeDetail?.id === id) this.edgeDetail = { ...this.edgeDetail, label: next.label };
    return true;
  }

  async deleteEdge(id: string): Promise<boolean> {
    this.error = '';
    const res = await fetch(`/api/edges/${id}`, { method: 'DELETE', credentials: 'include' });
    const ok = await this.done(res, '关系没有删掉');
    if (!ok) return false;
    if (this.edgeDetail?.id === id) this.edgeDetail = null;
    return true;
  }

  async createCollectionEdge(fromId: string, toId: string, label: string): Promise<Edge | null> {
    this.error = '';
    const res = await fetch('/api/collection-edges', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromId, toId, label }),
    });
    return this.read(res, (data) => edgeSchema.parse(data), '合集没有连上');
  }

  async loadCollectionEdge(id: string): Promise<CollectionEdgeDetail | null> {
    const ticket = ++this.collectionEdgeTicket;
    this.error = '';
    this.collectionEdgeDetail = null;
    const res = await fetch(`/api/collection-edges/${id}`, { credentials: 'include' });
    if (ticket !== this.collectionEdgeTicket) return null;
    const detail = await this.read(res, (data) => collectionEdgeDetailSchema.parse(data), '关系没有找到');
    if (!detail || ticket !== this.collectionEdgeTicket) return null;
    this.collectionEdgeDetail = detail;
    return detail;
  }

  async renameCollectionEdge(id: string, label: string): Promise<boolean> {
    this.error = '';
    const res = await fetch(`/api/collection-edges/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label }),
    });
    const next = await this.read(res, (data) => edgeSchema.parse(data), '关系说明没有改成');
    if (!next) return false;
    if (this.libraryGraph) {
      this.libraryGraph = {
        ...this.libraryGraph,
        edges: this.libraryGraph.edges.map((edge) => (edge.id === id ? { ...edge, label: next.label } : edge)),
      };
    }
    if (this.collectionEdgeDetail?.id === id) {
      this.collectionEdgeDetail = { ...this.collectionEdgeDetail, label: next.label };
    }
    return true;
  }

  async deleteCollectionEdge(id: string): Promise<boolean> {
    this.error = '';
    const res = await fetch(`/api/collection-edges/${id}`, { method: 'DELETE', credentials: 'include' });
    const ok = await this.done(res, '关系没有删掉');
    if (!ok) return false;
    if (this.collectionEdgeDetail?.id === id) this.collectionEdgeDetail = null;
    if (this.libraryGraph) {
      this.libraryGraph = {
        ...this.libraryGraph,
        edges: this.libraryGraph.edges.filter((edge) => edge.id !== id),
      };
    }
    return true;
  }

  async createCard(body: CreateCardBody): Promise<Card | null> {
    this.error = '';
    const res = await fetch('/api/cards', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this.read(res, (data) => cardSchema.parse(data), '卡片没有加上');
  }

  async updateCard(id: string, content: Card['content']): Promise<boolean> {
    this.error = '';
    const res = await fetch(`/api/cards/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const next = await this.read(res, (data) => cardSchema.parse(data), '卡片没有保存');
    if (!next) return false;
    this.replaceCard(next);
    return true;
  }

  async deleteCard(id: string): Promise<boolean> {
    this.error = '';
    const res = await fetch(`/api/cards/${id}`, { method: 'DELETE', credentials: 'include' });
    const ok = await this.done(res, '卡片没有删掉');
    if (!ok) return false;
    this.nodeDetail = this.nodeDetail
      ? { ...this.nodeDetail, cards: this.nodeDetail.cards.filter((card) => card.id !== id) }
      : null;
    this.edgeDetail = this.edgeDetail
      ? { ...this.edgeDetail, cards: this.edgeDetail.cards.filter((card) => card.id !== id) }
      : null;
    this.collectionEdgeDetail = this.collectionEdgeDetail
      ? {
          ...this.collectionEdgeDetail,
          cards: this.collectionEdgeDetail.cards.filter((card) => card.id !== id),
        }
      : null;
    return true;
  }

  async search(query: string): Promise<void> {
    const trimmed = query.trim();
    const ticket = ++this.searchTicket;
    if (trimmed === '') {
      this.searchHits = [];
      return;
    }
    this.error = '';
    const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { credentials: 'include' });
    if (ticket !== this.searchTicket) return;
    const body = await this.read(res, (data) => searchResponseSchema.parse(data), '没有搜到');
    if (!body || ticket !== this.searchTicket) return;
    this.searchHits = body.hits;
  }

  private replaceCard(next: Card): void {
    const swap = (cards: Card[]) => cards.map((card) => (card.id === next.id ? next : card));
    if (this.nodeDetail) this.nodeDetail = { ...this.nodeDetail, cards: swap(this.nodeDetail.cards) };
    if (this.edgeDetail) this.edgeDetail = { ...this.edgeDetail, cards: swap(this.edgeDetail.cards) };
    if (this.collectionEdgeDetail) {
      this.collectionEdgeDetail = { ...this.collectionEdgeDetail, cards: swap(this.collectionEdgeDetail.cards) };
    }
  }
}
