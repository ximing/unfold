import { describe, expect, it } from 'vitest';
import { independentLock, transferPracticeAllowed } from './evidence-rules.js';

const transferBlocked = '迁移练习还没开放：主点上还没有一条独立完成的非迁移证据。';

describe('independentLock', () => {
  it('does not lock when hintLevel is below the threshold', () => {
    expect(independentLock(2, 3)).toEqual({ locked: false, message: '' });
  });

  it('locks when hintLevel reaches the threshold', () => {
    const result = independentLock(3, 3);
    expect(result.locked).toBe(true);
    expect(result.message).toContain('第 3 级');
    expect(result.message).toContain('不能记为独立完成');
    expect(result.message).toBe('提示已经到第 3 级。这次不能记为独立完成。');
  });

  it('does not lock when the threshold is higher than hintLevel', () => {
    expect(independentLock(3, 4)).toEqual({ locked: false, message: '' });
  });
});

describe('transferPracticeAllowed', () => {
  it('allows a non-transfer kind regardless of sibling evidence', () => {
    expect(transferPracticeAllowed({ kind: 'explain', siblingHasIndependent: false })).toEqual({
      allowed: true,
      message: '',
    });
    expect(transferPracticeAllowed({ kind: 'explain', siblingHasIndependent: true })).toEqual({
      allowed: true,
      message: '',
    });
  });

  it('blocks transfer until a sibling has an independent non-transfer evidence', () => {
    expect(transferPracticeAllowed({ kind: 'transfer', siblingHasIndependent: false })).toEqual({
      allowed: false,
      message: transferBlocked,
    });
  });

  it('allows transfer when a sibling already has independent evidence', () => {
    expect(transferPracticeAllowed({ kind: 'transfer', siblingHasIndependent: true })).toEqual({
      allowed: true,
      message: '',
    });
  });
});
