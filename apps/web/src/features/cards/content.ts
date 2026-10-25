import type { Card } from '@unfold/dto';

export function text(content: Card['content'], key: string): string {
  return content[key] ?? '';
}
