import { z } from 'zod';
export const ModeSchema = z.enum(['classic', 'challenge']);
export const CategorySchema = z.enum([
  'general',
  'animals',
  'food',
  'sports',
  'technology',
]);
export const DifficultySchema = z.number().int().min(1).max(5);
export const MatchSetupSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('classic'),
    categorySlug: CategorySchema,
    difficulty: DifficultySchema,
  }),
  z.strictObject({
    mode: z.literal('challenge'),
    categorySlug: CategorySchema,
  }),
]);
export const QuickMatchSetupSchema = MatchSetupSchema.refine(
  (setup) => setup.categorySlug === 'general',
  { message: 'Quick Match uses General only', path: ['categorySlug'] },
);
export type Mode = z.infer<typeof ModeSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type MatchSetup = z.infer<typeof MatchSetupSchema>;
