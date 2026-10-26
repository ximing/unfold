import { describe, expect, it } from 'vitest';
import { liveClient, shouldPublish } from './notice.js';

describe('变更通知', () => {
  it('写入成功才通知，登录和读取不通知', () => {
    expect(shouldPublish('POST', '/api/collections', 201)).toBe(true);
    expect(shouldPublish('PATCH', '/api/nodes/x', 200)).toBe(true);
    expect(shouldPublish('DELETE', '/api/cards/x', 204)).toBe(true);
    expect(shouldPublish('GET', '/api/library', 200)).toBe(false);
    expect(shouldPublish('POST', '/api/login', 200)).toBe(false);
    expect(shouldPublish('POST', '/api/logout', 204)).toBe(false);
    expect(shouldPublish('PATCH', '/api/me/username', 200)).toBe(false);
    expect(shouldPublish('POST', '/api/collections', 400)).toBe(false);
  });

  it('没有合法的页标识时用固定值', () => {
    expect(liveClient(undefined)).toBe('00000000-0000-4000-8000-000000000000');
    expect(liveClient('not-a-uuid')).toBe('00000000-0000-4000-8000-000000000000');
    const id = '550e8400-e29b-41d4-a716-446655440000';
    expect(liveClient(id)).toBe(id);
  });
});
