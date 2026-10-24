import { describe, expect, it } from 'vitest';
import { searchResponseSchema, type SearchResponse } from './index.js';

describe('searchResponseSchema', () => {
  it('parses two groups that share a title and differ by domain', () => {
    const body = {
      degraded: false,
      notice: '',
      groups: [
        {
          objectId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
          title: '状态',
          domain: '算法',
          core: '合并后的状态',
          hits: [
            {
              id: 'object:6ba7b810-9dad-11d1-80b4-00c04fd430c8',
              kind: 'object',
              text: '合并后的状态',
              promote: false,
            },
          ],
        },
        {
          objectId: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
          title: '状态',
          domain: 'Agent',
          core: '另一套状态',
          hits: [
            {
              id: 'object:6ba7b811-9dad-11d1-80b4-00c04fd430c8',
              kind: 'object',
              text: '另一套状态',
              promote: false,
            },
          ],
        },
      ],
    } satisfies SearchResponse;

    expect(searchResponseSchema.parse(body)).toEqual(body);
    expect(body.groups.map((group) => group.title)).toEqual(['状态', '状态']);
    expect(body.groups[0]?.domain).not.toBe(body.groups[1]?.domain);
  });
});
