import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  REQUESTS,
  REQUEST_HASH,
  ESTIMATED_COST_USD,
  runApprovedBatch,
  validateApproval,
} from '../src/generate-eight.js';
const now = Date.parse('2026-10-30T12:00:00Z');
function approval(outputDirectory: string) {
  return {
    batchId: '00000000-0000-4000-8000-000000000001',
    approvedBy: 'TEST ONLY',
    approvedAt: '2026-10-30T11:00:00Z',
    expiresAt: '2026-10-30T13:00:00Z',
    expectedAccountId: '000000000000',
    accountVerifiedByOwner: true,
    outputDirectory,
    requestHash: REQUEST_HASH,
    region: 'us-east-1',
    maxAttempts: 8,
    maxCharacters: 29,
    maxCostUsd: 0.01,
  };
}
describe('bounded offline synthesis authorization', () => {
  it('fixes the eight exact requests and conservative cost without provider access', () => {
    expect(REQUESTS).toHaveLength(8);
    expect(REQUESTS.map((r) => r.Text).join(',')).toBe(
      'cat,dog,cup,milk,desk,hand,drum,frog',
    );
    expect(REQUESTS.reduce((n, r) => n + r.Text!.length, 0)).toBe(29);
    expect(ESTIMATED_COST_USD).toBe(0.000464);
    expect(
      REQUESTS.every(
        (r) =>
          r.Engine === 'neural' &&
          r.VoiceId === 'Joanna' &&
          r.SampleRate === '24000',
      ),
    ).toBe(true);
  });
  it('rejects absent, expired, unbounded, changed-input and wrong-account authorization', () => {
    const valid = approval('/private/test');
    expect(validateApproval(valid, '000000000000', now)).toEqual(valid);
    for (const invalid of [
      null,
      { ...valid, requestHash: 'x' },
      { ...valid, maxAttempts: 9 },
      { ...valid, maxCostUsd: 1 },
      { ...valid, accountVerifiedByOwner: false },
      { ...valid, expiresAt: '2026-10-30T12:00:00Z' },
      { ...valid, expiresAt: '2026-11-02T00:00:00Z' },
    ])
      expect(() => validateApproval(invalid, '000000000000', now)).toThrow();
    expect(() => validateApproval(valid, '111111111111', now)).toThrow();
  });
  it('writes an exclusive durable ledger before requests and never invents review approval', async () => {
    const parent = await realpath(
      await mkdtemp(join(tmpdir(), 'typeduel-generation-test-')),
    );
    const outputDirectory = join(parent, 'batch');
    let calls = 0;
    try {
      const options = {
        outputDirectory,
        approval: approval(outputDirectory),
        confirmedAccountId: '000000000000',
        now,
        synthesize: async () => {
          const ledger = JSON.parse(
            await readFile(
              join(outputDirectory, 'generation-run.json'),
              'utf8',
            ),
          );
          expect(ledger.entries[calls].status).toBe('started');
          calls++;
          return Buffer.from('synthetic bytes; not a recording');
        },
      };
      expect(await runApprovedBatch(options)).toEqual({
        count: 8,
        reviewStatus: 'pending',
      });
      expect(calls).toBe(8);
      await expect(runApprovedBatch(options)).rejects.toThrow();
      expect(calls).toBe(8);
      await expect(
        runApprovedBatch({
          ...options,
          outputDirectory: join(parent, 'another'),
        }),
      ).rejects.toThrow();
      expect(calls).toBe(8);
      await expect(
        readFile(join(outputDirectory, 'manifest.json')),
      ).rejects.toThrow();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
  it('stops on an uncertain response with no paid retry or later requests', async () => {
    const parent = await realpath(
      await mkdtemp(join(tmpdir(), 'typeduel-generation-test-')),
    );
    const outputDirectory = join(parent, 'batch');
    let calls = 0;
    try {
      await expect(
        runApprovedBatch({
          outputDirectory,
          approval: approval(outputDirectory),
          confirmedAccountId: '000000000000',
          now,
          synthesize: async () => {
            calls++;
            throw new Error('private provider details');
          },
        }),
      ).rejects.toThrow('Batch stopped');
      expect(calls).toBe(1);
      const ledger = JSON.parse(
        await readFile(join(outputDirectory, 'generation-run.json'), 'utf8'),
      );
      expect(ledger.entries[0].status).toBe('uncertain');
      expect(
        ledger.entries
          .slice(1)
          .every((e: { status: string }) => e.status === 'pending'),
      ).toBe(true);
      expect(JSON.stringify(ledger)).not.toContain('private provider details');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
