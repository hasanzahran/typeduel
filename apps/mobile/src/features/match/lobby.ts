import {
  InviteCodeSchema,
  RequestSchema,
  RoomCreateSchema,
  MutationSchema,
  RoomPreviewReplySchema,
  SessionReplySchema,
  type MatchSetup,
  type RoomPreview,
  type SessionState,
} from '@typeduel/contracts';
import { ClientFailure, MatchConnection, type HttpContext } from './connection';

export type FetchRoom = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, 'json'>>;
export class MatchLobby {
  private requests = new Map<
    string,
    { fingerprint: string; revision: number; scope: string; settled: boolean }
  >();
  constructor(
    private readonly connection: MatchConnection,
    private readonly fetchRoom: FetchRoom = fetch,
  ) {}
  private mutation(
    requestId: string,
    action: string,
    body: unknown,
    context: HttpContext,
  ) {
    const scope = `${context.scope.serverInstanceId}:${context.scope.sessionId}`;
    for (const [id, record] of this.requests) {
      if (record.scope !== scope && record.settled) this.requests.delete(id);
    }
    const fingerprint = JSON.stringify([
      context.scope.serverInstanceId,
      context.scope.sessionId,
      action,
      body,
    ]);
    const previous = this.requests.get(requestId);
    if (previous && previous.fingerprint !== fingerprint)
      throw new ClientFailure('IDEMPOTENCY_CONFLICT');
    if (!previous) {
      if (this.requests.size >= 128) throw new ClientFailure('RATE_LIMITED');
      this.requests.set(requestId, {
        fingerprint,
        revision: context.scope.admissionRevision,
        scope,
        settled: false,
      });
    }
    return MutationSchema.parse({
      requestId,
      expectedAdmissionRevision:
        previous?.revision ?? context.scope.admissionRevision,
    });
  }
  private async settle<T>(
    requestId: string,
    operation: Promise<T>,
  ): Promise<T> {
    try {
      const value = await operation;
      const record = this.requests.get(requestId);
      if (record) record.settled = true;
      return value;
    } catch (error) {
      if (
        error instanceof ClientFailure &&
        [
          'INVALID_REQUEST',
          'UNAUTHORIZED',
          'ADMISSION_CONFLICT',
          'ROOM_UNAVAILABLE',
          'SOURCE_UNAVAILABLE',
          'RATE_LIMITED',
          'RETRY_WINDOW_EXPIRED',
          'IDEMPOTENCY_CONFLICT',
        ].includes(error.code)
      ) {
        const record = this.requests.get(requestId);
        if (record) record.settled = true;
      }
      throw error;
    }
  }
  private apply(state: SessionState, context: HttpContext): SessionState {
    if (!this.connection.isCurrent(context))
      throw new ClientFailure('STALE_SESSION');
    const result = this.connection.consumer.acceptSession(
      state,
      context.generation,
    );
    if (result !== 'applied') {
      if (result === 'resync') void this.connection.synchronize();
      throw new ClientFailure('STALE_SESSION');
    }
    return this.connection.consumer.state!;
  }
  async joinQueue(
    setup: MatchSetup,
    requestId = this.connection.newRequestId(),
  ): Promise<SessionState> {
    const context = this.connection.captureHttpContext();
    const mutation = this.mutation(requestId, 'queue.join', setup, context);
    return this.apply(
      await this.settle(
        requestId,
        this.connection.request('queue.join', { ...mutation, setup }),
      ),
      context,
    );
  }
  async leaveQueue(
    requestId = this.connection.newRequestId(),
  ): Promise<SessionState> {
    const context = this.connection.captureHttpContext();
    return this.apply(
      await this.settle(
        requestId,
        this.connection.request(
          'queue.leave',
          this.mutation(requestId, 'queue.leave', null, context),
        ),
      ),
      context,
    );
  }
  async ready(
    lobbyId: string,
    ready: boolean,
    requestId = this.connection.newRequestId(),
  ): Promise<SessionState> {
    const context = this.connection.captureHttpContext();
    const mutation = this.mutation(
      requestId,
      'lobby.ready',
      { lobbyId, ready },
      context,
    );
    return this.apply(
      await this.settle(
        requestId,
        this.connection.request('lobby.ready', {
          ...mutation,
          lobbyId,
          ready,
        }),
      ),
      context,
    );
  }
  async createRoom(
    setup: MatchSetup,
    requestId = this.connection.newRequestId(),
  ): Promise<SessionState> {
    const context = this.connection.captureHttpContext();
    const body = RoomCreateSchema.parse({
      ...this.mutation(requestId, 'room.create', setup, context),
      setup,
    });
    return this.httpSession('/v1/rooms', 'POST', body, context);
  }
  async joinRoom(
    code: string,
    requestId = this.connection.newRequestId(),
  ): Promise<SessionState> {
    this.checkCode(code);
    const context = this.connection.captureHttpContext();
    return this.httpSession(
      `/v1/rooms/${encodeURIComponent(code)}/join`,
      'POST',
      this.mutation(requestId, 'room.join', code, context),
      context,
    );
  }
  async cancelRoom(
    code: string,
    requestId = this.connection.newRequestId(),
  ): Promise<SessionState> {
    this.checkCode(code);
    const context = this.connection.captureHttpContext();
    return this.httpSession(
      `/v1/rooms/${encodeURIComponent(code)}`,
      'DELETE',
      this.mutation(requestId, 'room.cancel', code, context),
      context,
    );
  }
  async previewRoom(
    code: string,
    requestId = this.connection.newRequestId(),
  ): Promise<RoomPreview> {
    this.checkCode(code);
    if (!RequestSchema.safeParse({ requestId }).success)
      throw new ClientFailure('INVALID_REQUEST');
    const context = this.connection.captureHttpContext();
    const raw = await this.http(
      `/v1/rooms/${encodeURIComponent(code)}?requestId=${encodeURIComponent(requestId)}`,
      'GET',
      undefined,
      context,
    );
    if (!this.connection.isCurrent(context))
      throw new ClientFailure('STALE_SESSION');
    const parsed = RoomPreviewReplySchema.safeParse(raw);
    if (!parsed.success) throw new ClientFailure('INVALID_RESPONSE');
    if (!parsed.data.ok) this.fail(parsed.data.error, requestId);
    const result = parsed.data.data;
    if (
      !this.connection.consumer.acceptsScope(result, context.generation) ||
      result.admissionRevision !== context.scope.admissionRevision
    )
      throw new ClientFailure('STALE_SESSION');
    return result;
  }
  private checkCode(code: string): void {
    if (!InviteCodeSchema.safeParse(code).success)
      throw new ClientFailure('INVALID_REQUEST');
  }
  private fail(
    error: {
      code: Parameters<MatchConnection['reportTransportError']>[0];
      requestId: string | null;
    },
    requestId: string,
  ): never {
    if (error.requestId !== requestId)
      throw new ClientFailure('INVALID_RESPONSE');
    const record = this.requests.get(requestId);
    if (record) record.settled = true;
    this.connection.reportTransportError(error.code);
    if (error.code === 'ADMISSION_CONFLICT') void this.connection.synchronize();
    throw new ClientFailure(error.code);
  }
  private async httpSession(
    path: string,
    method: string,
    body: { requestId: string },
    context: HttpContext,
  ): Promise<SessionState> {
    const raw = await this.http(path, method, body, context);
    if (!this.connection.isCurrent(context))
      throw new ClientFailure('STALE_SESSION');
    const parsed = SessionReplySchema.safeParse(raw);
    if (!parsed.success) {
      void this.connection.synchronize();
      throw new ClientFailure('INVALID_RESPONSE');
    }
    if (!parsed.data.ok) this.fail(parsed.data.error, body.requestId);
    const record = this.requests.get(body.requestId);
    if (record) record.settled = true;
    return this.apply(parsed.data.data, context);
  }
  private async http(
    path: string,
    method: string,
    body: unknown,
    context: HttpContext,
  ): Promise<unknown> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 5000);
    try {
      const response = await this.fetchRoom(`${context.baseUrl}${path}`, {
        method,
        signal: abort.signal,
        headers: {
          Authorization: `Bearer ${context.accessToken}`,
          'x-typeduel-session-id': context.scope.sessionId,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return await response.json();
    } catch {
      throw new ClientFailure(
        abort.signal.aborted ? 'TIMEOUT' : 'SERVER_UNAVAILABLE',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
