import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  RoomCreateSchema,
  MutationSchema,
  RequestSchema,
  InviteCodeSchema,
  RoomPreviewReplySchema,
  SessionReplySchema,
} from '@typeduel/contracts';
import type { TokenVerifier } from '../auth/verifier.js';
import type { Sessions } from '../socket/session.js';
import type { Coordinator } from '../matchmaking/coordinator.js';
import type { ActorClock } from '../game/clock.js';
import type { RuntimeHooks } from '../runtime.js';
import { createLimits, TransportFailure } from '../socket/limits.js';
import { parse, errorCode } from '../socket/handlers.js';
export function roomRoutes(
  app: FastifyInstance,
  options: {
    verifier: TokenVerifier;
    sessions: Sessions;
    coordinator: Coordinator;
    clock: ActorClock;
    hooks?: RuntimeHooks | undefined;
  },
) {
  const limits = createLimits(() => options.clock.monoNow());
  async function authenticate(req: FastifyRequest) {
    if (!limits.allow(`ip:${req.ip}`, 2, 20))
      throw new TransportFailure('RATE_LIMITED');
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      throw new TransportFailure('UNAUTHENTICATED');
    let principal;
    try {
      principal = await options.verifier.verifyAccessToken(header.slice(7));
    } catch {
      throw new TransportFailure('UNAUTHENTICATED');
    }
    const session = options.sessions.current(principal.playerId);
    if (!session || req.headers['x-typeduel-session-id'] !== session.sessionId)
      throw new TransportFailure('SESSION_REPLACED');
    options.sessions.assert(session);
    if (!limits.allow(principal.playerId, 1, 10))
      throw new TransportFailure('RATE_LIMITED');
    return session;
  }
  for (const action of ['create', 'preview', 'join', 'leave'] as const) {
    const method =
      action === 'preview' ? 'GET' : action === 'leave' ? 'DELETE' : 'POST';
    const url =
      action === 'create'
        ? '/v1/rooms'
        : action === 'join'
          ? '/v1/rooms/:code/join'
          : '/v1/rooms/:code';
    app.route({
      method,
      url,
      async handler(req, reply) {
        let requestId: string | null = null;
        try {
          const raw = action === 'preview' ? req.query : req.body;
          if (
            typeof raw === 'object' &&
            raw !== null &&
            'requestId' in raw &&
            z.uuid().safeParse(raw.requestId).success
          )
            requestId = raw.requestId as string;
          const session = await authenticate(req);
          const params = req.params as { code?: unknown };
          let data;
          if (action === 'create')
            data = await options.coordinator.createRoom(
              session,
              parse(RoomCreateSchema, raw),
            );
          else {
            const code = parse(InviteCodeSchema, params.code);
            if (action === 'preview') {
              parse(RequestSchema, raw);
              data = options.coordinator.preview(session, code);
            } else if (action === 'join')
              data = await options.coordinator.joinRoom(
                session,
                code,
                parse(MutationSchema, raw),
              );
            else
              data = await options.coordinator.leaveRoom(
                session,
                code,
                parse(MutationSchema, raw),
              );
          }
          const payload = (
            action === 'preview' ? RoomPreviewReplySchema : SessionReplySchema
          ).parse({ ok: true, data });
          if (
            options.hooks?.outbound?.({
              kind: 'ack',
              event: `room.${action}`,
              playerId: session.principal.playerId,
              payload,
            }) === 'drop'
          )
            return reply.hijack();
          return payload;
        } catch (error) {
          const code = errorCode(error);
          return reply
            .code(
              code === 'UNAUTHENTICATED'
                ? 401
                : code === 'UNAUTHORIZED'
                  ? 403
                  : code === 'RATE_LIMITED'
                    ? 429
                    : code === 'ROOM_UNAVAILABLE'
                      ? 404
                      : 409,
            )
            .send({ ok: false, error: { code, requestId } });
        }
      },
    });
  }
}
