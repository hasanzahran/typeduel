import {
  AnswerSubmitSchema,
  MAX_ANSWER_LENGTH,
  type AnswerAck,
  type AnswerSubmit,
  type AudioReady,
  type GameplayReplyData,
  type MatchSnapshot,
} from '@typeduel/contracts';
import { ClientFailure, MatchConnection } from './connection';

export class GameplayFailure extends Error {
  constructor(readonly code: NonNullable<GameplayReplyData['error']>['code']) {
    super(code);
    this.name = 'GameplayFailure';
  }
}

const counted = (ack: AnswerAck): boolean =>
  ack.status === 'CORRECT' || ack.status === 'INCORRECT';
type Attempt = {
  payload: AnswerSubmit | null;
  ack: AnswerAck | null;
  roundId: string;
  matchId: string;
  inFlight: Promise<AnswerAck> | null;
};
export class MatchCommands {
  private attempts = new Map<string, Attempt>();
  private replayRound: string | null = null;
  private spentReplays = 0;
  private readonly unsubscribe: () => void;
  constructor(private readonly connection: MatchConnection) {
    this.unsubscribe = connection.consumer.subscribe(() => this.reconcile());
  }
  private current(): MatchSnapshot {
    this.reconcile();
    const snapshot = this.connection.consumer.snapshot;
    if (
      !this.connection.consumer.ready ||
      this.connection.status !== 'ready' ||
      !snapshot
    )
      throw new ClientFailure('OFFLINE');
    return snapshot;
  }
  /** Deliberate submission creates one ID; transport retries reuse its unchanged payload. */
  createAnswer(text: string): string {
    const snapshot = this.current();
    if (
      snapshot.phase !== 'ACTIVE_TYPING' ||
      snapshot.viewer.attemptsRemaining === 0
    )
      throw new ClientFailure('INVALID_REQUEST');
    if (this.attempts.size >= 64) throw new ClientFailure('RATE_LIMITED');
    const attemptId = this.connection.newRequestId();
    const parsed = AnswerSubmitSchema.safeParse({
      matchId: snapshot.matchId,
      roundId: snapshot.round.roundId,
      attemptId,
      text,
    });
    if (
      text.length > MAX_ANSWER_LENGTH ||
      !parsed.success ||
      this.attempts.has(attemptId)
    )
      throw new ClientFailure('INVALID_REQUEST');
    // Only unresolved current-round text is retained, never telemetry or public state.
    this.attempts.set(attemptId, {
      payload: parsed.data,
      ack: null,
      matchId: snapshot.matchId,
      roundId: snapshot.round.roundId,
      inFlight: null,
    });
    return attemptId;
  }
  sendAnswer(attemptId: string): Promise<AnswerAck> {
    this.reconcile();
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return Promise.reject(new ClientFailure('INVALID_REQUEST'));
    if (attempt.ack) return Promise.resolve({ ...attempt.ack });
    if (attempt.inFlight) return attempt.inFlight;
    if (!attempt.payload)
      return Promise.reject(new ClientFailure('INVALID_REQUEST'));
    const payload = { ...attempt.payload };
    const operation = this.connection
      .request('answer.submit', payload)
      .then((reply) => {
        if (reply.error) {
          attempt.payload = null;
          throw new GameplayFailure(reply.error.code);
        }
        const ack = reply.ack;
        if (
          !ack ||
          ack.matchId !== payload.matchId ||
          ack.roundId !== payload.roundId ||
          ack.attemptId !== payload.attemptId
        )
          throw new ClientFailure('INVALID_RESPONSE');
        this.reconcile();
        // A counted snapshot outcome is stronger than a delayed rejection.
        if (!attempt.ack || !counted(attempt.ack)) attempt.ack = { ...ack };
        attempt.payload = null;
        return { ...attempt.ack };
      })
      .finally(() => {
        attempt.inFlight = null;
      });
    attempt.inFlight = operation;
    return operation;
  }
  outcome(attemptId: string): AnswerAck | null {
    this.reconcile();
    const ack = this.attempts.get(attemptId)?.ack;
    return ack ? { ...ack } : null;
  }
  reconcile(): void {
    const snapshot = this.connection.consumer.snapshot;
    if (!snapshot) {
      if (this.connection.consumer.ready) this.attempts.clear();
      return;
    }
    for (const ack of snapshot.viewer.countedAttempts) {
      const attempt = this.attempts.get(ack.attemptId);
      if (
        attempt &&
        (attempt.matchId !== ack.matchId || attempt.roundId !== ack.roundId)
      )
        continue;
      if (attempt) {
        attempt.ack = { ...ack };
        attempt.payload = null;
      } else
        this.attempts.set(ack.attemptId, {
          payload: null,
          ack: { ...ack },
          matchId: ack.matchId,
          roundId: ack.roundId,
          inFlight: null,
        });
    }
    const roundId = 'round' in snapshot ? snapshot.round?.roundId : null;
    for (const [id, attempt] of this.attempts) {
      if (attempt.matchId !== snapshot.matchId) this.attempts.delete(id);
      else if (
        roundId !== attempt.roundId ||
        snapshot.phase !== 'ACTIVE_TYPING'
      ) {
        attempt.payload = null;
        if ((!attempt.ack || !counted(attempt.ack)) && !attempt.inFlight)
          this.attempts.delete(id);
      }
    }
    const key = roundId ? `${snapshot.matchId}:${roundId}` : null;
    if (key !== this.replayRound) {
      this.replayRound = key;
      this.spentReplays = 0;
    }
    if (key)
      this.spentReplays = Math.max(
        this.spentReplays,
        2 - snapshot.viewer.replaysRemaining,
      );
  }
  get replaysRemaining(): number {
    this.reconcile();
    return Math.max(0, 2 - this.spentReplays);
  }
  reportReplay(sequence: 1 | 2): Promise<GameplayReplyData> {
    const snapshot = this.current();
    if (snapshot.phase !== 'ACTIVE_TYPING' || sequence > this.spentReplays + 1)
      return Promise.reject(new ClientFailure('INVALID_REQUEST'));
    this.spentReplays = Math.max(this.spentReplays, sequence);
    return this.connection.request('round.replay_used', {
      matchId: snapshot.matchId,
      roundId: snapshot.round.roundId,
      replaySequence: sequence,
    });
  }
  /** Called by Increment 04 only after decoding this exact asset, never by lobby readiness. */
  reportDecodedAudio(payload: AudioReady): Promise<GameplayReplyData> {
    const snapshot = this.current();
    if (
      snapshot.phase !== 'PREPARING_ROUND' ||
      !snapshot.round ||
      snapshot.matchId !== payload.matchId ||
      snapshot.round.roundId !== payload.roundId ||
      snapshot.round.audio.audioVersion !== payload.audioVersion
    )
      return Promise.reject(new ClientFailure('INVALID_REQUEST'));
    return this.connection.request('round.audio_ready', payload);
  }
  dispose(): void {
    this.unsubscribe();
    this.clear();
  }
  clear(): void {
    this.attempts.clear();
    this.replayRound = null;
    this.spentReplays = 0;
  }
}
