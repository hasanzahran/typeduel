import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// Unqualified tables live in the validated private connection search_path.
export const ownerControl = pgTable(
  'owner_control',
  {
    id: smallint('id').primaryKey(),
    ownerId: uuid('owner_id'),
    epoch: bigint('epoch', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    ready: boolean('ready').notNull().default(false),
  },
  (t) => [
    check('owner_singleton', sql`${t.id} = 1`),
    check('owner_epoch', sql`${t.epoch} >= 0`),
  ],
);
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey(),
    slug: text('slug').notNull().unique(),
  },
  (t) => [
    check(
      'category_slug',
      sql`${t.slug} in ('general','animals','food','sports','technology')`,
    ),
  ],
);
export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    setup: jsonb('setup').notNull(),
    player1Id: uuid('player1_id').notNull(),
    player2Id: uuid('player2_id').notNull(),
    player1Score: smallint('player1_score').notNull(),
    player2Score: smallint('player2_score').notNull(),
    status: text('status').notNull(),
    currentLevel: smallint('current_level').notNull(),
    roundNumber: smallint('round_number').notNull(),
    winnerId: uuid('winner_id'),
    isDraw: boolean('is_draw').notNull(),
    interruptionReason: text('interruption_reason'),
    ownerId: uuid('owner_id').notNull(),
    ownerEpoch: bigint('owner_epoch', { mode: 'bigint' }).notNull(),
    storeRevision: bigint('store_revision', { mode: 'bigint' }).notNull(),
    stateVersion: bigint('state_version', { mode: 'number' }).notNull(),
    lastOperationId: uuid('last_operation_id').notNull(),
    checkpoint: jsonb('checkpoint').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('match_category_identity').on(t.id, t.categoryId),
    check('match_distinct_players', sql`${t.player1Id} <> ${t.player2Id}`),
    check(
      'match_scores',
      sql`${t.player1Score} between 0 and 8 and ${t.player2Score} between 0 and 8 and ${t.player1Score} + ${t.player2Score} <= ${t.roundNumber}`,
    ),
    check(
      'match_level_round',
      sql`${t.currentLevel} between 1 and 5 and ${t.roundNumber} between 0 and 8`,
    ),
    check(
      'match_versions',
      sql`${t.storeRevision} >= 1 and ${t.stateVersion} >= 0 and ${t.stateVersion} <= 9007199254740991 and ${t.ownerEpoch} > 0`,
    ),
    check(
      'match_status',
      sql`${t.status} in ('PREPARING_ROUND','COUNTDOWN','PLAYING_WORD','ACTIVE_TYPING','ROUND_RESULT','COMPLETED','ABORTED')`,
    ),
    check(
      'match_terminal',
      sql`((${t.status} = 'ABORTED' and ${t.winnerId} is null and not ${t.isDraw} and ${t.interruptionReason} in ('DISCONNECT_TIMEOUT','SOURCE_UNAVAILABLE','SERVER_RESTART','AUDIO_UNAVAILABLE')) or (${t.status} = 'COMPLETED' and ${t.interruptionReason} is null and ${t.roundNumber} between 5 and 8 and ((${t.isDraw} and ${t.winnerId} is null and ${t.roundNumber} = 8 and ${t.player1Score} = ${t.player2Score}) or (not ${t.isDraw} and ((${t.winnerId} = ${t.player1Id} and ${t.player1Score} > ${t.player2Score}) or (${t.winnerId} = ${t.player2Id} and ${t.player2Score} > ${t.player1Score}))))) or (${t.status} not in ('ABORTED','COMPLETED') and ${t.winnerId} is null and not ${t.isDraw} and ${t.interruptionReason} is null)) IS TRUE`,
    ),
  ],
);
export const matchParticipants = pgTable(
  'match_participants',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id),
    playerId: uuid('player_id').notNull(),
    slot: smallint('slot').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.playerId] }),
    unique('participant_slot').on(t.matchId, t.slot),
    check('participant_slot_range', sql`${t.slot} in (1,2)`),
  ],
);
export const playerMatchBindings = pgTable(
  'player_match_bindings',
  {
    playerId: uuid('player_id').primaryKey(),
    lastMatchId: uuid('last_match_id').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.lastMatchId, t.playerId],
      foreignColumns: [matchParticipants.matchId, matchParticipants.playerId],
    }),
  ],
);
export const matchRounds = pgTable(
  'match_rounds',
  {
    id: uuid('id').primaryKey(),
    matchId: uuid('match_id').notNull(),
    categoryId: uuid('category_id').notNull(),
    roundNumber: smallint('round_number').notNull(),
    wordId: uuid('word_id').notNull(),
    audioAssetId: uuid('audio_asset_id').notNull(),
    level: smallint('level').notNull(),
    playbackAt: timestamp('playback_at', { withTimezone: true }),
    typingStartAt: timestamp('typing_start_at', { withTimezone: true }),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    winnerId: uuid('winner_id'),
    result: jsonb('result'),
  },
  (t) => [
    unique('round_match_identity').on(t.matchId, t.id),
    unique('round_number_once').on(t.matchId, t.roundNumber),
    unique('word_once_per_match').on(t.matchId, t.wordId),
    foreignKey({
      columns: [t.matchId, t.categoryId],
      foreignColumns: [matches.id, matches.categoryId],
    }),
    foreignKey({
      columns: [t.matchId, t.winnerId],
      foreignColumns: [matchParticipants.matchId, matchParticipants.playerId],
    }),
    check(
      'round_bounds',
      sql`${t.roundNumber} between 1 and 8 and ${t.level} between 1 and 5`,
    ),
    check(
      'round_schedule',
      sql`(${t.playbackAt} is null and ${t.typingStartAt} is null and ${t.deadlineAt} is null) or (${t.playbackAt} is not null and ${t.typingStartAt} is not null and ${t.deadlineAt} is not null and ${t.playbackAt} < ${t.typingStartAt} and ${t.typingStartAt} < ${t.deadlineAt})`,
    ),
  ],
);
export const answerAttempts = pgTable(
  'answer_attempts',
  {
    matchId: uuid('match_id').notNull(),
    roundId: uuid('round_id').notNull(),
    playerId: uuid('player_id').notNull(),
    attemptId: uuid('attempt_id').notNull(),
    attemptNumber: smallint('attempt_number').notNull(),
    fingerprint: text('fingerprint').notNull(),
    originalAck: jsonb('original_ack').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roundId, t.playerId, t.attemptId] }),
    unique('attempt_number_once').on(t.roundId, t.playerId, t.attemptNumber),
    foreignKey({
      columns: [t.matchId, t.roundId],
      foreignColumns: [matchRounds.matchId, matchRounds.id],
    }),
    foreignKey({
      columns: [t.matchId, t.playerId],
      foreignColumns: [matchParticipants.matchId, matchParticipants.playerId],
    }),
    check('attempt_number_range', sql`${t.attemptNumber} between 1 and 3`),
    check('attempt_fingerprint', sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`),
  ],
);
