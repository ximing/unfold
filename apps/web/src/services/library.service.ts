import { Service } from '@rabjs/react';
import {
  documentResponseSchema,
  domainListSchema,
  domainSchema,
  errorBodySchema,
  objectSummarySchema,
  type CreateObjectBody,
  type Domain,
  type ObjectSummary,
} from '@unfold/dto';

async function errorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    return errorBodySchema.parse(body).error.message;
  } catch {
    return '请求没有完成';
  }
}

export class LibraryService extends Service {
  domains: Domain[] = [];
  objects: ObjectSummary[] = [];
  current: ObjectSummary | null = null;
  error = '';
  notice = '';

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
  async loadDocument(id: string): Promise<{ plainText: string } | null> {
    try {
      const res = await fetch(`/api/objects/${encodeURIComponent(id)}/doc`, {
        credentials: 'include',
      });
      if (!res.ok) return null;
      const body = documentResponseSchema.parse(await res.json());
      return { plainText: body.plainText };
    } catch {
      return null;
    }
  }
}
