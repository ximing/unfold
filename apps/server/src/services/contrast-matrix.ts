export type ContrastSide = { canonicalName: string; coreStatement: string };
export type ContrastRelation = { type: string; distinction: string };
export type ContrastMatrixRow = { label: string; left: string; right: string };

export function contrastMatrix(
  left: ContrastSide,
  right: ContrastSide,
  relation: ContrastRelation,
): ContrastMatrixRow[] {
  if (relation.type !== 'contrasts') return [];
  return [
    { label: '核心陈述', left: left.coreStatement, right: right.coreStatement },
    { label: '区别', left: relation.distinction, right: relation.distinction },
  ];
}
