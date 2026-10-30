import type { MatchSnapshot, TransitionBatch } from '@typeduel/contracts';
import type { MatchState, TransitionResult } from '../game/types.js';

export type FaultPoint =
  | 'before_owner_lock'
  | 'before_match_lock'
  | 'after_dml'
  | 'before_commit'
  | 'after_commit'
  | 'before_publish';
export interface FaultContext {
  operationId?: string;
  matchId?: string;
  statement?: string;
  backendPid?: number;
}
export type FaultHook = (
  point: FaultPoint,
  context: FaultContext,
) => void | Promise<void>;
export interface OwnerToken {
  ownerId: string;
  epoch: bigint;
}
export interface OwnerLease {
  readonly token: OwnerToken;
  readonly backendPid: number;
  readonly schemaName: string;
  isActive(): boolean;
  onLost(listener: () => void): () => void;
  release(): Promise<void>;
}
export interface PersistedMatch {
  state: MatchState;
  storeRevision: bigint;
  lastOperationId: string;
  owner: OwnerToken;
}
export interface CommitInput {
  owner: OwnerLease;
  matchId: string;
  expectedRevision: bigint;
  operationId: string;
  candidate: TransitionResult;
}
export type OperationResolution =
  | { status: 'committed'; match: PersistedMatch }
  | { status: 'rolled_back' }
  | { status: 'unresolved' }
  | { status: 'fenced' };
export interface MatchStore {
  createMatch(input: {
    owner: OwnerLease;
    operationId: string;
    state: MatchState;
  }): Promise<PersistedMatch>;
  commitTransition(input: CommitInput): Promise<PersistedMatch>;
  readCommitted(matchId: string): Promise<PersistedMatch | null>;
  resolveOperation(input: {
    owner: OwnerLease;
    matchId: string;
    operationId: string;
    expectedRevision: bigint;
  }): Promise<OperationResolution>;
  interruptOrphans(owner: OwnerLease): Promise<number>;
}
/** Increment 03 discovery; existing core store adapters remain independently usable. */
export interface DiscoverableMatchStore extends MatchStore {
  readLatestForPlayer(playerId: string): Promise<PersistedMatch | null>;
}
export type StoreErrorCode =
  | 'INVALID_STATE'
  | 'CONFLICT'
  | 'FENCED'
  | 'RECOVERY_REQUIRED'
  | 'ROLLED_BACK'
  | 'COMMIT_UNKNOWN'
  | 'UNAVAILABLE';
export class StoreError extends Error {
  constructor(readonly code: StoreErrorCode) {
    super('Database operation could not be completed.');
    this.name = 'StoreError';
  }
}
export interface CommittedUpdate {
  matchId: string;
  snapshot: MatchSnapshot;
  batches: TransitionBatch[];
}
