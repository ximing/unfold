import { describe, expect, it } from 'vitest';
import { replayReviews, type ReviewEvent } from './review.js';

const day = 24 * 60 * 60 * 1000;
const t0 = new Date('2026-01-01T00:00:00.000Z');

function at(days: number): Date {
  return new Date(t0.getTime() + days * day);
}

describe('replayReviews', () => {
  it('returns null for an empty sequence', () => {
    expect(replayReviews([])).toBeNull();
  });

  it('returns the same dueAt when the same sequence is replayed twice', () => {
    const events: ReviewEvent[] = [
      { rating: 'independent', at: t0 },
      { rating: 'fail', at: at(3) },
      { rating: 'independent', at: at(4) },
    ];
    const first = replayReviews(events);
    const second = replayReviews(events);
    expect(first).not.toBeNull();
    expect(second!.dueAt.getTime()).toBe(first!.dueAt.getTime());
    expect(second).toEqual(first);
  });

  it('does not move dueAt or reps when a later event is saw_material', () => {
    const only = replayReviews([{ rating: 'independent', at: t0 }]);
    const withSaw = replayReviews([
      { rating: 'independent', at: t0 },
      { rating: 'saw_material', at: at(2) },
    ]);
    expect(withSaw!.dueAt.getTime()).toBe(only!.dueAt.getTime());
    expect(withSaw!.reps).toBe(only!.reps);
    expect(withSaw!.stability).toBe(only!.stability);
    expect(withSaw!.difficulty).toBe(only!.difficulty);
    expect(withSaw!.lapses).toBe(only!.lapses);
  });

  it('increases lapses when fail comes after independent', () => {
    const before = replayReviews([
      { rating: 'independent', at: t0 },
      { rating: 'independent', at: at(1) },
    ]);
    const after = replayReviews([
      { rating: 'independent', at: t0 },
      { rating: 'independent', at: at(1) },
      { rating: 'fail', at: at(3) },
    ]);
    expect(after!.lapses).toBeGreaterThan(before!.lapses);
  });
});
