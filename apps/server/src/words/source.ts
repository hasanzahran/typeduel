import { randomInt, randomUUID } from 'node:crypto';
import { validatePublicOrigin } from '../audio/access.js';
import type { RoundSource } from '../game/source.js';
import { CatalogError, type ReviewedCatalog } from './catalog.js';

export function createReviewedSource(options: {
  catalog: ReviewedCatalog;
  publicOrigin: string;
}): RoundSource {
  const origin = validatePublicOrigin(options.publicOrigin);
  const eligible = (setup: Parameters<RoundSource['checkAvailability']>[0]) =>
    setup.mode === 'classic' &&
    setup.difficulty === 1 &&
    setup.categorySlug === 'general';

  return {
    async checkAvailability(setup) {
      return eligible(setup) && options.catalog.metadata.entries.length === 8;
    },
    async nextRound(input) {
      if (!eligible(input.setup) || input.level !== 1) throw new CatalogError();
      const pool = options.catalog.metadata.entries.filter(
        (entry) => !input.usedWordIds.includes(entry.wordId),
      );
      if (pool.length === 0) throw new CatalogError();
      const selected = pool[randomInt(pool.length)]!;
      const asset = selected.asset;
      return {
        roundId: randomUUID(),
        wordId: selected.wordId,
        canonicalText: selected.canonicalText,
        acceptedVariants: [...selected.allowedVariants],
        level: 1,
        categorySlugs: [],
        audio: {
          assetId: asset.assetId,
          audioVersion: asset.audioVersion,
          url: `${origin}/v1/audio/${asset.assetId}/${asset.audioVersion}`,
          clipDurationMs: asset.clipDurationMs,
          sha256: asset.sha256,
        },
      };
    },
  };
}
