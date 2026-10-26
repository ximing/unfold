import { edgeAppearanceSchema, type EdgeAppearance } from '@unfold/dto';
import type { LibraryState } from './library.service.js';
import { apiSend, errorMessage } from './api.js';

const tickets = new WeakMap<LibraryState, number>();
const noted = new WeakMap<LibraryState, string>();

function note(state: LibraryState, message: string): false {
  noted.set(state, message);
  state.error = message;
  return false;
}

function clearNote(state: LibraryState): void {
  const message = noted.get(state);
  if (message !== undefined && state.error === message) state.error = '';
  noted.delete(state);
}

function sameAppearance(a: EdgeAppearance, b: EdgeAppearance): boolean {
  return a.dash === b.dash && a.width === b.width && a.color === b.color && a.arrow === b.arrow;
}

function revert(state: LibraryState, collectionId: string, sent: EdgeAppearance, previous: EdgeAppearance): void {
  if (state.graphId !== collectionId) return;
  // 服务把图包成可观察对象后，引用会变，按四项比较仍是这次写入。
  if (!sameAppearance(state.graph.appearance, sent)) return;
  state.graph = { ...state.graph, appearance: previous };
}

/** 立刻改当前图，再整份写入。过期响应不覆盖后一次编辑。不进入保存状态。 */
export async function saveAppearance(
  state: LibraryState,
  collectionId: string,
  next: EdgeAppearance,
): Promise<boolean> {
  if (state.graphId !== collectionId) return false;
  const previous = state.graph.appearance;
  state.graph = { ...state.graph, appearance: next };
  const ticket = (tickets.get(state) ?? 0) + 1;
  tickets.set(state, ticket);
  const res = await apiSend(`/api/collections/${collectionId}/appearance`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(next),
  });
  if ((tickets.get(state) ?? 0) !== ticket) return false;
  if (state.graphId !== collectionId) return false;
  if (!res) {
    revert(state, collectionId, next, previous);
    return note(state, '网络没有连上');
  }
  if (!res.ok) {
    const message = await errorMessage(res, '连线外观没有保存');
    revert(state, collectionId, next, previous);
    return note(state, message);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    revert(state, collectionId, next, previous);
    return note(state, '响应没法读取');
  }
  if ((tickets.get(state) ?? 0) !== ticket || state.graphId !== collectionId) return false;
  const parsed = edgeAppearanceSchema.safeParse(data);
  if (!parsed.success) {
    revert(state, collectionId, next, previous);
    return note(state, '响应没法读取');
  }
  state.graph = { ...state.graph, appearance: parsed.data };
  clearNote(state);
  return true;
}
