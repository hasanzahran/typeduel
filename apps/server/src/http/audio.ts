import {
  AudioAccessReplySchema,
  AudioAccessRequestSchema,
  ErrorSchema,
} from '@typeduel/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { TokenVerifier } from '../auth/verifier.js';
import type { AudioAccess } from '../audio/access.js';
import type { Coordinator } from '../matchmaking/coordinator.js';
import { errorCode, parse } from '../socket/handlers.js';
import { createLimits, TransportFailure } from '../socket/limits.js';
import type { GameSession, Sessions } from '../socket/session.js';
import type { ActorClock } from '../game/clock.js';

const matchParams = z.strictObject({ matchId: z.uuid() });
const assetParams = z.strictObject({
  assetId: z.uuid(),
  audioVersion: z.uuid(),
});
const grantQuery = z.strictObject({ grant: z.string().min(1).max(4096) });

function statusFor(error: unknown): number {
  const code = errorCode(error);
  if (code === 'UNAUTHENTICATED') return 401;
  if (code === 'UNAUTHORIZED' || code === 'SESSION_REPLACED') return 403;
  if (code === 'RATE_LIMITED') return 429;
  if (code === 'SOURCE_UNAVAILABLE' || code === 'SERVER_UNAVAILABLE')
    return 503;
  if (code === 'INVALID_REQUEST') return 400;
  return 409;
}

export function audioRoutes(
  app: FastifyInstance,
  options: {
    verifier: TokenVerifier;
    sessions: Sessions;
    coordinator: Coordinator;
    clock: ActorClock;
    access: AudioAccess;
  },
) {
  const limits = createLimits(() => options.clock.monoNow());
  async function authenticate(request: FastifyRequest): Promise<GameSession> {
    if (!limits.allow(`ip:${request.ip}`, 4, 40))
      throw new TransportFailure('RATE_LIMITED');
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer '))
      throw new TransportFailure('UNAUTHENTICATED');
    let principal;
    try {
      principal = await options.verifier.verifyAccessToken(header.slice(7));
    } catch {
      throw new TransportFailure('UNAUTHENTICATED');
    }
    const session = options.sessions.current(principal.playerId);
    if (
      !session ||
      request.headers['x-typeduel-session-id'] !== session.sessionId
    )
      throw new TransportFailure('SESSION_REPLACED');
    options.sessions.assert(session);
    if (!limits.allow(principal.playerId, 2, 20))
      throw new TransportFailure('RATE_LIMITED');
    return session;
  }

  app.post('/v1/matches/:matchId/audio-access', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    let requestId: string | null = null;
    try {
      const params = parse(matchParams, request.params);
      const body = parse(AudioAccessRequestSchema, request.body);
      requestId = body.requestId;
      const session = await authenticate(request);
      const scope = options.coordinator.matchScope(session, params.matchId);
      const granted = await options.access.issue({
        ...scope,
        playerId: session.principal.playerId,
        matchId: params.matchId,
        roundId: body.roundId,
        assetId: body.assetId,
        audioVersion: body.audioVersion,
      });
      options.sessions.assert(session);
      const current = options.coordinator.matchScope(session, params.matchId);
      if (
        current.serverInstanceId !== scope.serverInstanceId ||
        current.sessionId !== scope.sessionId ||
        current.admissionRevision !== scope.admissionRevision
      )
        throw new TransportFailure('UNAUTHORIZED');
      return AudioAccessReplySchema.parse({
        ok: true,
        data: {
          ...current,
          requestId: body.requestId,
          matchId: params.matchId,
          roundId: body.roundId,
          assetId: body.assetId,
          audioVersion: body.audioVersion,
          ...granted,
        },
      });
    } catch (error) {
      const code = errorCode(error);
      return reply
        .code(statusFor(error))
        .send({ ok: false, error: { code, requestId } });
    }
  });

  app.get('/v1/audio/:assetId/:audioVersion', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    try {
      const params = parse(assetParams, request.params);
      const query = parse(grantQuery, request.query);
      const session = await authenticate(request);
      const bytes = await options.access.download(
        query.grant,
        {
          playerId: session.principal.playerId,
          sessionId: session.sessionId,
        },
        params,
      );
      options.sessions.assert(session);
      return reply
        .header('Cache-Control', 'private, no-store')
        .header('Content-Type', 'audio/mpeg')
        .header('Content-Length', String(bytes.byteLength))
        .send(Buffer.from(bytes));
    } catch (error) {
      return reply.code(statusFor(error)).send(
        ErrorSchema.parse({
          code: errorCode(error),
          message: 'Audio request could not be completed',
          requestId: request.id,
        }),
      );
    }
  });
}
