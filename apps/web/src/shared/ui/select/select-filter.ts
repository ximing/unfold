export function filterSelectOptions<T extends { label: string; value: string; keywords?: string }>(
  options: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return options.slice();
  return options.filter((option) => {
    if (option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle)) return true;
    const tokens = (option.keywords ?? '').toLowerCase().split(/\s+/).filter((token) => token !== '');
    // 短查询只认开头，避免 py 命中 copybook 这类词。
    return tokens.some((token) => (needle.length < 3 ? token.startsWith(needle) : token.includes(needle)));
  });
}
