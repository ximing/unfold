export function rrf(
  lists: readonly (readonly string[])[],
  k = 60,
): { id: string; score: number }[] {
  if (k < 1) {
    throw new RangeError('k must be >= 1');
  }

  const scores = new Map<string, number>();

  for (const list of lists) {
    const seen = new Set<string>();
    for (let index = 0; index < list.length; index += 1) {
      const id = list[index];
      if (id === undefined || id === '' || seen.has(id)) {
        continue;
      }
      seen.add(id);
      const rank = index + 1;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.id.localeCompare(right.id);
    });
}
