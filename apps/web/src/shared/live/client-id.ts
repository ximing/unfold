const storageKey = 'unfold-client';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let cached = '';

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** 这一页的标识。同一账号的其它页靠它忽略自己刚写下去的通知。 */
export function clientId(): string {
  if (cached !== '') return cached;
  const box = storage();
  const existing = box?.getItem(storageKey) ?? '';
  if (uuidPattern.test(existing)) {
    cached = existing;
    return cached;
  }
  cached = crypto.randomUUID();
  try {
    box?.setItem(storageKey, cached);
  } catch {
    // 隐私模式写不进会话存储时，这一页仍用内存里的标识。
  }
  return cached;
}
