export function shortLabel(label: string): string {
  const chars = [...label];
  if (chars.length <= 12) return label;
  return `${chars.slice(0, 11).join('')}…`;
}

export function shortDesc(text: string): string {
  const chars = [...text];
  if (chars.length <= 20) return text;
  return `${chars.slice(0, 19).join('')}…`;
}
