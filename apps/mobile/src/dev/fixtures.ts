// Presentation fixtures only. Not network snapshots or a local game engine.
export const fixtureMarker = 'TYPE_DUEL_M0_FIXTURE_SENTINEL';
export const sample = {
  opponent: 'Sam',
  wins: 24,
  matches: 39,
  winRate: '62%',
  score: { you: 1, opponent: 0 },
  result: { you: 3, opponent: 1 },
} as const;
export const categories = [
  { slug: 'general', label: 'General' },
  { slug: 'animals', label: 'Animals' },
  { slug: 'food', label: 'Food' },
  { slug: 'sports', label: 'Sports' },
  { slug: 'technology', label: 'Technology' },
] as const;
export const levels = ['Beginner', 'Easy', 'Medium', 'Hard', 'Expert'] as const;
export const scenarios = [
  'typing',
  'listening',
  'pending',
  'incorrect',
  'exhausted',
  'reconnecting',
  'audio-error',
] as const;
