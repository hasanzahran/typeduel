import { io } from 'socket.io-client';
import {
  GAME_NAMESPACE,
  RequestSchema,
  QueueJoinSchema,
  MutationSchema,
  LobbyReadySchema,
  MatchSyncSchema,
  GameplayRequestSchemas,
  SessionReplySchema,
  MatchSyncReplySchema,
  GameplayReplySchema,
  ClockReplySchema,
  TransportErrorSchema,
  type ClientToServerEvents,
  type Reply,
  type SessionScope,
  type TransportErrorCode,
} from '@typeduel/contracts';
import { apiBaseUrl } from '../../api/client';
import {
  requireAccessToken,
  AuthenticationRequired,
  type TokenProvider,
} from '../../auth/token-provider';
import { MatchConsumer, sameSession } from './consumer';
import { DisplayClock } from './clock';

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'syncing'
  | 'ready'
  | 'auth-required'
  | 'replaced';
export type ClientFailureCode =
  | TransportErrorCode
  | 'OFFLINE'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'STALE_SESSION';
export class ClientFailure extends Error {
  constructor(readonly code: ClientFailureCode) {
    super(code);
    this.name = 'ClientFailure';
  }
}
export interface SocketPort {
  connected: boolean;
  on(event: string, listener: (...args: unknown[]) => void): void;
  emit(event: string, payload: unknown, ack: (reply: unknown) => void): void;
  connect(): void;
  disconnect(): void;
  removeAllListeners(): void;
}
export type SocketFactory = (
  url: string,
  token: string,
  timeoutMs: number,
) => SocketPort;
const socketFactory: SocketFactory = (url, token, timeoutMs) => {
  const socket = io(url, {
    auth: { accessToken: token },
    autoConnect: false,
    reconnection: false,
    forceNew: true,
    transports: ['websocket'],
    ackTimeout: timeoutMs,
  });
  return {
    get connected() {
      return socket.connected;
    },
    on(event, listener) {
      socket.on(event, listener);
    },
    // Volatile drops unwritable sends. The explicit buffer clear also covers
    // the pinned client's expired-heartbeat branch, which otherwise queues them.
    emit(event, payload, ack) {
      socket.sendBuffer.length = 0;
      try {
        socket.volatile.emit(
          event,
          payload,
          (error: unknown, reply: unknown) => {
            if (error == null) ack(reply);
          },
        );
      } finally {
        socket.sendBuffer.length = 0;
      }
    },
    connect() {
      socket.connect();
    },
    disconnect() {
      socket.disconnect();
    },
    removeAllListeners() {
      socket.removeAllListeners();
    },
  };
};
type Event = keyof ClientToServerEvents;
type Payload<E extends Event> = Parameters<ClientToServerEvents[E]>[0];
type Data<E extends Event> = Parameters<ClientToServerEvents[E]>[1] extends (
  reply: Reply<infer T>,
) => void
  ? T
  : never;
const requests = {
  'session.sync': RequestSchema,
  'queue.join': QueueJoinSchema,
  'queue.leave': MutationSchema,
  'lobby.ready': LobbyReadySchema,
  'match.sync': MatchSyncSchema,
  ...GameplayRequestSchemas,
  'clock.ping': RequestSchema,
};
const replies = {
  'session.sync': SessionReplySchema,
  'queue.join': SessionReplySchema,
  'queue.leave': SessionReplySchema,
  'lobby.ready': SessionReplySchema,
  'match.sync': MatchSyncReplySchema,
  'answer.submit': GameplayReplySchema,
  'round.audio_ready': GameplayReplySchema,
  'round.replay_used': GameplayReplySchema,
  'clock.ping': ClockReplySchema,
};
export interface HttpContext {
  generation: number;
  scope: SessionScope;
  accessToken: string;
  baseUrl: string;
}
export interface ConnectionOptions {
  baseUrl: string;
  tokenProvider: TokenProvider;
  newRequestId(): string;
  consumer?: MatchConsumer;
  clock?: DisplayClock;
  socketFactory?: SocketFactory;
  timeoutMs?: number;
  onChange?(): void;
}

