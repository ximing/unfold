import { describe, expect, it } from 'vitest';
import { exportPackageSchema, type ExportPackage } from './index.js';

const minimal = {
  format: 'unfold-export',
  version: 1,
  domains: [],
  objects: [],
  documents: [],
  relations: [],
  collections: [],
} satisfies ExportPackage;

describe('exportPackageSchema', () => {
  it('parses a minimal package', () => {
    expect(exportPackageSchema.parse(minimal)).toEqual(minimal);
  });

  it('rejects a package missing format', () => {
    const payload: Record<string, unknown> = { ...minimal };
    delete payload.format;
    expect(exportPackageSchema.safeParse(payload).success).toBe(false);
  });
});
