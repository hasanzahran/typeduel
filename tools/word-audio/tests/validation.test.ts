import { describe, expect, it } from 'vitest';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { ManifestSchema } from '../src/manifest.js';
import { measurePcm, validateBytes } from '../src/validate-eight.js';
const fixture = JSON.parse(
  await readFile(
    new URL(
      '../../../tests/fixtures/catalog-manifest-v1.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
function pcm(frames = 24000) {
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24000, 24);
  bytes.writeUInt32LE(48000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 2, 40);
  return bytes;
}
describe('private manifest and decoded measurement', () => {
  it('shares the exact backend compatibility fixture without treating fake reviews as evidence', () => {
    expect(ManifestSchema.parse(fixture).entries).toHaveLength(8);
    for (const edit of [
      (v: typeof fixture) => {
        v.entries[1].canonicalText = v.entries[0].canonicalText.toUpperCase();
      },
      (v: typeof fixture) => {
        v.entries[0].asset.path = '../escape.mp3';
      },
      (v: typeof fixture) => {
        v.entries[0].asset.listening.sha256 = '0'.repeat(64);
      },
      (v: typeof fixture) => {
        v.entries[0].editorial.status = 'pending';
      },
      (v: typeof fixture) => {
        v.entries.pop();
      },
    ]) {
      const copy = structuredClone(fixture);
      edit(copy);
      expect(ManifestSchema.safeParse(copy).success).toBe(false);
    }
  });
  it('measures PCM frames and rounds up instead of trusting compressed duration', () => {
    expect(measurePcm(pcm())).toEqual({
      frames: 24000,
      sampleRate: 24000,
      durationMs: 1000,
    });
    expect(measurePcm(pcm(24001)).durationMs).toBe(1001);
    for (const change of [
      (b: Buffer) => b.writeUInt32LE(22050, 24),
      (b: Buffer) => b.writeUInt16LE(3, 20),
      (b: Buffer) => b.writeUInt16LE(1, 32),
      (b: Buffer) => b.writeUInt32LE(999999, 40),
    ]) {
      const b = pcm();
      change(b);
      expect(() => measurePcm(b)).toThrow();
    }
    expect(() => measurePcm(pcm(0))).toThrow();
    expect(() => measurePcm(pcm().subarray(0, 43))).toThrow();
  });
  it('checks actual immutable bytes and rejects changed files or escaped symlinks', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'typeduel-assets-test-'));
    const root = join(parent, 'root');
    await mkdir(root);
    try {
      for (const [i, entry] of fixture.entries.entries()) {
        const path = join(root, entry.asset.path);
        await mkdir(dirname(path));
        await writeFile(path, `TYPE_DUEL_PRIVATE_AUDIO_FIXTURE_${i + 1}`);
      }
      expect((await validateBytes(fixture, root)).entries).toHaveLength(8);
      const path = join(root, fixture.entries[0].asset.path);
      await writeFile(path, 'corrupt');
      await expect(validateBytes(fixture, root)).rejects.toThrow();
      await rm(path);
      await writeFile(
        join(parent, 'outside.mp3'),
        'TYPE_DUEL_PRIVATE_AUDIO_FIXTURE_1',
      );
      await symlink(join(parent, 'outside.mp3'), path);
      await expect(validateBytes(fixture, root)).rejects.toThrow();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
