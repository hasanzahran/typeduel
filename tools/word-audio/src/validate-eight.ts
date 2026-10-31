import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ManifestSchema, MAX_BYTES, type Manifest } from './manifest.js';
const exec = promisify(execFile);
const sha = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const invalid = () => new Error('Audio validation failed');

/** Strict bounded PCM RIFF parsing: compressed header duration is never authoritative. */
export function measurePcm(wav: Buffer): {
  frames: number;
  sampleRate: number;
  durationMs: number;
} {
  if (
    wav.length < 12 ||
    wav.length > 2_000_000 ||
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE' ||
    wav.readUInt32LE(4) + 8 !== wav.length
  )
    throw invalid();
  let format: { sampleRate: number; alignment: number } | null = null;
  let data: number | null = null;
  let position = 12;
  while (position < wav.length) {
    if (position + 8 > wav.length) throw invalid();
    const tag = wav.toString('ascii', position, position + 4);
    const length = wav.readUInt32LE(position + 4);
    const start = position + 8,
      end = start + length;
    if (end > wav.length) throw invalid();
    if (tag === 'fmt ') {
      if (format || length < 16 || wav.readUInt16LE(start) !== 1)
        throw invalid();
      const channels = wav.readUInt16LE(start + 2),
        sampleRate = wav.readUInt32LE(start + 4);
      const alignment = wav.readUInt16LE(start + 12);
      if (
        channels < 1 ||
        channels > 2 ||
        sampleRate !== 24000 ||
        wav.readUInt16LE(start + 14) !== 16 ||
        alignment !== channels * 2 ||
        wav.readUInt32LE(start + 8) !== sampleRate * alignment
      )
        throw invalid();
      format = { sampleRate, alignment };
    } else if (tag === 'data') {
      if (data !== null || length === 0) throw invalid();
      data = length;
    }
    position = end + (length % 2);
    if (position > wav.length) throw invalid();
  }
  if (!format || data === null || data % format.alignment) throw invalid();
  const frames = data / format.alignment;
  const durationMs = Number(
    (BigInt(frames) * 1000n + BigInt(format.sampleRate) - 1n) /
      BigInt(format.sampleRate),
  );
  if (durationMs <= 0 || durationMs > 10000) throw invalid();
  return { frames, sampleRate: format.sampleRate, durationMs };
}

export async function validateBytes(
  raw: unknown,
  assetRoot: string,
): Promise<Manifest> {
  const manifest = ManifestSchema.parse(raw),
    root = await realpath(assetRoot);
  for (const { asset } of manifest.entries) {
    const file = await realpath(join(root, asset.path));
    const rel = relative(root, file);
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel))
      throw invalid();
    const metadata = await stat(file);
    if (
      !metadata.isFile() ||
      metadata.size !== asset.byteLength ||
      metadata.size > MAX_BYTES
    )
      throw invalid();
    const bytes = await readFile(file);
    if (
      bytes.length !== asset.byteLength ||
      sha(bytes) !== asset.sha256 ||
      bytes.subarray(0, 3).toString('ascii') === 'ID3' ||
      (bytes.length >= 128 &&
        bytes
          .subarray(bytes.length - 128, bytes.length - 125)
          .toString('ascii') === 'TAG')
    )
      throw invalid();
  }
  return manifest;
}

export async function decodeAndMeasure(file: string) {
  const metadata = await stat(file);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_BYTES)
    throw invalid();
  const original = await readFile(file);
  const directory = await mkdtemp(join(tmpdir(), 'typeduel-audio-'));
  try {
    // Private temporary output; never modify, resample or normalize the canonical MP3.
    await exec(
      '/bin/sh',
      [
        '-c',
        'ulimit -f 2048; exec /usr/bin/afconvert -f WAVE -d LEI16 "$1" "$2"',
        'typeduel-decode',
        file,
        join(directory, 'decoded.wav'),
      ],
      { timeout: 15000, maxBuffer: 16384 },
    );
    const decodedPath = join(directory, 'decoded.wav');
    if ((await stat(decodedPath)).size > 2_000_000) throw invalid();
    const measurement = measurePcm(await readFile(decodedPath));
    if (sha(await readFile(file)) !== sha(original)) throw invalid();
    return {
      ...measurement,
      sha256: sha(original),
      byteLength: original.length,
      decoder: 'macOS afconvert / WAVE LEI16',
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [manifestPath, root] = process.argv.slice(2);
  if (!manifestPath || !root) {
    console.error(
      'Usage: validate-eight <private-manifest.json> <private-asset-root>',
    );
    process.exitCode = 1;
  } else {
    try {
      const manifest = await validateBytes(
        JSON.parse(await readFile(manifestPath, 'utf8')),
        root,
      );
      for (const { asset } of manifest.entries) {
        const measured = await decodeAndMeasure(join(root, asset.path));
        if (
          measured.durationMs !== asset.clipDurationMs ||
          measured.sha256 !== asset.sha256
        )
          throw invalid();
      }
      console.log(
        'Eight reviewed assets passed byte/hash/decode validation. Native listening evidence remains required.',
      );
    } catch {
      console.error(
        'Audio validation failed; inspect the private review record.',
      );
      process.exitCode = 1;
    }
  }
}
