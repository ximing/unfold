import { describe, expect, it } from 'vitest';
import { errorBodySchema, loginBodySchema, type ErrorBody, type LoginBody } from './index.js';

describe('errorBodySchema', () => {
  it('parses the error envelope', () => {
    const body = { error: { code: 'unauthorized', message: '密码不对' } } satisfies ErrorBody;
    expect(errorBodySchema.parse(body)).toEqual(body);
  });
});

describe('loginBodySchema', () => {
  it('requires a username and a password', () => {
    const body = { username: 'ximing', password: 'secret' } satisfies LoginBody;
    expect(loginBodySchema.parse(body)).toEqual(body);
    expect(loginBodySchema.safeParse({ username: '', password: 'secret' }).success).toBe(false);
    expect(loginBodySchema.safeParse({ username: 'ximing', password: '' }).success).toBe(false);
  });
});
