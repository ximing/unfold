import { z } from 'zod';

const nilClient = '00000000-0000-4000-8000-000000000000';

export function shouldPublish(method: string, url: string, status: number): boolean {
  if (status < 200 || status >= 300) return false;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  const path = url.split('?')[0] ?? '';
  if (!path.startsWith('/api/')) return false;
  if (path === '/api/login' || path === '/api/logout' || path === '/api/register') return false;
  if (path === '/api/me' || path.startsWith('/api/me/')) return false;
  return true;
}

export function liveClient(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (value && z.uuid().safeParse(value).success) return value;
  return nilClient;
}
