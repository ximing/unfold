export function likePattern(query: string) {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export function clip(text: string) {
  return [...text].slice(0, 80).join('');
}

export function readable(cardText: string) {
  try {
    const value = JSON.parse(cardText) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const parts = Object.values(value).filter((item): item is string => typeof item === 'string');
      if (parts.length > 0) return stripTags(parts.join(' '));
    }
  } catch {
    return cardText;
  }
  return cardText;
}

/** 笔记存的是 HTML，摘录时去掉标签 */
export function stripTags(text: string) {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function snippetOf(name: string, cardText: string | null, query: string) {
  if (name.toLowerCase().includes(query.toLowerCase())) return clip(name);
  if (!cardText) return clip(name);
  return clip(readable(cardText));
}