/** No Socket.IO offline buffer/recovery is used. Each connection authenticates and fully syncs. */
export class MatchConnection {
  readonly consumer: MatchConsumer;
  readonly clock: DisplayClock;
  readonly baseUrl: string;
  private socket: SocketPort | null = null;
  private token: string | null = null;
  private generation = 0;
  private currentStatus: ConnectionStatus = 'disconnected';
  private stopped = true;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private pending = new Set<(error: ClientFailure) => void>();
  private syncing: Promise<void> | null = null;
  private syncAgain = false;
  constructor(private readonly options: ConnectionOptions) {
    this.baseUrl = apiBaseUrl(options.baseUrl);
    this.consumer = options.consumer ?? new MatchConsumer();
    this.clock = options.clock ?? new DisplayClock();
  }
  get status(): ConnectionStatus {
    return this.currentStatus;
  }
  get connectionGeneration(): number {
    return this.generation;
  }
  newRequestId(): string {
    const requestId = this.options.newRequestId();
    RequestSchema.parse({ requestId });
    return requestId;
  }
  private notify(): void {
    this.options.onChange?.();
  }
  private setStatus(status: ConnectionStatus): void {
    this.currentStatus = status;
    this.notify();
  }
  async connect(): Promise<void> {
    this.stopped = false;
    this.release(new ClientFailure('STALE_SESSION'));
    const generation = ++this.generation;
    this.consumer.beginGeneration(generation);
    this.clock.invalidate();
    this.setStatus('connecting');
    try {
      const token = await requireAccessToken(this.options.tokenProvider);
      if (this.stopped || generation !== this.generation) return;
      this.token = token;
      const socket = (this.options.socketFactory ?? socketFactory)(
        `${this.baseUrl}${GAME_NAMESPACE}`,
        token,
        this.options.timeoutMs ?? 5000,
      );
      this.socket = socket;
      const current = () =>
        !this.stopped &&
        generation === this.generation &&
        socket === this.socket;
      socket.on('connect', () => {
        if (current()) void this.synchronize();
      });
      socket.on('disconnect', () => {
        if (current()) this.lost();
      });
      socket.on('connect_error', (...args) => {
        if (!current()) return;
        const error = args[0];
        const parsed = TransportErrorSchema.safeParse(
          typeof error === 'object' && error !== null && 'data' in error
            ? error.data
            : null,
        );
        if (parsed.success && this.handleError(parsed.data.code)) return;
        this.lost();
      });
      for (const event of ['session.update', 'match.found'] as const)
        socket.on(event, (value) => {
          if (!current()) return;
          if (!this.consumer.ready) {
            this.syncAgain = true;
            return;
          }
          if (this.consumer.acceptSession(value, generation) === 'resync')
            void this.synchronize();
          this.notify();
        });
      socket.on('match.update', (value) => {
        if (!current()) return;
        if (!this.consumer.ready) {
          this.syncAgain = true;
          return;
        }
        if (this.consumer.acceptUpdate(value, generation) === 'resync')
          void this.synchronize();
        this.notify();
      });
      socket.on('game.error', (value) => {
        if (!current()) return;
        const parsed = TransportErrorSchema.safeParse(value);
        if (parsed.success) this.handleError(parsed.data.code);
        else void this.synchronize();
      });
      socket.on('clock.pong', (value) => {
        if (current()) this.clock.receive(value);
      });
      socket.connect();
    } catch (error) {
      if (generation !== this.generation || this.stopped) return;
      if (error instanceof AuthenticationRequired) {
        this.stopped = true;
        this.setStatus('auth-required');
      } else this.lost();
    }
  }
  disconnect(): void {
    this.stopped = true;
    this.consumer.disconnect(this.generation);
    ++this.generation;
    this.release(new ClientFailure('OFFLINE'));
    this.clock.invalidate();
    this.setStatus('disconnected');
  }
  private release(error: ClientFailure): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.syncing = null;
    const socket = this.socket;
    this.socket = null;
    this.token = null;
    socket?.removeAllListeners();
    socket?.disconnect();
    for (const reject of [...this.pending]) reject(error);
  }
  private lost(): void {
    this.consumer.disconnect(this.generation);
    this.release(new ClientFailure('OFFLINE'));
    this.clock.invalidate();
    this.setStatus('disconnected');
    if (!this.stopped)
      this.retry = setTimeout(
        () => {
          this.retry = null;
          void this.connect();
        },
        Math.min(500 * 2 ** this.retries++, 5000),
      );
  }
  private handleError(code: TransportErrorCode): boolean {
    if (code !== 'SESSION_REPLACED' && code !== 'UNAUTHENTICATED') return false;
    this.stopped = true;
    this.consumer.disconnect(this.generation);
    ++this.generation;
    this.release(new ClientFailure(code));
    this.clock.invalidate();
    this.setStatus(code === 'SESSION_REPLACED' ? 'replaced' : 'auth-required');
    return true;
  }
  async synchronize(): Promise<void> {
    if (this.syncing) return this.syncing;
    if (!this.socket?.connected || this.stopped) return;
    const generation = this.generation;
    this.consumer.disconnect(generation);
    this.setStatus('syncing');
    const operation = (async () => {
      try {
        do {
          this.syncAgain = false;
          const state = await this.dispatch(
            'session.sync',
            { requestId: this.newRequestId() },
            true,
          );
          if (generation !== this.generation || this.stopped) return;
          if (
            this.consumer.acceptSession(state, generation, true) !== 'applied'
          )
            throw new ClientFailure('INVALID_RESPONSE');
          if (this.syncAgain) this.consumer.disconnect(generation);
        } while (this.syncAgain);
        this.retries = 0;
        this.setStatus('ready');
      } catch (error) {
        if (generation !== this.generation || this.stopped) return;
        if (!(
          error instanceof ClientFailure &&
          this.handleError(error.code as TransportErrorCode)
        ))
          this.lost();
      } finally {
        if (generation === this.generation) this.syncing = null;
      }
    })();
    this.syncing = operation;
    return operation;
  }
  request<E extends Event>(event: E, payload: Payload<E>): Promise<Data<E>> {
    return this.dispatch(event, payload, false);
  }
  private dispatch<E extends Event>(
    event: E,
    payload: Payload<E>,
    duringSync: boolean,
  ): Promise<Data<E>> {
    const socket = this.socket;
    if (
      !socket?.connected ||
      this.stopped ||
      (!duringSync && (this.status !== 'ready' || !this.consumer.ready))
    )
      return Promise.reject(new ClientFailure('OFFLINE'));
    const parsed = requests[event].safeParse(payload);
    if (!parsed.success)
      return Promise.reject(new ClientFailure('INVALID_REQUEST'));
    const generation = this.generation;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: ClientFailure, value?: Data<E>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pending.delete(cancel);
        if (error) reject(error);
        else resolve(value!);
      };
      const cancel = (error: ClientFailure) => finish(error);
      const timer = setTimeout(
        () => finish(new ClientFailure('TIMEOUT')),
        this.options.timeoutMs ?? 5000,
      );
      this.pending.add(cancel);
      try {
        socket.emit(event, parsed.data, (raw) => {
          if (generation !== this.generation || socket !== this.socket)
            return finish(new ClientFailure('STALE_SESSION'));
          const result = replies[event].safeParse(raw);
          if (!result.success) {
            finish(new ClientFailure('INVALID_RESPONSE'));
            if (!duringSync) void this.synchronize();
            return;
          }
          if (!result.data.ok) {
            const error = result.data.error;
            const requestId =
              'requestId' in parsed.data ? parsed.data.requestId : null;
            if (error.requestId !== requestId) {
              finish(new ClientFailure('INVALID_RESPONSE'));
              return;
            }
            finish(new ClientFailure(error.code));
            this.handleError(error.code);
            if (!duringSync && error.code === 'ADMISSION_CONFLICT')
              void this.synchronize();
          } else finish(undefined, result.data.data as Data<E>);
        });
      } catch {
        finish(new ClientFailure('SERVER_UNAVAILABLE'));
      }
    });
  }
  async sampleClock(): Promise<boolean> {
    const requestId = this.newRequestId();
    this.clock.start(requestId);
    try {
      return this.clock.receive(
        await this.request('clock.ping', { requestId }),
      );
    } catch {
      return false;
    }
  }
  captureHttpContext(): HttpContext {
    const state = this.consumer.state;
    if (
      !state ||
      !this.consumer.ready ||
      this.status !== 'ready' ||
      !this.token
    )
      throw new ClientFailure('OFFLINE');
    return {
      generation: this.generation,
      scope: {
        serverInstanceId: state.serverInstanceId,
        sessionId: state.sessionId,
        admissionRevision: state.admissionRevision,
      },
      accessToken: this.token,
      baseUrl: this.baseUrl,
    };
  }
  isCurrent(context: HttpContext): boolean {
    const state = this.consumer.state;
    return (
      context.generation === this.generation &&
      this.status === 'ready' &&
      this.consumer.ready &&
      state !== null &&
      sameSession(context.scope, state)
    );
  }
  reportTransportError(code: TransportErrorCode): void {
    this.handleError(code);
  }
}
