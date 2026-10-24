/** normalized_name：NFKC → trim → 连续空白折成一个空格 → 小写。 */

const WHITESPACE_RUN = /\s+/g;

export function normalizeName(name: string): string {
  return name.normalize('NFKC').trim().replace(WHITESPACE_RUN, ' ').toLowerCase();
}
