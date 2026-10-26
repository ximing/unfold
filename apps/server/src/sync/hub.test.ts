import { describe, expect, it } from 'vitest';
import { openLive, publishLive } from './hub.js';

describe('变更转发', () => {
  it('只发给同一个账号的其它页', () => {
    const seen: string[] = [];
    const closeA = openLive('user-a', 'page-a', (text) => seen.push(`a:${text}`));
    const closeB = openLive('user-a', 'page-b', (text) => seen.push(`b:${text}`));
    const closeC = openLive('user-c', 'page-c', (text) => seen.push(`c:${text}`));

    publishLive('user-a', 'page-a');
    expect(seen).toEqual(['b:{"client":"page-a"}']);

    closeB();
    publishLive('user-a', 'page-a');
    expect(seen).toEqual(['b:{"client":"page-a"}']);
    closeA();
    closeC();
  });
});
