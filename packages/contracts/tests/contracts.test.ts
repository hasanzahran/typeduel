import { describe, expect, it } from 'vitest';
import {
  MatchSetupSchema,
  QuickMatchSetupSchema,
  HealthSchema,
} from '../src/index.js';
describe('public M0 contracts', () => {
  it('allows all five friend categories', () => {
    for (const categorySlug of [
      'general',
      'animals',
      'food',
      'sports',
      'technology',
    ])
      expect(
        MatchSetupSchema.safeParse({ mode: 'challenge', categorySlug }).success,
      ).toBe(true);
  });
  it('requires a Classic level between 1 and 5', () => {
    for (const difficulty of [undefined, 0, 6, 1.5])
      expect(
        MatchSetupSchema.safeParse({
          mode: 'classic',
          categorySlug: 'general',
          difficulty,
        }).success,
      ).toBe(false);
    expect(
      MatchSetupSchema.parse({
        mode: 'classic',
        categorySlug: 'general',
        difficulty: 5,
      }),
    ).toMatchObject({ difficulty: 5 });
  });
  it('rejects selected difficulty for Challenge', () => {
    expect(
      MatchSetupSchema.safeParse({
        mode: 'challenge',
        categorySlug: 'general',
        difficulty: 2,
      }).success,
    ).toBe(false);
  });
  it('rejects named categories in public setup', () => {
    expect(
      QuickMatchSetupSchema.safeParse({
        mode: 'challenge',
        categorySlug: 'animals',
      }).success,
    ).toBe(false);
    expect(
      QuickMatchSetupSchema.safeParse({
        mode: 'challenge',
        categorySlug: 'general',
      }).success,
    ).toBe(true);
  });
  it('rejects unknown fields and malformed health responses', () => {
    expect(
      MatchSetupSchema.safeParse({
        mode: 'challenge',
        categorySlug: 'general',
        canonicalText: 'forbidden',
      }).success,
    ).toBe(false);
    expect(HealthSchema.safeParse({ status: 'ok' }).success).toBe(false);
  });
});
