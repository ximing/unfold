import type { Card } from '@unfold/dto';

export function text(content: Card['content'], key: string): string {
  if ('doc' in content) return '';
  const record = content as Record<string, string>;
  return record[key] ?? '';
}
