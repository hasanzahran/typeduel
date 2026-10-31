import { describe, expect, it } from 'vitest';
import { decodeCheckpoint, encodeCheckpoint } from '../../src/db/checkpoint.js';
import { validateSchemaName } from '../../src/db/client.js';
import { StoreError } from '../../src/db/types.js';
import { interruptForServerRestart } from '../../src/game/engine.js';
import type { MatchState } from '../../src/game/types.js';
import {
  createFixtureMatch,
  fixtureId,
  preparePlayableRound as prepareReadyRound,
  submit,
  tickAt,
} from '../game/fixtures.js';

function asLegacyCheckpoint(state: MatchState): unknown {
  const { legacyCheckpoint: _legacy, ...base } = structuredClone(state);
  void _legacy;
  const participants = base.participants.map(
    ({ initialPlaybackCompleted: _completed, ...participant }) => {
      void _completed;
      return participant;
    },
  );
  const round = base.round
    ? (({ preflightDeadlineMonoMs: _deadline, ...value }) => {
        void _deadline;
        return value;
      })(base.round)
    : null;
  return { formatVersion: 1, state: { ...base, participants, round } };
}

describe('private durable checkpoints', () => {
  it('round trips initial, scheduled, active and scored states with detached data', () => {
    const initial = createFixtureMatch();
    const ready = prepareReadyRound(initial);
    const active = tickAt(ready.state, ready.monoSchedule.typingStartAt).state;
    const scored = submit(active, active.participants[0].playerId, {
      attemptId: fixtureId(900),
      text: ready.descriptor.canonicalText,
      atMonoMs: ready.monoSchedule.typingStartAt,
    }).state;
    for (const state of [initial, ready.state, active, scored]) {
      const encoded = encodeCheckpoint(state);
      expect(decodeCheckpoint(JSON.parse(JSON.stringify(encoded)))).toEqual(
        state,
      );
      encoded.state.participants[0].score = 8;
      expect(state.participants[0].score).toBeLessThan(8);
    }
  });
  it.each([
    (v: ReturnType<typeof encodeCheckpoint>) => {
      v.state.usedRoundIds.push(fixtureId(999));
    },
    (v: ReturnType<typeof encodeCheckpoint>) => {
      v.state.participants[0].score += 1;
    },
    (v: ReturnType<typeof encodeCheckpoint>) => {
      v.state.lastInput.atMonoMs = Number.POSITIVE_INFINITY;
    },
    (v: ReturnType<typeof encodeCheckpoint>) => {
      v.state.countedAttempts[0]!.fingerprint = 'secret-guess';
    },
    (v: ReturnType<typeof encodeCheckpoint>) => {
      v.state.countedAttempts[0]!.ack.attemptsRemaining = 0;
    },
    (v: ReturnType<typeof encodeCheckpoint>) => {
      v.state.countedAttempts[0]!.playerId = fixtureId(999);
    },
  ])('rejects corrupt private data without exposing the record', (corrupt) => {
    const ready = prepareReadyRound(createFixtureMatch());
    const wrong = submit(ready.state, ready.state.participants[0].playerId, {
      attemptId: fixtureId(900),
      text: 'secret-guess',
      atMonoMs: ready.monoSchedule.typingStartAt,
    }).state;
    const encoded = encodeCheckpoint(wrong);
    corrupt(encoded);
    expect(() => decodeCheckpoint(encoded)).toThrow(StoreError);
    try {
      decodeCheckpoint(encoded);
    } catch (error) {
      expect(String(error)).not.toContain('secret-guess');
    }
  });
  it('rejects unknown checkpoint versions and getters with sanitized errors', () => {
    expect(() =>
      decodeCheckpoint({ formatVersion: 3, state: createFixtureMatch() }),
    ).toThrow(StoreError);
    expect(() =>
      decodeCheckpoint({
        get formatVersion() {
          throw new Error('private-token');
        },
      }),
    ).toThrow('Database operation could not be completed.');
  });
  it('interrupts old active state without advancing its expired-in-real-time deadlines', () => {
    const ready = prepareReadyRound(createFixtureMatch());
    const before = structuredClone(ready.state);
    const result = interruptForServerRestart(ready.state);
    expect(ready.state).toEqual(before);
    expect(result.state.lastInput).toEqual(before.lastInput);
    expect(result.state.phase).toBe('ABORTED');
    expect(result.state.interruption?.reason).toBe('SERVER_RESTART');
    expect(result.state.completion).toBeNull();
    expect(result.state.participants.map((p) => p.score)).toEqual([0, 0]);
    expect(result.batches).toHaveLength(1);
    expect(encodeCheckpoint(result.state).state).toEqual(result.state);
    expect(interruptForServerRestart(result.state).batches).toEqual([]);
  });
  it('reads unfinished v1 only for restart interruption and writes the result as v2', () => {
    const ready = prepareReadyRound(createFixtureMatch());
    const active = tickAt(ready.state, ready.monoSchedule.typingStartAt).state;
    const decoded = decodeCheckpoint(asLegacyCheckpoint(active));
    expect(decoded.legacyCheckpoint).toBe(true);
    expect(() => encodeCheckpoint(decoded)).toThrow(StoreError);
    const interrupted = interruptForServerRestart(decoded);
    expect(interrupted.state.phase).toBe('ABORTED');
    expect(interrupted.state.interruption?.reason).toBe('SERVER_RESTART');
    const encoded = encodeCheckpoint(interrupted.state);
    expect(encoded.formatVersion).toBe(2);
    expect(encoded.state.legacyCheckpoint).toBeUndefined();
  });
  it('reads terminal v1 without changing its outcome or counted acknowledgements', () => {
    let state = createFixtureMatch();
    for (let round = 0; round < 5; round += 1) {
      const ready = prepareReadyRound(state);
      state = submit(ready.state, state.participants[0].playerId, {
        attemptId: fixtureId(950 + round),
        text: ready.descriptor.canonicalText,
        atMonoMs: ready.monoSchedule.typingStartAt,
      }).state;
    }
    const decoded = decodeCheckpoint(asLegacyCheckpoint(state));
    expect(decoded.phase).toBe('COMPLETED');
    expect(decoded.completion).toEqual(state.completion);
    expect(decoded.countedAttempts).toEqual(state.countedAttempts);
    expect(decoded.legacyCheckpoint).toBeUndefined();
    expect(encodeCheckpoint(decoded).formatVersion).toBe(2);
  });
  it('preserves an already completed result and all original counted ACKs', () => {
    let state = createFixtureMatch();
    for (let i = 0; i < 5; i += 1) {
      const ready = prepareReadyRound(state);
      state = submit(ready.state, state.participants[0].playerId, {
        attemptId: fixtureId(900 + i),
        text: ready.descriptor.canonicalText,
        atMonoMs: ready.monoSchedule.typingStartAt,
      }).state;
    }
    const recovered = interruptForServerRestart(state);
    expect(recovered.state).toEqual(state);
    expect(recovered.batches).toEqual([]);
    expect(
      decodeCheckpoint(encodeCheckpoint(state)).countedAttempts,
    ).toHaveLength(5);
  });
  it('validates private database namespaces before constructing SQL options', () => {
    expect(validateSchemaName()).toBe('typeduel_game');
    expect(validateSchemaName('typeduel_qa_123')).toBe('typeduel_qa_123');
    for (const bad of [
      'public',
      'pg_catalog',
      'information_schema',
      'x;DROP SCHEMA public',
      'private,public',
      'pg_evil',
    ])
      expect(() => validateSchemaName(bad)).toThrow(StoreError);
  });
});
