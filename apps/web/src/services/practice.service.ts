import { Service } from '@rabjs/react';
import { capabilitySchema, errorBodySchema, evidenceSchema, type Capability } from '@unfold/dto';

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await res.json();
    return errorBodySchema.parse(body).error.message;
  } catch {
    return fallback;
  }
}

export class PracticeService extends Service {
  capability: Capability | null = null;
  error = '';
  note = '';
  dueAt = '';
  createdId = '';

  async load(id: string): Promise<void> {
    this.error = '';
    this.note = '';
    this.dueAt = '';
    this.createdId = '';
    this.capability = null;
    const res = await fetch(`/api/capabilities/${encodeURIComponent(id)}`, { credentials: 'include' });
    if (res.status === 401) {
      this.error = '未登录';
      return;
    }
    if (!res.ok) {
      this.error = await errorMessage(res, '没有这个能力');
      return;
    }
    this.capability = capabilitySchema.parse(await res.json());
  }

  async submit(input: {
    id: string;
    hintLevel: number;
    rating: 'independent' | 'with_hint' | 'partial' | 'fail';
    obstacle: string;
    body: string;
    mode: 'practice' | 'review';
  }): Promise<boolean> {
    this.error = '';
    const res = await fetch(`/api/capabilities/${encodeURIComponent(input.id)}/evidence`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: input.mode,
        hintLevel: input.hintLevel,
        rating: input.rating,
        obstacle: input.obstacle,
        body: input.body,
      }),
    });
    if (!res.ok) {
      this.error = await errorMessage(res, '这次没有记下');
      return false;
    }
    const evidence = evidenceSchema.parse(await res.json());
    this.dueAt = evidence.dueAt ?? '';
    this.note = '已记下';
    return true;
  }

  async saveFromObstacle(statement: string, primaryObjectId: string): Promise<boolean> {
    this.error = '';
    const res = await fetch('/api/capabilities', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ statement, kind: 'explain', primaryObjectId }),
    });
    if (!res.ok) {
      this.error = await errorMessage(res, '这句没有收成能力');
      return false;
    }
    const created = capabilitySchema.parse(await res.json());
    this.createdId = created.id;
    this.note = '已记下这条能力';
    return true;
  }
}
