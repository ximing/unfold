import { errorBodySchema } from '@unfold/dto';
import { clientId } from '../../shared/live/client-id.js';
import type { LibraryState } from './library.service.js';

let mutations = 0;

export function mutationStamp(): number {
  return mutations;
}

export async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    return errorBodySchema.parse(await res.json()).error.message;
  } catch {
    return fallback;
  }
}

/** 网络断开时返回 null。不写 error，避免过期请求盖住新请求。 */
export async function apiSend(input: string, init?: RequestInit): Promise<Response | null> {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') mutations += 1;
  const headers = new Headers(init?.headers);
  headers.set('x-unfold-client', clientId());
  try {
    return await fetch(input, { ...init, headers });
  } catch {
    return null;
  }
}

export async function apiRead<T>(
  state: LibraryState,
  res: Response,
  parse: (data: unknown) => T,
  fallback: string,
): Promise<T | null> {
  if (!res.ok) {
    state.error = await errorMessage(res, fallback);
    return null;
  }
  try {
    return parse(await res.json());
  } catch {
    state.error = '响应没法读取';
    return null;
  }
}

export async function apiDone(state: LibraryState, res: Response, fallback: string): Promise<boolean> {
  if (res.ok) return true;
  state.error = await errorMessage(res, fallback);
  return false;
}
