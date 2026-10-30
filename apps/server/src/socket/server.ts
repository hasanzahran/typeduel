import { Server } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import {
  HandshakeSchema,
  SessionStateSchema,
  MatchUpdateSchema,
  TransportErrorSchema,
  ClockPongSchema,
  SessionReplySchema,
  MatchSyncReplySchema,
  GameplayReplySchema,
  ClockReplySchema,
  type Reply,
} from '@typeduel/contracts';
import type { Principal, TokenVerifier } from '../auth/verifier.js';
import type { GameSession, Sessions } from './session.js';
import type { ActorClock } from '../game/clock.js';
import type { RuntimeHooks } from '../runtime.js';
import { createLimits, TransportFailure } from './limits.js';
import { errorCode, parse } from './handlers.js';
export function attachGameSocket(
  app: FastifyInstance,
  options: {
    sessions: Sessions;
    verifier: TokenVerifier;
    clock: ActorClock;
    allowedOrigins: string[];
    hooks?: RuntimeHooks | undefined;
    handle(
      session: GameSession,
      event: string,
      raw: unknown,
    ): Promise<Reply<unknown>>;
  },
) {
  const io = new Server(app.server, {
    maxHttpBufferSize: 16384,
    serveClient: false,
    cors: { origin: options.allowedOrigins },
    allowRequest: (req, done) =>
      done(
        null,
        !req.headers.origin ||
          options.allowedOrigins.includes(req.headers.origin),
      ),
  });
  const namespace = io.of('/game');
  const verified = new WeakMap<object, Principal>();
  const limits = createLimits(options.clock.monoNow);
  namespace.use((socket, next) => {
    void (async () => {
      try {
        if (!limits.allow(socket.handshake.address, 1, 10))
          throw new TransportFailure('RATE_LIMITED');
        const auth = parse(HandshakeSchema, socket.handshake.auth);
        verified.set(
          socket,
          await options.verifier.verifyAccessToken(auth.accessToken),
        );
        next();
      } catch {
        next(
          Object.assign(new Error('Authentication failed'), {
            data: { code: 'UNAUTHENTICATED', requestId: null },
          }),
        );
      }
    })();
  });
  namespace.on('connection', (socket) => {
    let session: GameSession;
    try {
      const principal = verified.get(socket);
      if (!principal) throw new TransportFailure('UNAUTHENTICATED');
      session = options.sessions.claim(
        principal,
        (event, payload) => {
          const schema =
            event === 'match.update'
              ? MatchUpdateSchema
              : event === 'game.error'
                ? TransportErrorSchema
                : event === 'clock.pong'
                  ? ClockPongSchema
                  : SessionStateSchema;
          const data = schema.parse(payload);
          if (
            options.hooks?.outbound?.({
              kind: 'event',
              event,
              playerId: principal.playerId,
              payload: data,
            }) !== 'drop'
          )
            socket.emit(event, data);
        },
        () => socket.disconnect(true),
      );
    } catch (error) {
      socket.emit('game.error', { code: errorCode(error), requestId: null });
      socket.disconnect(true);
      return;
    }
    socket.on('disconnect', () => options.sessions.remove(session));
    socket.onAny((event: string, ...args: unknown[]) => {
      const callback = args[1];
      if (typeof callback !== 'function') return;
      void options.handle(session, event, args[0]).then((reply) => {
        try {
          const schema =
            event === 'match.sync'
              ? MatchSyncReplySchema
              : event === 'clock.ping'
                ? ClockReplySchema
                : [
                      'answer.submit',
                      'round.audio_ready',
                      'round.replay_used',
                    ].includes(event)
                  ? GameplayReplySchema
                  : SessionReplySchema;
          const payload = schema.parse(reply);
          if (
            options.hooks?.outbound?.({
              kind: 'ack',
              event,
              playerId: session.principal.playerId,
              payload,
            }) !== 'drop'
          )
            (callback as (value: unknown) => void)(payload);
        } catch {
          (callback as (value: unknown) => void)({
            ok: false,
            error: { code: 'SERVER_UNAVAILABLE', requestId: null },
          });
        }
      });
    });
  });
  return {
    close: () => new Promise<void>((resolve) => io.close(() => resolve())),
  };
}
