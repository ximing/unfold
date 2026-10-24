import { Service } from '@rabjs/react';
import {
  documentResponseSchema,
  domainListSchema,
  domainSchema,
  errorBodySchema,
  fanRelationListSchema,
  objectSummarySchema,
  relationSchema,
  searchResponseSchema,
  type CreateObjectBody,
  type CreateRelationBody,
  type DocumentResponse,
  type Domain,
  type FanRelation,
  type ObjectSummary,
  type Relation,
  type SearchGroup,
} from '@unfold/dto';

async function errorMessage(res: Response, fallback = '请求没有完成'): Promise<string> {
  try {
    const body: unknown = await res.json();
    return errorBodySchema.parse(body).error.message;
  } catch {
    return fallback;
  }
}

type ChainNodeView = {
  id: string;
  canonicalName: string;
  coreStatement: string;
};

type ChainEdgeView = {
  fromId: string;
  toId: string;
  whatChanged: string;
};

type ObjectChain = {
  type: 'evolves_from' | 'variant';
  nodes: ChainNodeView[];
  edges: ChainEdgeView[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function readChainNode(value: unknown): ChainNodeView | null {
  if (!isRecord(value)) return null;
  const { id, canonicalName, coreStatement } = value;
  if (typeof id !== 'string' || typeof canonicalName !== 'string' || typeof coreStatement !== 'string') {
    return null;
  }
  return { id, canonicalName, coreStatement };
}

function readChainEdge(value: unknown): ChainEdgeView | null {
  if (!isRecord(value)) return null;
  const { fromId, toId, whatChanged } = value;
  if (typeof fromId !== 'string' || typeof toId !== 'string' || typeof whatChanged !== 'string') {
    return null;
  }
  return { fromId, toId, whatChanged };
}

function readChain(value: unknown): ObjectChain | null {
  if (!isRecord(value)) return null;
  const { type, nodes, edges } = value;
  if (type !== 'evolves_from' && type !== 'variant') return null;
  if (!isUnknownArray(nodes) || !isUnknownArray(edges)) return null;
  const parsedNodes: ChainNodeView[] = [];
  for (const node of nodes) {
    const parsed = readChainNode(node);
    if (!parsed) return null;
    parsedNodes.push(parsed);
  }
  const parsedEdges: ChainEdgeView[] = [];
  for (const edge of edges) {
    const parsed = readChainEdge(edge);
    if (!parsed) return null;
    parsedEdges.push(parsed);
  }
  return { type, nodes: parsedNodes, edges: parsedEdges };
}

function readChains(value: unknown): ObjectChain[] | null {
  if (!isRecord(value) || !isUnknownArray(value.chains)) return null;
  const chains: ObjectChain[] = [];
  for (const item of value.chains) {
    const parsed = readChain(item);
    if (!parsed) return null;
    chains.push(parsed);
  }
  return chains;
}

export class LibraryService extends Service {
  domains: Domain[] = [];
  objects: ObjectSummary[] = [];
  current: ObjectSummary | null = null;
  relations: FanRelation[] = [];
  chains: ObjectChain[] = [];
  error = '';
  notice = '';
  private chainTicket = 0;
  searchGroups: SearchGroup[] = [];
  searchNotice = '';
  searchError = '';
  private searchTicket = 0;

  async loadDomains(): Promise<void> {
    this.error = '';
    const res = await fetch('/api/domains', { credentials: 'include' });
    if (!res.ok) {
      this.error = '领域没有加载出来';
      return;
    }
    this.domains = domainListSchema.parse(await res.json()).domains;
  }

  async createDomain(name: string): Promise<Domain | null> {
    this.error = '';
    const res = await fetch('/api/domains', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      this.error = await errorMessage(res);
      return null;
    }
    const domain = domainSchema.parse(await res.json());
    this.domains = [...this.domains, domain];
    return domain;
  }

  async createObject(body: CreateObjectBody): Promise<ObjectSummary | null> {
    this.error = '';
    const res = await fetch('/api/objects', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      this.error = await errorMessage(res);
      return null;
    }
    return objectSummarySchema.parse(await res.json());
  }

  async loadObjects(domainId: string): Promise<void> {
    this.error = '';
    this.objects = [];
    const res = await fetch(`/api/objects?domainId=${encodeURIComponent(domainId)}`, {
      credentials: 'include',
    });
    if (!res.ok) {
      this.error = await errorMessage(res);
      return;
    }
    try {
      const body = (await res.json()) as { objects?: unknown };
      this.objects = objectSummarySchema.array().parse(body.objects);
    } catch {
      this.objects = [];
      this.error = '点没有加载出来';
    }
  }

  async loadObject(id: string): Promise<void> {
    this.error = '';
    this.current = null;
    const res = await fetch(`/api/objects/${encodeURIComponent(id)}`, {
      credentials: 'include',
    });
    if (res.status === 404) {
      this.current = null;
      this.error = '没有这个点';
      return;
    }
    if (!res.ok) {
      this.error = await errorMessage(res);
      return;
    }
    this.current = objectSummarySchema.parse(await res.json());
  }

  // 文档接口可能还没部署；解析失败只返回 null，不把页面打崩。
  async loadDocument(id: string): Promise<DocumentResponse | null> {
    try {
      const res = await fetch(`/api/objects/${encodeURIComponent(id)}/doc`, {
        credentials: 'include',
      });
      if (!res.ok) return null;
      return documentResponseSchema.parse(await res.json());
    } catch {
      return null;
    }
  }

  async saveDocument(
    id: string,
    body: { schemaVersion: number; content: unknown; plainText: string },
  ): Promise<DocumentResponse | null> {
    this.error = '';
    const res = await fetch(`/api/objects/${encodeURIComponent(id)}/doc`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      this.error = await errorMessage(res);
      return null;
    }
    try {
      return documentResponseSchema.parse(await res.json());
    } catch {
      this.error = '保存结果无法读取';
      return null;
    }
  }

  async loadRelations(id: string): Promise<void> {
    this.error = '';
    try {
      const res = await fetch(`/api/objects/${encodeURIComponent(id)}/relations`, {
        credentials: 'include',
      });
      if (!res.ok) {
        this.error = await errorMessage(res, '连接没有加载出来');
        return;
      }
      this.relations = fanRelationListSchema.parse(await res.json()).relations;
    } catch {
      this.error = '连接没有加载出来';
    }
  }

  async loadChain(id: string): Promise<void> {
    const ticket = ++this.chainTicket;
    this.error = '';
    try {
      const res = await fetch(`/api/objects/${encodeURIComponent(id)}/chain`, {
        credentials: 'include',
      });
      if (ticket !== this.chainTicket) return;
      if (!res.ok) {
        const message = await errorMessage(res, '链没有加载出来');
        if (ticket !== this.chainTicket) return;
        this.error = message;
        this.chains = [];
        return;
      }
      const body: unknown = await res.json();
      if (ticket !== this.chainTicket) return;
      const chains = readChains(body);
      if (!chains) {
        this.chains = [];
        this.error = '链没有加载出来';
        return;
      }
      this.chains = chains;
    } catch {
      if (ticket !== this.chainTicket) return;
      this.chains = [];
      this.error = '链没有加载出来';
    }
  }

  async createRelation(body: CreateRelationBody): Promise<Relation | null> {
    this.error = '';
    const res = await fetch('/api/relations', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      this.error = await errorMessage(res);
      return null;
    }
    return relationSchema.parse(await res.json());
  }

  async search(q: string): Promise<void> {
    const ticket = ++this.searchTicket;
    this.searchError = '';
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { credentials: 'include' });
      if (ticket !== this.searchTicket) return;
      if (!res.ok) {
        this.searchGroups = [];
        this.searchNotice = '';
        this.searchError = await errorMessage(res, '检索没有完成');
        return;
      }
      const body = searchResponseSchema.parse(await res.json());
      if (ticket !== this.searchTicket) return;
      this.searchGroups = body.groups; // 原样保留，禁止按 title 合并
      this.searchNotice = body.notice;
      this.searchError = '';
    } catch {
      if (ticket !== this.searchTicket) return;
      this.searchGroups = [];
      this.searchNotice = '';
      this.searchError = '检索没有完成';
    }
  }

  clearSearch(): void {
    this.searchTicket += 1;
    this.searchGroups = [];
    this.searchNotice = '';
    this.searchError = '';
  }
}
