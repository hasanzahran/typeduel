import { z } from 'zod';
import {
  AnswerAckSchema,
  AnswerSubmitSchema,
  AudioReadySchema,
  ReplayUsedSchema,
  MatchSnapshotSchema,
  TransitionBatchSchema,
  type AnswerSubmit,
  type AudioReady,
  type ReplayUsed,
} from './gameplay.js';
import { MatchSetupSchema, QuickMatchSetupSchema } from './setup.js';

const Id = z.uuid();
const Counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const GAME_NAMESPACE = '/game';
export const HandshakeSchema = z.strictObject({
  accessToken: z.string().min(1).max(8192),
});
export const RequestSchema = z.strictObject({ requestId: Id });
export const MutationSchema = RequestSchema.extend({
  expectedAdmissionRevision: Counter,
});
export const QueueJoinSchema = MutationSchema.extend({
  setup: QuickMatchSetupSchema,
});
export const LobbyReadySchema = MutationSchema.extend({
  lobbyId: Id,
  ready: z.boolean(),
});
export const RoomCreateSchema = MutationSchema.extend({
  setup: MatchSetupSchema,
});
export const MatchSyncSchema = RequestSchema.extend({
  matchId: Id,
  lastSeenVersion: Counter,
});
export const InviteCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);
export const SessionScopeSchema = z.strictObject({
  serverInstanceId: Id,
  sessionId: Id,
  admissionRevision: Counter,
});
const member = z.strictObject({
  playerId: Id,
  ready: z.boolean(),
  connected: z.boolean(),
});
export const LobbySchema = z
  .strictObject({
    lobbyId: Id,
    kind: z.enum(['private', 'quick']),
    setup: MatchSetupSchema,
    hostId: Id,
    members: z.array(member).min(1).max(2),
    expiresAt: Counter,
    inviteCode: InviteCodeSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.members.map((m) => m.playerId)).size !==
        value.members.length ||
      !value.members.some((m) => m.playerId === value.hostId) ||
      (value.kind === 'quick' &&
        (value.inviteCode !== null || value.setup.categorySlug !== 'general'))
    ) {
      ctx.addIssue({ code: 'custom', message: 'Inconsistent lobby' });
    }
  });
export const RoomPreviewDataSchema = z.strictObject({
  lobbyId: Id,
  setup: MatchSetupSchema,
  hostId: Id,
  expiresAt: Counter,
  available: z.boolean(),
});

export const RoomPreviewSchema = SessionScopeSchema.extend({
  preview: RoomPreviewDataSchema,
});

const updateShape = {
  matchId: Id,
  stateVersion: Counter,
  snapshot: MatchSnapshotSchema,
  batches: z.array(TransitionBatchSchema).max(128),
};
function validateUpdate(
  value: {
    matchId: string;
    stateVersion: number;
    snapshot: z.infer<typeof MatchSnapshotSchema>;
    batches: z.infer<typeof TransitionBatchSchema>[];
  },
  ctx: z.RefinementCtx,
) {
  const fail = () =>
    ctx.addIssue({ code: 'custom', message: 'Inconsistent committed update' });
  if (
    value.matchId !== value.snapshot.matchId ||
    value.stateVersion !== value.snapshot.stateVersion
  )
    fail();
  let previous = -1;
  for (const batch of value.batches) {
    if (
      batch.stateVersion <= previous ||
      batch.stateVersion > value.stateVersion ||
      batch.events.some((event) => event.matchId !== value.matchId)
    )
      fail();
    previous = batch.stateVersion;
  }
  if (value.batches.length > 0 && previous !== value.stateVersion) fail();
}
export const CommittedMatchUpdateSchema = z
  .strictObject(updateShape)
  .superRefine(validateUpdate);
export const MatchUpdateSchema =
  SessionScopeSchema.extend(updateShape).superRefine(validateUpdate);
export const AdmissionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('idle') }),
  z.strictObject({
    kind: z.literal('queued'),
    ticketId: Id,
    setup: QuickMatchSetupSchema,
    joinedAt: Counter,
  }),
  z.strictObject({ kind: z.literal('lobby'), lobby: LobbySchema }),
  z.strictObject({
    kind: z.literal('starting'),
    lobbyId: Id,
    setup: MatchSetupSchema,
  }),
  z.strictObject({
    kind: z.literal('match'),
    update: CommittedMatchUpdateSchema,
  }),
]);
export const SessionStateSchema = SessionScopeSchema.extend({
  admission: AdmissionSchema,
});
export const MatchFoundSchema = SessionStateSchema.refine(
  (s) => s.admission.kind === 'match',
  'Match admission required',
);
export const ClockPongSchema = z
  .strictObject({
    requestId: Id,
    serverReceivedAt: Counter,
    serverSentAt: Counter,
  })
  .refine(
    (v) => v.serverSentAt >= v.serverReceivedAt,
    'Ordered clock sample required',
  );

