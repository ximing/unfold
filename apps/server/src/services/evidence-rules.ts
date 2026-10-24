export type EvidenceRating = 'fail' | 'partial' | 'with_hint' | 'independent' | 'saw_material';

export function independentLock(hintLevel: number, threshold: number): { locked: boolean; message: string } {
  if (hintLevel >= threshold) {
    return {
      locked: true,
      message: `提示已经到第 ${hintLevel} 级。这次不能记为独立完成。`,
    };
  }
  return { locked: false, message: '' };
}

export function transferPracticeAllowed(input: {
  kind: string;
  siblingHasIndependent: boolean;
}): { allowed: boolean; message: string } {
  if (input.kind !== 'transfer' || input.siblingHasIndependent) {
    return { allowed: true, message: '' };
  }
  return {
    allowed: false,
    message: '迁移练习还没开放：主点上还没有一条独立完成的非迁移证据。',
  };
}
