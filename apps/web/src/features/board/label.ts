export function shortLabel(label: string): string {
  const chars = [...label];
  if (chars.length <= 12) return label;
  return `${chars.slice(0, 11).join('')}…`;
}

/** 关系标签的字号。和 `.bedge-label` 一致。 */
export const BRANCH_LABEL_FONT = 11;
/** 标签和点、折叠圆之间留出的空。 */
export const BRANCH_LABEL_PAD = 16;
const ASCII_LABEL_WIDTH = 6.6;

/** 画布上实际画出的那串字有多宽。超过 12 个字先按 shortLabel 截断。 */
export function shownLabelWidth(label: string): number {
  let width = 0;
  for (const ch of shortLabel(label)) {
    const code = ch.codePointAt(0) ?? 0;
    width += code <= 0xff ? ASCII_LABEL_WIDTH : BRANCH_LABEL_FONT;
  }
  return width;
}

/**
 * 每个父项到直接子项，在 levelGap 之外再加的像素。
 * 只算两端正好是这对父子的联系，两个方向都算，取最宽的一条。
 */
export function branchLevelExtra(
  nodes: readonly { id: string; parentId: string | null }[],
  links: readonly { fromId: string; toId: string; label: string }[],
): Map<string, number> {
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
  const extra = new Map<string, number>();
  for (const link of links) {
    const forward = parentOf.get(link.toId) === link.fromId;
    const back = parentOf.get(link.fromId) === link.toId;
    const parentId = forward ? link.fromId : back ? link.toId : null;
    if (!parentId) continue;
    const width = shownLabelWidth(link.label);
    if (width <= 0) continue;
    const need = Math.ceil(width) + BRANCH_LABEL_PAD;
    const prev = extra.get(parentId) ?? 0;
    if (need > prev) extra.set(parentId, need);
  }
  return extra;
}
