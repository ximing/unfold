export const COLLECTION_VIEW_KEY = 'unfold.collection-view.v1';

export type CollectionViewMode = 'outline' | 'board';

export function parseCollectionViews(raw: string | null): Record<string, CollectionViewMode> {
  if (!raw) return {};
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const views: Record<string, CollectionViewMode> = {};
    for (const [id, value] of Object.entries(data)) {
      if (value === 'outline' || value === 'board') views[id] = value;
    }
    return views;
  } catch {
    return {};
  }
}

export function collectionViewFor(
  views: Record<string, CollectionViewMode>,
  collectionId: string,
): CollectionViewMode {
  return views[collectionId] ?? 'board';
}

export function withCollectionView(
  views: Record<string, CollectionViewMode>,
  collectionId: string,
  mode: CollectionViewMode,
): Record<string, CollectionViewMode> {
  return { ...views, [collectionId]: mode };
}

export function readCollectionView(collectionId: string): CollectionViewMode {
  try {
    return collectionViewFor(parseCollectionViews(localStorage.getItem(COLLECTION_VIEW_KEY)), collectionId);
  } catch {
    return 'board';
  }
}

export function writeCollectionView(collectionId: string, mode: CollectionViewMode): void {
  try {
    const next = withCollectionView(
      parseCollectionViews(localStorage.getItem(COLLECTION_VIEW_KEY)),
      collectionId,
      mode,
    );
    localStorage.setItem(COLLECTION_VIEW_KEY, JSON.stringify(next));
  } catch {
    // 存不了时只影响这一次打开
  }
}
