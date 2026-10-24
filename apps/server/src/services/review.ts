import { createEmptyCard, fsrs, Rating, type Card } from 'ts-fsrs';

const scheduler = fsrs({ request_retention: 0.9, maximum_interval: 180 });

export type ReviewRating = 'fail' | 'partial' | 'with_hint' | 'independent' | 'saw_material';

export type ReviewEvent = {
  rating: ReviewRating;
  at: Date;
};

export type ReviewSnapshot = {
  stability: number;
  difficulty: number;
  dueAt: Date;
  reps: number;
  lapses: number;
};

function gradeOf(rating: Exclude<ReviewRating, 'saw_material'>): Rating.Again | Rating.Hard | Rating.Good {
  if (rating === 'fail') return Rating.Again;
  if (rating === 'independent') return Rating.Good;
  return Rating.Hard;
}

export function replayReviews(events: ReviewEvent[]): ReviewSnapshot | null {
  if (events.length === 0) return null;
  let card: Card = createEmptyCard(events[0].at);
  for (const event of events) {
    if (event.rating === 'saw_material') continue;
    card = scheduler.next(card, event.at, gradeOf(event.rating)).card;
  }
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    dueAt: card.due,
    reps: card.reps,
    lapses: card.lapses,
  };
}
