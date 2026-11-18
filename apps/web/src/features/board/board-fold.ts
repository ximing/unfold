export type FoldMember = {
  id: string;
  parentId: string | null;
  layoutSide?: 'left' | 'right' | null;
};

export type FoldLink = {
  fromId: string;
  toId: string;
};

/** 已在集合里就移除，否则加入。只动这一个 id。 */
export function toggleFold(folded: ReadonlySet<string>, id: string): string[] {
  if (folded.has(id)) return [...folded].filter((item) => item !== id);
  return [...folded, id];
}

function childMap(members: readonly FoldMember[]): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const member of members) {
    if (member.parentId === null) continue;
    const list = children.get(member.parentId);
    if (list) list.push(member.id);
    else children.set(member.parentId, [member.id]);
  }
  return children;
}

/** 不含自己。顺着 parentId 走，环上的点只计一次。 */
function descendantIds(id: string, members: readonly FoldMember[]): string[] {
  const children = childMap(members);
  const out: string[] = [];
  const seen = new Set<string>([id]);
  const stack = [...(children.get(id) ?? [])];
  for (let index = 0; index < stack.length; index += 1) {
    const current = stack[index];
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    out.push(current);
    const kids = children.get(current);
    if (kids) {
      for (const kid of kids) stack.push(kid);
    }
  }
  return out;
}

/**
 * 选中点已在集合里：把它和全部后代移出。
 * 不在集合里：把选中点和全部后代加入。
 */
export function branchFold(folded: ReadonlySet<string>, id: string, members: readonly FoldMember[]): string[] {
  const branch = [id, ...descendantIds(id, members)];
  if (folded.has(id)) {
    const drop = new Set(branch);
    return [...folded].filter((item) => !drop.has(item));
  }
  const next = [...folded];
  const have = new Set(folded);
  for (const item of branch) {
    if (have.has(item)) continue;
    have.add(item);
    next.push(item);
  }
  return next;
}

export function directChildCount(id: string, members: readonly Pick<FoldMember, 'parentId'>[]): number {
  let count = 0;
  for (const member of members) {
    if (member.parentId === id) count += 1;
  }
  return count;
}

/** 两侧时，自己或最近一个带 layoutSide 的祖先决定方向。根在右。 */
export function foldSide(
  direction: 'right' | 'left' | 'both',
  id: string,
  members: readonly FoldMember[],
): 'left' | 'right' {
  if (direction === 'left') return 'left';
  if (direction === 'right') return 'right';
  const byId = new Map(members.map((member) => [member.id, member]));
  let current: string | null = id;
  const seen = new Set<string>();
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const node = byId.get(current);
    if (!node) break;
    if (node.layoutSide === 'left' || node.layoutSide === 'right') return node.layoutSide;
    current = node.parentId;
  }
  return 'right';
}

function hiddenByAncestor(
  id: string,
  parentOf: ReadonlyMap<string, string | null>,
  folded: ReadonlySet<string>,
  memberIds: ReadonlySet<string>,
): boolean {
  let parent = parentOf.get(id) ?? null;
  const seen = new Set<string>();
  while (parent !== null && !seen.has(parent)) {
    if (folded.has(parent)) return true;
    seen.add(parent);
    if (!memberIds.has(parent)) return false;
    parent = parentOf.get(parent) ?? null;
  }
  return false;
}

/** 这一帧的画线。折叠点自己仍可见，子孙换成最近的仍可见祖先。两端相同则不画。不改调用方原来的联系。 */
export function linksForFold<T extends FoldLink>(
  links: readonly T[],
  folded: ReadonlySet<string>,
  members: readonly FoldMember[],
): T[] {
  if (folded.size === 0) return [...links];
  const parentOf = new Map(members.map((member) => [member.id, member.parentId]));
  const memberIds = new Set(parentOf.keys());
  const cache = new Map<string, string>();
  const targetOf = (id: string): string => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    let current = id;
    const seen = new Set<string>();
    let resolved = id;
    while (!seen.has(current)) {
      seen.add(current);
      if (!memberIds.has(current) || !hiddenByAncestor(current, parentOf, folded, memberIds)) {
        resolved = current;
        break;
      }
      const parent = parentOf.get(current);
      if (parent == null) {
        resolved = current;
        break;
      }
      current = parent;
    }
    cache.set(id, resolved);
    return resolved;
  };
  const out: T[] = [];
  for (const link of links) {
    const fromId = targetOf(link.fromId);
    const toId = targetOf(link.toId);
    if (fromId === toId) continue;
    if (fromId === link.fromId && toId === link.toId) out.push(link);
    else out.push({ ...link, fromId, toId });
  }
  return out;
}
