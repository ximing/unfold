export type OutlineReturn = {
  expanded: string[];
  selectedId: string | null;
  scrollTop: number;
};

export function outlineReturnKey(collectionId: string): string {
  return `unfold.outline-return.v1:${collectionId}`;
}

export function parseOutlineReturn(raw: string | null): OutlineReturn | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const record = data as { expanded?: unknown; selectedId?: unknown; scrollTop?: unknown };
    const expanded = Array.isArray(record.expanded)
      ? record.expanded.filter((id): id is string => typeof id === 'string')
      : [];
    const selectedId = typeof record.selectedId === 'string' ? record.selectedId : null;
    const scrollTop = typeof record.scrollTop === 'number' && Number.isFinite(record.scrollTop) ? record.scrollTop : 0;
    return { expanded, selectedId, scrollTop };
  } catch {
    return null;
  }
}

export function readOutlineReturn(collectionId: string): OutlineReturn | null {
  try {
    return parseOutlineReturn(sessionStorage.getItem(outlineReturnKey(collectionId)));
  } catch {
    return null;
  }
}

export function writeOutlineReturn(collectionId: string, value: OutlineReturn): void {
  try {
    sessionStorage.setItem(outlineReturnKey(collectionId), JSON.stringify(value));
  } catch {
    // 会话存不了就放弃这次定位
  }
}
