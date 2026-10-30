import { randomUUID } from 'node:crypto';
import type { Principal } from '../auth/verifier.js';
import type { ActorClock } from '../game/clock.js';
import { TransportFailure } from './limits.js';
export interface GameSession {
  sessionId: string;
  principal: Principal;
  send(event: string, payload: unknown): void;
  disconnect(): void;
  cancelExpiry(): void;
}
export function createSessions(options: {
  clock: ActorClock;
  maxPlayers: number;
  canConnect(playerId: string, replacing: boolean): boolean;
  onConnect(playerId: string, replacing: boolean): void;
  onDisconnect(playerId: string): void;
}) {
  const current = new Map<string, GameSession>();
  const api = {
    current: (id: string) => current.get(id),
    assert(session: GameSession) {
      if (current.get(session.principal.playerId) !== session)
        throw new TransportFailure('SESSION_REPLACED');
      if (session.principal.expiresAtUtcMs <= options.clock.utcNow()) {
        api.remove(session);
        throw new TransportFailure('UNAUTHENTICATED');
      }
    },
    claim(
      principal: Principal,
      send: GameSession['send'],
      disconnect: GameSession['disconnect'],
    ): GameSession {
      if (principal.expiresAtUtcMs <= options.clock.utcNow())
        throw new TransportFailure('UNAUTHENTICATED');
      if (
        !current.has(principal.playerId) &&
        current.size >= options.maxPlayers
      )
        throw new TransportFailure('SERVER_UNAVAILABLE');
      if (
        !options.canConnect(principal.playerId, current.has(principal.playerId))
      )
        throw new TransportFailure('RATE_LIMITED');
      const old = current.get(principal.playerId);
      const session: GameSession = {
        sessionId: randomUUID(),
        principal,
        send,
        disconnect,
        cancelExpiry: () => {},
      };
      current.set(principal.playerId, session);
      if (old) {
        old.cancelExpiry();
        old.send('game.error', { code: 'SESSION_REPLACED', requestId: null });
        old.disconnect();
      }
      session.cancelExpiry = options.clock.schedule(
        options.clock.monoNow() +
          Math.max(0, principal.expiresAtUtcMs - options.clock.utcNow()),
        () => {
          if (current.get(principal.playerId) === session) api.remove(session);
        },
      );
      options.onConnect(principal.playerId, !!old);
      return session;
    },
    remove(session: GameSession) {
      if (current.get(session.principal.playerId) !== session) return;
      current.delete(session.principal.playerId);
      session.cancelExpiry();
      options.onDisconnect(session.principal.playerId);
      session.disconnect();
    },
    close() {
      for (const s of [...current.values()]) api.remove(s);
    },
  };
  return api;
}
export type Sessions = ReturnType<typeof createSessions>;
