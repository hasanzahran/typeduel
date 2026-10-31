import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CatalogError,
  ReviewedManifestSchema,
  loadReviewedCatalog,
  type ReviewedManifest,
} from '../../src/words/catalog.js';

const compatibilityFixture = new URL(
  '../../../../tests/fixtures/catalog-manifest-v1.json',
  import.meta.url,
);
const temporary = new Set<string>();

async function fixtureManifest(): Promise<ReviewedManifest> {
  return ReviewedManifestSchema.parse(
    JSON.parse(await readFile(compatibilityFixture, 'utf8')),
  );
}

async function materialize() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'typeduel-catalog-')),
  );
  temporary.add(directory);
  const assetRoot = join(directory, 'assets');
  await mkdir(assetRoot);
  const manifest = await fixtureManifest();
  const original = new Map<string, Buffer>();
  for (const [index, entry] of manifest.entries.entries()) {
    const data = Buffer.from(`reviewed-test-audio-${index + 1}`);
    const hash = createHash('sha256').update(data).digest('hex');
    entry.asset.byteLength = data.length;
    entry.asset.sha256 = hash;
    entry.asset.listening.sha256 = hash;
    const parent = join(assetRoot, entry.asset.assetId);
    await mkdir(parent);
    await writeFile(join(assetRoot, entry.asset.path), data);
    original.set(`${entry.asset.assetId}/${entry.asset.audioVersion}`, data);
  }
  const manifestPath = join(directory, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { directory, assetRoot, manifestPath, manifest, original };
}

afterEach(async () => {
  await Promise.all(
    [...temporary].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  temporary.clear();
});

describe('reviewed private catalog', () => {
  it('validates the exact shared compatibility fixture', async () => {
    const parsed = await fixtureManifest();
    expect(parsed.entries).toHaveLength(8);
    expect(parsed.entries.every((entry) => entry.difficulty === 1)).toBe(true);
  });

  it('loads immutable metadata and serves only startup-verified byte snapshots', async () => {
    const fixture = await materialize();
    const catalog = await loadReviewedCatalog(fixture);
    expect(Object.isFrozen(catalog.metadata)).toBe(true);
    expect(Object.isFrozen(catalog.metadata.entries[0])).toBe(true);
    const entry = catalog.metadata.entries[0]!;
    const path = join(fixture.assetRoot, entry.asset.path);
    await writeFile(path, Buffer.from('replacement-after-startup'));
    const data = await catalog.reader.read({
      assetId: entry.asset.assetId,
      audioVersion: entry.asset.audioVersion,
    });
    expect(Buffer.from(data)).toEqual(
      fixture.original.get(
        `${entry.asset.assetId}/${entry.asset.audioVersion}`,
      ),
    );
    await expect(
      catalog.reader.read({
        assetId: entry.asset.assetId,
        audioVersion: fixture.manifest.entries[1]!.asset.audioVersion,
      }),
    ).rejects.toThrow(CatalogError);
  });

  it('rejects changed bytes and normalized answer collisions', async () => {
    const changed = await materialize();
    const first = changed.manifest.entries[0]!;
    await writeFile(
      join(changed.assetRoot, first.asset.path),
      Buffer.from('changed-reviewed-bytes'),
    );
    await expect(loadReviewedCatalog(changed)).rejects.toThrow(CatalogError);

    const collision = await materialize();
    collision.manifest.entries[1]!.allowedVariants = [
      collision.manifest.entries[0]!.canonicalText.toUpperCase(),
    ];
    await writeFile(collision.manifestPath, JSON.stringify(collision.manifest));
    await expect(loadReviewedCatalog(collision)).rejects.toThrow(CatalogError);
  });

  it('rejects symlink traversal and reviewed files carrying ID3 metadata', async () => {
    const escaped = await materialize();
    const entry = escaped.manifest.entries[0]!;
    const originalDirectory = join(escaped.assetRoot, entry.asset.assetId);
    const outsideDirectory = join(escaped.directory, 'outside');
    await mkdir(outsideDirectory);
    await writeFile(
      join(outsideDirectory, `${entry.asset.audioVersion}.mp3`),
      escaped.original.get(
        `${entry.asset.assetId}/${entry.asset.audioVersion}`,
      )!,
    );
    await rm(originalDirectory, { recursive: true });
    await symlink(outsideDirectory, originalDirectory, 'dir');
    await expect(loadReviewedCatalog(escaped)).rejects.toThrow(CatalogError);

    const tagged = await materialize();
    const taggedEntry = tagged.manifest.entries[0]!;
    const data = Buffer.from('ID3reviewed-test-audio');
    const hash = createHash('sha256').update(data).digest('hex');
    taggedEntry.asset.byteLength = data.length;
    taggedEntry.asset.sha256 = hash;
    taggedEntry.asset.listening.sha256 = hash;
    await writeFile(join(tagged.assetRoot, taggedEntry.asset.path), data);
    await writeFile(tagged.manifestPath, JSON.stringify(tagged.manifest));
    await expect(loadReviewedCatalog(tagged)).rejects.toThrow(CatalogError);
  });

  it('rejects unknown manifest fields, unsafe paths, and fewer than eight entries', async () => {
    const fixture = await materialize();
    const variants: unknown[] = [
      { ...fixture.manifest, unexpected: true },
      {
        ...fixture.manifest,
        entries: fixture.manifest.entries.slice(0, 7),
      },
      {
        ...fixture.manifest,
        entries: fixture.manifest.entries.map((entry, index) =>
          index === 0
            ? {
                ...entry,
                asset: { ...entry.asset, path: '../outside.mp3' },
              }
            : entry,
        ),
      },
    ];
    for (const manifest of variants) {
      await writeFile(fixture.manifestPath, JSON.stringify(manifest));
      await expect(loadReviewedCatalog(fixture)).rejects.toThrow(CatalogError);
    }
  });
});
