import { describe, expect, it } from 'vitest';
import {
  AdmissionSchema,
  ClockPongSchema,
  CommittedMatchUpdateSchema,
  GameplayReplySchema,
  HandshakeSchema,
  LobbySchema,
  MatchFoundSchema,
  MatchUpdateSchema,
  MutationSchema,
  QueueJoinSchema,
  RoomPreviewReplySchema,
  SessionStateSchema,
  TransportErrorSchema,
} from '../src/index.js';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = {
  serverInstanceId: id(1),
  sessionId: id(2),
  admissionRevision: 0,
};
const setup = {
  mode: 'classic',
  categorySlug: 'general',
  difficulty: 1,
} as const;
const snapshot = {
  matchId: id(3),
  setup,
  currentLevel: 1,
  roundNumber: 0,
  stateVersion: 0,
  participants: [id(4), id(5)].map((playerId) => ({
    playerId,
    score: 0,
    connected: true,
    graceDeadlineAt: null,
  })),
  viewer: {
    playerId: id(4),
    attemptsRemaining: 3,
    replaysRemaining: 2,
    countedAttempts: [],
  },
  phase: 'PREPARING_ROUND',
  round: null,
};
const update = { matchId: id(3), stateVersion: 0, snapshot, batches: [] };
const lobby = {
  lobbyId: id(6),
  kind: 'private',
  setup,
  hostId: id(4),
  members: [{ playerId: id(4), ready: false, connected: true }],
  expiresAt: 10_000,
  inviteCode: 'abcdefghijklmnopqrstuv',
};
describe('frozen realtime transport', () => {
  it('requires bounded credentials without identity overrides', () => {
    expect(
      HandshakeSchema.safeParse({ accessToken: 'signed-token' }).success,
    ).toBe(true);
    for (const bad of [
      { accessToken: '' },
      { accessToken: 'x'.repeat(8193) },
      { accessToken: 'x', playerId: id(4) },
    ]) {
      expect(HandshakeSchema.safeParse(bad).success).toBe(false);
    }
  });
  it('requires admission revision on mutations and enforces General queue', () => {
    const mutation = { requestId: id(7), expectedAdmissionRevision: 4 };
    expect(MutationSchema.safeParse(mutation).success).toBe(true);
    expect(MutationSchema.safeParse({ requestId: id(7) }).success).toBe(false);
    expect(QueueJoinSchema.safeParse({ ...mutation, setup }).success).toBe(
      true,
    );
    expect(
      QueueJoinSchema.safeParse({
        ...mutation,
        setup: { ...setup, categorySlug: 'animals' },
      }).success,
    ).toBe(false);
    expect(
      QueueJoinSchema.safeParse({
        ...mutation,
        setup: { mode: 'challenge', categorySlug: 'general', difficulty: 1 },
      }).success,
    ).toBe(false);
  });
  it('separates lobby, unresolved creation and committed match identities', () => {
    expect(LobbySchema.safeParse(lobby).success).toBe(true);
    expect(
      AdmissionSchema.safeParse({ kind: 'starting', lobbyId: id(6), setup })
        .success,
    ).toBe(true);
    expect(
      AdmissionSchema.safeParse({
        kind: 'starting',
        lobbyId: id(6),
        setup,
        matchId: id(3),
      }).success,
    ).toBe(false);
    expect(
      MatchFoundSchema.safeParse({
        ...scope,
        admission: { kind: 'match', update },
      }).success,
    ).toBe(true);
    expect(
      MatchFoundSchema.safeParse({ ...scope, admission: { kind: 'idle' } })
        .success,
    ).toBe(false);
  });
  it('rejects duplicate seats, nonmember hosts and public named-category queues', () => {
    expect(
      LobbySchema.safeParse({
        ...lobby,
        members: [...lobby.members, ...lobby.members],
      }).success,
    ).toBe(false);
    expect(LobbySchema.safeParse({ ...lobby, hostId: id(9) }).success).toBe(
      false,
    );
    expect(
      LobbySchema.safeParse({
        ...lobby,
        kind: 'quick',
        inviteCode: null,
        setup: { ...setup, categorySlug: 'animals' },
      }).success,
    ).toBe(false);
  });
  it('validates final snapshot identity and version independently of session revision', () => {
    expect(MatchUpdateSchema.safeParse({ ...scope, ...update }).success).toBe(
      true,
    );
    expect(
      CommittedMatchUpdateSchema.safeParse({ ...update, matchId: id(99) })
        .success,
    ).toBe(false);
    expect(
      CommittedMatchUpdateSchema.safeParse({ ...update, stateVersion: 1 })
        .success,
    ).toBe(false);
    expect(
      SessionStateSchema.safeParse({
        ...scope,
        admission: { kind: 'match', update },
      }).success,
    ).toBe(true);
  });
  it('rejects reordered, duplicate and incomplete batches while allowing private gaps', () => {
    const candidate = {
      ...update,
      stateVersion: 4,
      snapshot: { ...snapshot, stateVersion: 4 },
    };
    expect(
      CommittedMatchUpdateSchema.safeParse({
        ...candidate,
        batches: [
          { stateVersion: 2, events: [] },
          { stateVersion: 4, events: [] },
        ],
      }).success,
    ).toBe(true);
    for (const versions of [[4, 2], [4, 4], [2], [5]]) {
      expect(
        CommittedMatchUpdateSchema.safeParse({
          ...candidate,
          batches: versions.map((stateVersion) => ({
            stateVersion,
            events: [],
          })),
        }).success,
      ).toBe(false);
    }
  });
  it('rejects secret checkpoint fields in public envelopes and arbitrary error text', () => {
    expect(
      MatchUpdateSchema.safeParse({ ...scope, ...update, checkpoint: {} })
        .success,
    ).toBe(false);
    expect(
      TransportErrorSchema.safeParse({ code: 'UNAUTHORIZED', requestId: null })
        .success,
    ).toBe(true);
    expect(
      TransportErrorSchema.safeParse({
        code: 'UNAUTHORIZED',
        requestId: null,
        message: 'internal data',
      }).success,
    ).toBe(false);
    expect(
      GameplayReplySchema.safeParse({
        ok: true,
        data: {
          ack: null,
          error: { code: 'NOT_TYPING', message: 'raw input' },
        },
      }).success,
    ).toBe(false);
  });
  it('scopes preview responses and validates clock order without client timing authority', () => {
    expect(
      RoomPreviewReplySchema.safeParse({
        ok: true,
        data: {
          ...scope,
          preview: {
            lobbyId: id(6),
            setup,
            hostId: id(4),
            expiresAt: 10000,
            available: true,
          },
        },
      }).success,
    ).toBe(true);
    expect(
      ClockPongSchema.safeParse({
        requestId: id(7),
        serverReceivedAt: 100,
        serverSentAt: 101,
      }).success,
    ).toBe(true);
    expect(
      ClockPongSchema.safeParse({
        requestId: id(7),
        serverReceivedAt: 100,
        serverSentAt: 99,
      }).success,
    ).toBe(false);
  });
});
