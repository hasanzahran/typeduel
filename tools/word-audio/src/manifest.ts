import { z } from 'zod';
export const WORDS = [
  'cat',
  'dog',
  'cup',
  'milk',
  'desk',
  'hand',
  'drum',
  'frog',
] as const;
export const PROVIDER = {
  name: 'amazon-polly',
  voiceId: 'Joanna',
  engine: 'neural',
  languageCode: 'en-US',
  region: 'us-east-1',
  outputFormat: 'mp3',
  sampleRateHz: 24000,
} as const;
export const MAX_BYTES = 1_048_576;
const Sha = z.string().regex(/^[a-f0-9]{64}$/);
const Review = z.strictObject({
  status: z.literal('approved'),
  reviewedBy: z.string().trim().min(1).max(200),
  reviewedAt: z.iso.datetime(),
});
const Provider = z.strictObject({
  name: z.literal('amazon-polly'),
  voiceId: z.literal('Joanna'),
  engine: z.literal('neural'),
  languageCode: z.literal('en-US'),
  region: z.literal('us-east-1'),
  outputFormat: z.literal('mp3'),
  sampleRateHz: z.literal(24000),
});
const Word = z
  .string()
  .min(1)
  .max(120)
  .refine(
    (value) => value.trim().length > 0 && value === value.normalize('NFC'),
  );
const normalize = (word: string) =>
  word.normalize('NFC').trim().toLowerCase().normalize('NFC');
export const ManifestSchema = z
  .strictObject({
    formatVersion: z.literal(1),
    catalogVersion: z.uuid(),
    languageCode: z.literal('en-US'),
    generationConfigHash: Sha,
    entries: z
      .array(
        z.strictObject({
          wordId: z.uuid(),
          canonicalText: Word,
          allowedVariants: z.array(Word).max(20),
          difficulty: z.literal(1),
          editorial: Review,
          asset: z.strictObject({
            assetId: z.uuid(),
            audioVersion: z.uuid(),
            path: z.string(),
            byteLength: z.number().int().positive().max(MAX_BYTES),
            sha256: Sha,
            clipDurationMs: z.number().int().positive().max(10000),
            provider: Provider,
            listening: Review.extend({ sha256: Sha }),
          }),
        }),
      )
      .length(8),
  })
  .superRefine((manifest, ctx) => {
    const words = new Set<string>(),
      ids = new Set<string>(),
      assets = new Set<string>();
    const versions = new Set<string>();
    for (const entry of manifest.entries) {
      const a = entry.asset;
      let invalid =
        ids.has(entry.wordId) ||
        assets.has(a.assetId) ||
        versions.has(a.audioVersion) ||
        a.path !== `${a.assetId}/${a.audioVersion}.mp3` ||
        a.listening.sha256 !== a.sha256;
      ids.add(entry.wordId);
      assets.add(a.assetId);
      versions.add(a.audioVersion);
      for (const word of [entry.canonicalText, ...entry.allowedVariants]) {
        const normalized = normalize(word);
        if (words.has(normalized)) invalid = true;
        words.add(normalized);
      }
      if (invalid)
        ctx.addIssue({ code: 'custom', message: 'Invalid reviewed manifest' });
    }
  });
export type Manifest = z.infer<typeof ManifestSchema>;
