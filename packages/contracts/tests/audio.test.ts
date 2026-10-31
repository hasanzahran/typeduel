import { describe, expect, it } from 'vitest';
import {
  AudioAccessRequestSchema,
  AudioAccessReplySchema,
  AudioCompletedSchema,
  AudioFailedSchema,
  GameplayRequestSchemas,
  MatchInterruptionSchema,
  MAX_AUDIO_BYTES,
} from '../src/index.js';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const identity = { matchId: id(1), roundId: id(2), audioVersion: id(3) };
const request = {
  requestId: id(4),
  roundId: id(2),
  assetId: id(5),
  audioVersion: id(3),
};
const data = {
  ...request,
  matchId: id(1),
  serverInstanceId: id(6),
  sessionId: id(7),
  admissionRevision: 0,
  url: 'https://api.example/v1/audio/opaque?grant=opaque',
  expiresAt: 60_000,
  byteLength: 100,
};
describe('initial playback and protected byte access contracts', () => {
  it('accepts scoped completion/failure without client timing authority', () => {
    expect(AudioCompletedSchema.parse(identity)).toEqual(identity);
    expect(GameplayRequestSchemas['round.audio_completed']).toBe(
      AudioCompletedSchema,
    );
    expect(
      AudioFailedSchema.parse({ ...identity, reason: 'LATE_PLAYBACK' }).reason,
    ).toBe('LATE_PLAYBACK');
    for (const extra of [
      { completedAt: 1 },
      { playerId: id(8) },
      { extendMs: 500 },
      { text: 'private' },
    ])
      expect(
        AudioCompletedSchema.safeParse({ ...identity, ...extra }).success,
      ).toBe(false);
    expect(
      AudioFailedSchema.safeParse({ ...identity, reason: 'native file path' })
        .success,
    ).toBe(false);
    expect(
      MatchInterruptionSchema.parse({ reason: 'AUDIO_UNAVAILABLE' }).reason,
    ).toBe('AUDIO_UNAVAILABLE');
  });
  it('keeps grants separate from canonical descriptors and requires every scope field', () => {
    expect(AudioAccessRequestSchema.parse(request)).toEqual(request);
    expect(AudioAccessReplySchema.safeParse({ ok: true, data }).success).toBe(
      true,
    );
    for (const field of Object.keys(data)) {
      const partial = { ...data } as Record<string, unknown>;
      delete partial[field];
      expect(
        AudioAccessReplySchema.safeParse({ ok: true, data: partial }).success,
      ).toBe(false);
    }
    expect(
      AudioAccessReplySchema.safeParse({
        ok: true,
        data: { ...data, canonicalText: 'private' },
      }).success,
    ).toBe(false);
    expect(
      AudioAccessReplySchema.safeParse({
        ok: false,
        error: { code: 'UNAUTHORIZED', requestId: id(4) },
      }).success,
    ).toBe(true);
  });
  it('bounds bytes and rejects credential-bearing or non-HTTP access URLs', () => {
    for (const byteLength of [0, -1, 1.5, MAX_AUDIO_BYTES + 1])
      expect(
        AudioAccessReplySchema.safeParse({
          ok: true,
          data: { ...data, byteLength },
        }).success,
      ).toBe(false);
    for (const url of [
      'file:///private/audio.mp3',
      'https://secret@api.example/a',
      'https://api.example/a#secret',
    ])
      expect(
        AudioAccessReplySchema.safeParse({ ok: true, data: { ...data, url } })
          .success,
      ).toBe(false);
    expect(
      AudioAccessRequestSchema.safeParse({
        ...request,
        requestedDeadline: 70_000,
      }).success,
    ).toBe(false);
  });
});
