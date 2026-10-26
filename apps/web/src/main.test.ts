import { describe, expect, it } from 'vitest';
import mainSource from './main.tsx?raw';

describe('product routes', () => {
  it('mounts the library and collection pages and omits the retired fixture route', () => {
    const retiredRoute = ['paste', 'bench'].join('-');
    expect(mainSource).toContain('path="/library"');
    expect(mainSource).toContain('path="/c/:id"');
    expect(mainSource).toContain('path="/login"');
    expect(mainSource).toContain('path="/register"');
    expect(mainSource).toContain('<LibraryPage />');
    expect(mainSource).toContain('<CollectionPage />');
    expect(mainSource).not.toContain(retiredRoute);
    expect(mainSource).not.toContain(['Paste', 'Bench'].join(''));
  });
});
