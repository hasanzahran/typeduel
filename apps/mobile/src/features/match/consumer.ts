import {
  MatchUpdateSchema,
  SessionStateSchema,
  type CommittedMatchUpdate,
  type GameplayEvent,
  type MatchSnapshot,
  type RoundResult,
  type SessionScope,
  type SessionState,
} from '@typeduel/contracts';

export type ConsumeResult = 'applied' | 'ignored' | 'resync';
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function sameSession(a: SessionScope, b: SessionScope): boolean {
  return (
    a.serverInstanceId === b.serverInstanceId && a.sessionId === b.sessionId
  );
}
function applicable(event: GameplayEvent, snapshot: MatchSnapshot): boolean {
  if (event.matchId !== snapshot.matchId) return false;
  switch (event.type) {
    case 'round.prepare':
      return (
        snapshot.phase === 'PREPARING_ROUND' &&
        snapshot.round?.roundId === event.payload.roundId &&
        snapshot.round.audio.audioVersion === event.payload.audio.audioVersion
      );
    case 'round.start':
      return (
        (snapshot.phase === 'COUNTDOWN' || snapshot.phase === 'PLAYING_WORD') &&
        snapshot.round.roundId === event.payload.roundId &&
        snapshot.round.audio.audioVersion === event.payload.audio.audioVersion
      );
    case 'round.result':
      return (
        (snapshot.phase === 'ROUND_RESULT' || snapshot.phase === 'COMPLETED') &&
        snapshot.result.roundId === event.payload.roundId
      );
    case 'match.complete':
      return snapshot.phase === 'COMPLETED';
    case 'match.interrupted':
      return snapshot.phase === 'ABORTED';
  }
}
function effectKey(event: GameplayEvent): string {
  const payload = event.payload;
  return `${event.matchId}:${event.type}:${'roundId' in payload ? payload.roundId : ''}:${'audio' in payload ? payload.audio.audioVersion : ''}`;
}

/** Canonical state and optional presentation effects intentionally have separate ledgers. */
export class MatchConsumer {
  private generation = 0;
  private synchronized = false;
  private session: SessionState | null = null;
  private effects: GameplayEvent[] = [];
  private results = new Map<string, RoundResult>();
  private seenEffects = new Set<string>();
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  beginGeneration(generation: number): void {
    this.generation = generation;
    this.synchronized = false;
    this.effects = [];
  }
  disconnect(generation: number): void {
    if (generation === this.generation) {
      this.synchronized = false;
      this.effects = [];
    }
  }
  get ready(): boolean {
    return this.synchronized;
  }
  get state(): SessionState | null {
    return this.session && copy(this.session);
  }
  get snapshot(): MatchSnapshot | null {
    return this.session?.admission.kind === 'match'
      ? copy(this.session.admission.update.snapshot)
      : null;
  }
  get receivedResults(): RoundResult[] {
    return copy(
      [...this.results.values()].sort((a, b) => a.roundNumber - b.roundNumber),
    );
  }
  clear(): void {
    this.session = null;
    this.synchronized = false;
    this.effects = [];
    this.results.clear();
    this.seenEffects.clear();
    this.notify();
  }
  takeEffects(): GameplayEvent[] {
    const effects = this.effects;
    this.effects = [];
    return copy(effects);
  }
  acceptsScope(scope: SessionScope, generation: number): boolean {
    return (
      generation === this.generation &&
      this.synchronized &&
      this.session !== null &&
      sameSession(this.session, scope) &&
      scope.admissionRevision >= this.session.admissionRevision
    );
  }
  acceptSession(
    input: unknown,
    generation: number,
    establish = false,
  ): ConsumeResult {
    if (generation !== this.generation) return 'ignored';
    const parsed = SessionStateSchema.safeParse(input);
    if (!parsed.success) return 'resync';
    const next = parsed.data;
    if (!establish && !this.synchronized) return 'ignored';
    if (this.session) {
      const same = sameSession(this.session, next);
      if (!same && !establish) return 'resync';
      if (same && next.admissionRevision < this.session.admissionRevision)
        return 'ignored';
      if (
        same &&
        next.admissionRevision === this.session.admissionRevision &&
        next.admission.kind !== this.session.admission.kind
      )
        return 'resync';
    }
    const previous = this.snapshot;
    if (next.admission.kind === 'match') {
      const update = next.admission.update;
      if (
        previous?.matchId === update.matchId &&
        update.stateVersion < previous.stateVersion
      ) {
        // A late sync must not roll back match state, but can confirm this new socket.
        next.admission.update = {
          matchId: previous.matchId,
          stateVersion: previous.stateVersion,
          snapshot: previous,
          batches: [],
        };
      }
    }
    this.session = copy(next);
    this.synchronized = true;
    if (next.admission.kind === 'match')
      this.consumeEffects(next.admission.update, previous);
    else {
      this.effects = [];
      this.results.clear();
      this.seenEffects.clear();
    }
    this.notify();
    return 'applied';
  }
  acceptUpdate(input: unknown, generation: number): ConsumeResult {
    if (generation !== this.generation || !this.synchronized) return 'ignored';
    const parsed = MatchUpdateSchema.safeParse(input);
    if (!parsed.success) return 'resync';
    const next = parsed.data;
    if (!this.session || !sameSession(next, this.session)) return 'resync';
    if (next.admissionRevision < this.session.admissionRevision)
      return 'ignored';
    if (
      this.session.admission.kind !== 'match' ||
      this.session.admission.update.matchId !== next.matchId
    )
      return 'resync';
    const previous = this.session.admission.update.snapshot;
    if (next.stateVersion < previous.stateVersion) return 'ignored';
    this.session.admissionRevision = next.admissionRevision;
    if (next.stateVersion > previous.stateVersion)
      this.session.admission.update = copy({
        matchId: next.matchId,
        stateVersion: next.stateVersion,
        snapshot: next.snapshot,
        batches: next.batches,
      });
    this.consumeEffects(next, previous);
    this.notify();
    return 'applied';
  }
  private consumeEffects(
    update: CommittedMatchUpdate,
    previous: MatchSnapshot | null,
  ): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    if (previous?.matchId !== snapshot.matchId) {
      this.seenEffects.clear();
      this.results.clear();
      this.effects = [];
    }
    const retain = (result: RoundResult) => {
      if (
        result.roundNumber > snapshot.roundNumber ||
        this.results.has(result.roundId)
      )
        return;
      if (this.results.size < 8) this.results.set(result.roundId, copy(result));
    };
    if ('result' in snapshot) retain(snapshot.result);
    if (snapshot.phase === 'ABORTED' && snapshot.lastResult)
      retain(snapshot.lastResult);
    for (const batch of update.batches)
      for (const event of batch.events) {
        if (event.type === 'round.result') retain(event.payload);
      }
    this.effects = this.effects.filter((event) => applicable(event, snapshot));
    for (const batch of update.batches) {
      for (const event of batch.events) {
        const key = effectKey(event);
        if (applicable(event, snapshot) && !this.seenEffects.has(key)) {
          this.seenEffects.add(key);
          this.effects.push(copy(event));
        }
      }
    }
  }
}
