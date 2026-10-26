import { describe, expect, it } from 'vitest';
import {
  accountSchema,
  defaultCanvasPrefs,
  errorBodySchema,
  loginBodySchema,
  registerBodySchema,
  usernameBodySchema,
  type Account,
  type ErrorBody,
  type LoginBody,
  type RegisterBody,
} from './index.js';

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

describe('registerBodySchema', () => {
  it('trims the username and enforces length rules', () => {
    const body = { username: '  西明  ', password: 'secret-8' } satisfies RegisterBody;
    expect(registerBodySchema.parse(body)).toEqual({ username: '西明', password: 'secret-8' });
    expect(registerBodySchema.safeParse({ username: 'a', password: 'secret-8' }).success).toBe(false);
    expect(registerBodySchema.safeParse({ username: 'a'.repeat(33), password: 'secret-8' }).success).toBe(false);
    expect(registerBodySchema.safeParse({ username: 'a b', password: 'secret-8' }).success).toBe(false);
    expect(registerBodySchema.safeParse({ username: 'ab', password: 'short' }).success).toBe(false);
    expect(registerBodySchema.safeParse({ username: 'ab', password: 's'.repeat(73) }).success).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(registerBodySchema.safeParse({ username: 'ab', password: 'secret-8', extra: 1 }).success).toBe(false);
  });
});

describe('usernameBodySchema', () => {
  it('validates a rename body', () => {
    expect(usernameBodySchema.parse({ username: ' 新名字 ' })).toEqual({ username: '新名字' });
    expect(usernameBodySchema.safeParse({ username: '' }).success).toBe(false);
  });
});

describe('accountSchema', () => {
  it('parses the account payload with a nullable avatar', () => {
    const body = { username: 'ximing', avatarUrl: null, canvas: defaultCanvasPrefs } satisfies Account;
    expect(accountSchema.parse(body)).toEqual(body);
    expect(accountSchema.safeParse({ username: 'ximing', avatarUrl: null }).success).toBe(false);
  });
});
