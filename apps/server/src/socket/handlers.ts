import { z } from 'zod';
import {
  RequestSchema,
  QueueJoinSchema,
  MutationSchema,
  LobbyReadySchema,
  MatchSyncSchema,
  GameplayRequestSchemas,
  type Reply,
  type TransportErrorCode,
} from '@typeduel/contracts';
import type { Sessions, GameSession } from './session.js';
import type { Coordinator } from '../matchmaking/coordinator.js';
import type { MatchRegistry } from '../game/registry.js';
import type { ActorClock } from '../game/clock.js';
import type { RuntimeHooks } from '../runtime.js';
import { createLimits, TransportFailure } from './limits.js';
export const errorCode = (error: unknown): TransportErrorCode =>
  error instanceof TransportFailure ? error.code : 'SERVER_UNAVAILABLE';
export function parse<T extends z.ZodType>(
  schema: T,
  input: unknown,
): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new TransportFailure('INVALID_REQUEST');
  return result.data;
}
export function createHandlers(options: {
  sessions: Sessions;
  coordinator: Coordinator;
  registry: MatchRegistry;
  clock: ActorClock;
  hooks?: RuntimeHooks | undefined;
}) {
  const limits = createLimits(() => options.clock.monoNow());
  const { sessions, coordinator, registry, clock, hooks } = options;
  return async (
    session: GameSession,
    event: string,
    raw: unknown,
  ): Promise<Reply<unknown>> => {
    let requestId: string | null = null;
    try {
      sessions.assert(session);
      if (!limits.allow(session.principal.playerId))
        throw new TransportFailure('RATE_LIMITED');
      if (
        event === 'answer.submit' ||
        event === 'round.audio_ready' ||
        event === 'round.replay_used'
      ) {
        const payload = parse(GameplayRequestSchemas[event], raw);
        const work = registry.command(
          payload.matchId,
          session.principal.playerId,
          event,
          payload,
        );
        hooks?.afterGameplayAdmission?.({
          event,
          playerId: session.principal.playerId,
          matchId: payload.matchId,
          ...('attemptId' in payload ? { attemptId: payload.attemptId } : {}),
        });
        const data = await work;
        sessions.assert(session);
        return { ok: true, data };
      }
      if (
        typeof raw === 'object' &&
        raw !== null &&
        'requestId' in raw &&
        z.uuid().safeParse(raw.requestId).success
      )
        requestId = raw.requestId as string;
      let data: unknown;
      switch (event) {
        case 'session.sync':
          parse(RequestSchema, raw);
          data = await coordinator.state(session);
          break;
        case 'queue.join':
          data = await coordinator.queueJoin(
            session,
            parse(QueueJoinSchema, raw),
          );
          break;
        case 'queue.leave':
          data = await coordinator.queueLeave(
            session,
            parse(MutationSchema, raw),
          );
          break;
        case 'lobby.ready':
          data = await coordinator.ready(session, parse(LobbyReadySchema, raw));
          break;
        case 'match.sync': {
          const request = parse(MatchSyncSchema, raw);
          const scope = coordinator.scope(session);
          const update = await registry.sync(
            request.matchId,
            session.principal.playerId,
          );
          sessions.assert(session);
          data = { ...scope, ...update };
          break;
        }
        case 'clock.ping': {
          const request = parse(RequestSchema, raw);
          const serverReceivedAt = clock.utcNow();
          data = {
            requestId: request.requestId,
            serverReceivedAt,
            serverSentAt: Math.max(serverReceivedAt, clock.utcNow()),
          };
          session.send('clock.pong', data);
          break;
        }
        default:
          throw new TransportFailure('INVALID_REQUEST');
      }
      sessions.assert(session);
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: { code: errorCode(error), requestId } };
    }
  };
}
