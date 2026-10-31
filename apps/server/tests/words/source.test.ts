import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  CatalogError,
  ReviewedManifestSchema,
  type ReviewedCatalog,
} from '../../src/words/catalog.js';
import { createReviewedSource } from '../../src/words/source.js';

async function catalog(): Promise<ReviewedCatalog> {
  const metadata = ReviewedManifestSchema.parse(
    JSON.parse(
      await readFile(
        new URL(
          '../../../../tests/fixtures/catalog-manifest-v1.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ),
  );
  return {
    metadata,
    reader: {
      async read() {
        return Uint8Array.from([1]);
      },
    },
  };
}

describe('reviewed M1 round source', () => {
  it('allows only General Classic Level 1 with the exact eight-entry set', async () => {
    const source = createReviewedSource({
      catalog: await catalog(),
      publicOrigin: 'https://api.example',
    });
    expect(
      await source.checkAvailability({
        mode: 'classic',
        categorySlug: 'general',
        difficulty: 1,
      }),
    ).toBe(true);
    for (const setup of [
      { mode: 'classic', categorySlug: 'general', difficulty: 2 },
      { mode: 'classic', categorySlug: 'animals', difficulty: 1 },
      { mode: 'challenge', categorySlug: 'general' },
    ] as const)
      expect(await source.checkAvailability(setup)).toBe(false);
  });

  it('selects the only unused reviewed entry without exposing a semantic URL', async () => {
    const reviewed = await catalog();
    const source = createReviewedSource({
      catalog: reviewed,
      publicOrigin: 'https://api.example',
    });
    const selected = reviewed.metadata.entries[7]!;
    const round = await source.nextRound({
      matchId: '00000000-0000-4000-8000-000000000999',
      setup: {
        mode: 'classic',
        categorySlug: 'general',
        difficulty: 1,
      },
      roundNumber: 8,
      level: 1,
      usedWordIds: reviewed.metadata.entries
        .slice(0, 7)
        .map((entry) => entry.wordId),
    });
    expect(round.wordId).toBe(selected.wordId);
    expect(round.audio).toMatchObject({
      assetId: selected.asset.assetId,
      audioVersion: selected.asset.audioVersion,
      url: `https://api.example/v1/audio/${selected.asset.assetId}/${selected.asset.audioVersion}`,
    });
    expect(round.audio.url).not.toContain(selected.canonicalText);
  });

  it('fails closed on depletion, an unsupported level, or an unsafe public origin', async () => {
    const reviewed = await catalog();
    const source = createReviewedSource({
      catalog: reviewed,
      publicOrigin: 'http://localhost:3000',
    });
    const base = {
      matchId: '00000000-0000-4000-8000-000000000999',
      setup: {
        mode: 'classic' as const,
        categorySlug: 'general' as const,
        difficulty: 1 as const,
      },
      roundNumber: 1,
    };
    await expect(
      source.nextRound({
        ...base,
        level: 1,
        usedWordIds: reviewed.metadata.entries.map((entry) => entry.wordId),
      }),
    ).rejects.toThrow(CatalogError);
    await expect(
      source.nextRound({ ...base, level: 2, usedWordIds: [] }),
    ).rejects.toThrow(CatalogError);
    expect(() =>
      createReviewedSource({
        catalog: reviewed,
        publicOrigin: 'http://public.example',
      }),
    ).toThrow('Invalid audio configuration');
  });
});