export const TransportErrorCodeSchema = z.enum([
  'UNAUTHENTICATED',
  'UNAUTHORIZED',
  'SESSION_REPLACED',
  'INVALID_REQUEST',
  'ADMISSION_CONFLICT',
  'ROOM_UNAVAILABLE',
  'SOURCE_UNAVAILABLE',
  'STORAGE_UNAVAILABLE',
  'RATE_LIMITED',
  'RETRY_WINDOW_EXPIRED',
  'IDEMPOTENCY_CONFLICT',
  'SERVER_UNAVAILABLE',
]);
export const TransportErrorSchema = z.strictObject({
  code: TransportErrorCodeSchema,
  requestId: Id.nullable(),
});
export const GameplayErrorSchema = z.strictObject({
  code: z.enum([
    'INVALID_COMMAND',
    'INVALID_TIME',
    'OUT_OF_ORDER',
    'UNAUTHORIZED',
    'WRONG_MATCH',
    'UNKNOWN_ROUND',
    'ROUND_CLOSED',
    'MATCH_TERMINAL',
    'NOT_TYPING',
    'DISCONNECTED',
    'INVALID_DESCRIPTOR',
    'INVALID_PHASE',
    'WRONG_ASSET',
    'TIME_OVERFLOW',
  ]),
  message: z.literal('Game command could not be applied.'),
});
export const GameplayReplyDataSchema = z.strictObject({
  ack: AnswerAckSchema.nullable(),
  error: GameplayErrorSchema.nullable(),
});
export function replySchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), data }),
    z.strictObject({ ok: z.literal(false), error: TransportErrorSchema }),
  ]);
}
export const SessionReplySchema = replySchema(SessionStateSchema);
export const MatchSyncReplySchema = replySchema(MatchUpdateSchema);
export const GameplayReplySchema = replySchema(GameplayReplyDataSchema);
export const RoomPreviewReplySchema = replySchema(RoomPreviewSchema);
export const ClockReplySchema = replySchema(ClockPongSchema);

export type Request = z.infer<typeof RequestSchema>;
export type Mutation = z.infer<typeof MutationSchema>;
export type QueueJoin = z.infer<typeof QueueJoinSchema>;
export type LobbyReady = z.infer<typeof LobbyReadySchema>;
export type RoomCreate = z.infer<typeof RoomCreateSchema>;
export type MatchSync = z.infer<typeof MatchSyncSchema>;
export type SessionScope = z.infer<typeof SessionScopeSchema>;
export type Lobby = z.infer<typeof LobbySchema>;
export type RoomPreview = z.infer<typeof RoomPreviewSchema>;
export type Admission = z.infer<typeof AdmissionSchema>;
export type SessionState = z.infer<typeof SessionStateSchema>;
export type CommittedMatchUpdate = z.infer<typeof CommittedMatchUpdateSchema>;
export type MatchUpdate = z.infer<typeof MatchUpdateSchema>;
export type ClockPong = z.infer<typeof ClockPongSchema>;
export type TransportErrorCode = z.infer<typeof TransportErrorCodeSchema>;
export type TransportError = z.infer<typeof TransportErrorSchema>;
export type GameplayReplyData = z.infer<typeof GameplayReplyDataSchema>;
export type Reply<T> =
  { ok: true; data: T } | { ok: false; error: TransportError };
export type Ack<T> = (reply: Reply<T>) => void;
export interface ClientToServerEvents {
  'session.sync': (request: Request, ack: Ack<SessionState>) => void;
  'queue.join': (request: QueueJoin, ack: Ack<SessionState>) => void;
  'queue.leave': (request: Mutation, ack: Ack<SessionState>) => void;
  'lobby.ready': (request: LobbyReady, ack: Ack<SessionState>) => void;
  'match.sync': (request: MatchSync, ack: Ack<MatchUpdate>) => void;
  'answer.submit': (request: AnswerSubmit, ack: Ack<GameplayReplyData>) => void;
  'round.audio_ready': (
    request: AudioReady,
    ack: Ack<GameplayReplyData>,
  ) => void;
  'round.replay_used': (
    request: ReplayUsed,
    ack: Ack<GameplayReplyData>,
  ) => void;
  'clock.ping': (request: Request, ack: Ack<ClockPong>) => void;
}
export interface ServerToClientEvents {
  'session.update': (state: SessionState) => void;
  'match.found': (state: SessionState) => void;
  'match.update': (update: MatchUpdate) => void;
  'game.error': (error: TransportError) => void;
  'clock.pong': (sample: ClockPong) => void;
}
export const GameplayRequestSchemas = {
  'answer.submit': AnswerSubmitSchema,
  'round.audio_ready': AudioReadySchema,
  'round.replay_used': ReplayUsedSchema,
} as const;
