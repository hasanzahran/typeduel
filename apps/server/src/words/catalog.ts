import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { MAX_AUDIO_BYTES, MAX_AUDIO_DURATION_MS } from '@typeduel/contracts';
import { z } from 'zod';
import type { PrivateAssetReader } from '../audio/access.js';
import { normalizeAnswer } from '../game/rules.js';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const review = z.strictObject({
  status: z.literal('approved'),
  reviewedBy: z.string().trim().min(1).max(200),
  reviewedAt: z.iso.datetime(),
});
const spelling = z
  .string()
  .min(1)
  .max(120)
  .refine((value) => value.trim().length > 0)
  .refine((value) => value === value.normalize('NFC'));
const provider = z.strictObject({
  name: z.literal('amazon-polly'),
  voiceId: z.literal('Joanna'),
  engine: z.literal('neural'),
  languageCode: z.literal('en-US'),
  region: z.literal('us-east-1'),
  outputFormat: z.literal('mp3'),
  sampleRateHz: z.literal(24000),
});

export const ReviewedManifestSchema = z
  .strictObject({
    formatVersion: z.literal(1),
    catalogVersion: z.uuid(),
    languageCode: z.literal('en-US'),
    generationConfigHash: sha256,
    entries: z
      .array(
        z.strictObject({
          wordId: z.uuid(),
          canonicalText: spelling,
          allowedVariants: z.array(spelling).max(20),
          difficulty: z.literal(1),
          editorial: review,
          asset: z.strictObject({
            assetId: z.uuid(),
            audioVersion: z.uuid(),
            path: z.string().min(1).max(100),
            byteLength: z.number().int().positive().max(MAX_AUDIO_BYTES),
            clipDurationMs: z
              .number()
              .int()
              .positive()
              .max(MAX_AUDIO_DURATION_MS),
            sha256,
            provider,
            listening: review.extend({ sha256 }),
          }),
        }),
      )
      .length(8),
  })
  .superRefine((manifest, context) => {
    const wordIds = new Set<string>();
    const assetIds = new Set<string>();
    const audioVersions = new Set<string>();
    const answers = new Set<string>();
    const fail = (message: string) =>
      context.addIssue({ code: 'custom', message });
    for (const entry of manifest.entries) {
      const asset = entry.asset;
      if (
        wordIds.has(entry.wordId) ||
        assetIds.has(asset.assetId) ||
        audioVersions.has(asset.audioVersion)
      )
        fail('Duplicate reviewed catalog identity');
      wordIds.add(entry.wordId);
      assetIds.add(asset.assetId);
      audioVersions.add(asset.audioVersion);
      if (
        asset.path !== `${asset.assetId}/${asset.audioVersion}.mp3` ||
        asset.sha256 !== asset.listening.sha256
      )
        fail('Invalid reviewed asset identity');
      for (const answer of [entry.canonicalText, ...entry.allowedVariants]) {
        const normalized = normalizeAnswer(answer);
        if (answers.has(normalized)) fail('Conflicting reviewed spelling');
        answers.add(normalized);
      }
    }
  });

export type ReviewedManifest = z.infer<typeof ReviewedManifestSchema>;
export type ReviewedEntry = ReviewedManifest['entries'][number];
export interface ReviewedCatalog {
  readonly metadata: ReviewedManifest;
  readonly reader: PrivateAssetReader;
}

export class CatalogError extends Error {
  constructor() {
    super('Reviewed audio catalog unavailable');
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

async function boundedRead(path: string, limit: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > limit)
      throw new CatalogError();
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        offset,
        buffer.length - offset,
        null,
      );
      if (bytesRead === 0) throw new CatalogError();
      offset += bytesRead;
    }
    if ((await file.stat()).size !== stat.size) throw new CatalogError();
    return buffer;
  } finally {
    await file.close();
  }
}

/** Load and snapshot the complete reviewed set once at process startup. */
export async function loadReviewedCatalog(options: {
  manifestPath: string;
  assetRoot: string;
}): Promise<ReviewedCatalog> {
  try {
    const manifestPath = resolve(options.manifestPath);
    const configuredRoot = resolve(options.assetRoot);
    const rootStat = await lstat(configuredRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
      throw new CatalogError();
    const root = await realpath(configuredRoot);
    if (root !== configuredRoot) throw new CatalogError();
    const parsed = ReviewedManifestSchema.parse(
      JSON.parse((await boundedRead(manifestPath, 65_536)).toString('utf8')),
    );
    const bytes = new Map<string, Buffer>();
    for (const entry of parsed.entries) {
      const asset = entry.asset;
      const directory = resolve(root, asset.assetId);
      const path = resolve(root, asset.path);
      if (!path.startsWith(`${root}${sep}`)) throw new CatalogError();
      const directoryStat = await lstat(directory);
      const fileStat = await lstat(path);
      if (
        !directoryStat.isDirectory() ||
        directoryStat.isSymbolicLink() ||
        !fileStat.isFile() ||
        fileStat.isSymbolicLink()
      )
        throw new CatalogError();
      const canonical = await realpath(path);
      if (canonical !== path || !canonical.startsWith(`${root}${sep}`))
        throw new CatalogError();
      const data = await boundedRead(path, MAX_AUDIO_BYTES);
      if (
        (await realpath(path)) !== canonical ||
        data.length !== asset.byteLength ||
        createHash('sha256').update(data).digest('hex') !== asset.sha256 ||
        data.subarray(0, 3).toString('ascii') === 'ID3' ||
        (data.length >= 128 &&
          data
            .subarray(data.length - 128, data.length - 125)
            .toString('ascii') === 'TAG')
      )
        throw new CatalogError();
      bytes.set(`${asset.assetId}/${asset.audioVersion}`, Buffer.from(data));
    }
    return {
      metadata: deepFreeze(parsed),
      reader: {
        async read(identity) {
          const data = bytes.get(
            `${identity.assetId}/${identity.audioVersion}`,
          );
          if (!data) throw new CatalogError();
          return Uint8Array.from(data);
        },
      },
    };
  } catch {
    throw new CatalogError();
  }
}
