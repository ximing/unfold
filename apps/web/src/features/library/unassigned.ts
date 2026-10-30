import { unassignedNodesSchema, type UnassignedNode } from '@unfold/dto';
import { apiSend } from './api.js';

export async function fetchUnassigned(
  cursor?: string,
): Promise<{ ok: true; nodes: UnassignedNode[]; nextCursor: string | null } | { ok: false }> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  const res = await apiSend(`/api/unassigned-nodes${query === '' ? '' : `?${query}`}`, { credentials: 'include' });
  if (!res?.ok) return { ok: false };
  try {
    const body = unassignedNodesSchema.parse(await res.json());
    return { ok: true, nodes: body.nodes, nextCursor: body.nextCursor };
  } catch {
    return { ok: false };
  }
}
