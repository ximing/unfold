export function shortLabel(label: string): string {
  const chars = [...label];
  if (chars.length <= 12) return label;
  return `${chars.slice(0, 11).join('')}…`;
}
