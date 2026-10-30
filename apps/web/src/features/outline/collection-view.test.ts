import { describe, expect, it } from 'vitest';
import { collectionViewFor, parseCollectionViews, withCollectionView } from './collection-view.js';

describe('collection view memory', () => {
  it('无记录是 board', () => {
    expect(collectionViewFor(parseCollectionViews(null), 'collection-1')).toBe('board');
    expect(collectionViewFor(parseCollectionViews('not-json'), 'collection-1')).toBe('board');
  });

  it('写入后是 outline', () => {
    const stored = JSON.stringify(withCollectionView(parseCollectionViews(null), 'collection-1', 'outline'));
    expect(collectionViewFor(parseCollectionViews(stored), 'collection-1')).toBe('outline');
    expect(collectionViewFor(parseCollectionViews(stored), 'collection-2')).toBe('board');
  });
});
