import { randomBytes, randomUUID } from 'node:crypto';
import type {
  Admission,
  CommittedMatchUpdate,
  Lobby,
  MatchSetup,
  Mutation,
  SessionState,
  RoomPreview,
  QueueJoin,
  RoomCreate,
  LobbyReady,
} from '@typeduel/contracts';
import type { DiscoverableMatchStore } from '../db/types.js';
import type { ActorClock } from '../game/clock.js';
import type { MatchRegistry } from '../game/registry.js';
import type { GameSession, Sessions } from '../socket/session.js';
import { TransportFailure } from '../socket/limits.js';
import type { RuntimeConfig } from '../runtime.js';
type Place =
  | { kind: 'idle' }
  | {
      kind: 'queued';
      ticketId: string;
      setup: QueueJoin['setup'];
      joinedAt: number;
    }
  | { kind: 'lobby'; lobbyId: string }
  | { kind: 'starting'; lobbyId: string; matchId: string; setup: MatchSetup }
  | { kind: 'match'; matchId: string; terminal: boolean };
interface User {
  revision: number;
  pendingMutation?: string;
  place: Place;
  requests: Map<
    string,
    {
      fingerprint: string;
      promise: Promise<void>;
      expires: number;
      settled: boolean;
    }
  >;
}
interface Room {
  public: Lobby;
  cancelExpiry: () => void;
  grace: Map<string, () => void>;
  graceDeadlines: Map<string, number>;
  expiresAtMono: number;
}
export function createCoordinator(options: {
  clock: ActorClock;
  registry: MatchRegistry;
  store: DiscoverableMatchStore;
  config: RuntimeConfig;
  serverInstanceId: string;
  sessions: () => Sessions;
}) {
  const { clock, registry, store, config, serverInstanceId } = options;
  const users = new Map<string, User>();
  const rooms = new Map<string, Room>();
  const codes = new Map<string, string>();
  let closed = false;
  // A new session has its own scope, but retained retries and live claims must
  // survive disconnects. Reclaim only records with nothing left to reconcile.
  function reclaim(exceptId: string) {
    if (users.size < config.maxPlayers) return;
    for (const [id, u] of users) {
      if (
        id === exceptId ||
        options.sessions().current(id) ||
        u.pendingMutation
      )
        continue;
      if (
        u.place.kind !== 'idle' &&
        !(u.place.kind === 'match' && u.place.terminal)
      )
        continue;
      if (
        [...u.requests.values()].some(
          (entry) => !entry.settled || entry.expires > clock.monoNow(),
        )
      )
        continue;
      users.delete(id);
    }
  }
  const user = (id: string) => {
    let u = users.get(id);
    if (!u) {
      reclaim(id);
      if (users.size >= config.maxPlayers)
        throw new TransportFailure('SERVER_UNAVAILABLE');
      u = { revision: 0, place: { kind: 'idle' }, requests: new Map() };
      users.set(id, u);
    }
    return u;
  };
  const change = (id: string, place: Place) => {
    const u = user(id);
    u.place = place;
    u.revision += 1;
  };
  const assert = (session: GameSession) => {
    if (closed) throw new TransportFailure('SERVER_UNAVAILABLE');
    options.sessions().assert(session);
  };
  const scope = (session: GameSession) => ({
    serverInstanceId,
    sessionId: session.sessionId,
    admissionRevision: user(session.principal.playerId).revision,
  });
  function simple(session: GameSession): SessionState | null {
    const p = user(session.principal.playerId).place;
    let admission: Admission;
    if (p.kind === 'match') return null;
    if (p.kind === 'lobby') {
      const room = liveRoom(p.lobbyId);
      if (!room) return { ...scope(session), admission: { kind: 'idle' } };
      admission = { kind: 'lobby', lobby: structuredClone(room.public) };
    } else if (p.kind === 'starting')
      admission = { kind: 'starting', lobbyId: p.lobbyId, setup: p.setup };
    else admission = p;
    return { ...scope(session), admission };
  }
  function notify(id: string) {
    const session = options.sessions().current(id);
    if (!session) return;
    try {
      const state = simple(session);
      if (state) session.send('session.update', state);
    } catch {
      /* disconnected */
    }
  }
  function roomChanged(room: Room) {
    for (const member of room.public.members) {
      user(member.playerId).revision += 1;
      notify(member.playerId);
    }
  }
  function cancelRoom(room: Room) {
    if (rooms.get(room.public.lobbyId) !== room) return;
    room.cancelExpiry();
    for (const cancel of room.grace.values()) cancel();
    rooms.delete(room.public.lobbyId);
    if (room.public.inviteCode) codes.delete(room.public.inviteCode);
    for (const m of room.public.members) {
      const place = user(m.playerId).place;
      if (place.kind === 'lobby' && place.lobbyId === room.public.lobbyId) {
        change(m.playerId, { kind: 'idle' });
        notify(m.playerId);
      }
    }
  }
  function liveRoom(id: string): Room | undefined {
    const room = rooms.get(id);
    if (
      room &&
      (clock.monoNow() >= room.expiresAtMono ||
        [...room.graceDeadlines.values()].some((at) => clock.monoNow() >= at))
    ) {
      cancelRoom(room);
      return undefined;
    }
    return room;
  }
  function idle(id: string) {
    const p = user(id).place;
    if (p.kind !== 'idle' && !(p.kind === 'match' && p.terminal))
      throw new TransportFailure('ADMISSION_CONFLICT');
  }
  function createLobby(
    setup: MatchSetup,
    ids: string[],
    kind: 'quick' | 'private',
  ): Room {
    const lobbyId = randomUUID();
    const inviteCode =
      kind === 'private' ? randomBytes(18).toString('base64url') : null;
    const room: Room = {
      public: {
        lobbyId,
        kind,
        setup: structuredClone(setup),
        hostId: ids[0]!,
        members: ids.map((playerId) => ({
          playerId,
          connected: !!options.sessions().current(playerId),
          ready: false,
        })),
        expiresAt: clock.utcNow() + config.lobbyTtlMs,
        inviteCode,
      },
      cancelExpiry: () => {},
      grace: new Map(),
      graceDeadlines: new Map(),
      expiresAtMono: clock.monoNow() + config.lobbyTtlMs,
    };
    room.cancelExpiry = clock.schedule(
      clock.monoNow() + config.lobbyTtlMs,
      () => cancelRoom(room),
    );
    rooms.set(lobbyId, room);
    if (inviteCode) codes.set(inviteCode, lobbyId);
    for (const id of ids) change(id, { kind: 'lobby', lobbyId });
    for (const id of ids) notify(id);
    return room;
  }
  async function start(room: Room) {
    const participants = room.public.members.map((m) => m.playerId) as [
      string,
      string,
    ];
    const matchId = randomUUID();
    const setup = room.public.setup;
    const clockAnchor = { monoMs: clock.monoNow(), utcEpochMs: clock.utcNow() };
    room.cancelExpiry();
    for (const cancel of room.grace.values()) cancel();
    rooms.delete(room.public.lobbyId);
    if (room.public.inviteCode) codes.delete(room.public.inviteCode);
    for (const id of participants) {
      change(id, {
        kind: 'starting',
        lobbyId: room.public.lobbyId,
        matchId,
        setup,
      });
      notify(id);
    }
    try {
      await registry.start({ matchId, participants, setup, clockAnchor });
      if (closed) return;
      for (const id of participants) {
        change(id, { kind: 'match', matchId, terminal: false });
      }
      for (const id of participants) {
        const session = options.sessions().current(id);
        if (session) {
          try {
            const result = await api.state(session, false);
            assert(session);
            session.send('match.found', result);
            session.send('session.update', result);
          } catch {
            /* Durable membership survives replacement or delivery failure. */
          }
        }
      }
      registry.activate(matchId);
    } catch {
      // The registry rejects only known failures; uncertain creates remain pending.
      if (!closed)
        for (const id of participants) {
          change(id, { kind: 'idle' });
          notify(id);
        }
    }
  }
  async function mutation(
    session: GameSession,
    request: Mutation,
    operation: string,
    body: unknown,
    apply: () => void | Promise<void>,
  ): Promise<SessionState> {
    assert(session);
    const u = user(session.principal.playerId);
    const fingerprint = JSON.stringify({ operation, body });
    for (const [id, entry] of u.requests)
      if (entry.settled && entry.expires <= clock.monoNow())
        u.requests.delete(id);
    const prior = u.requests.get(request.requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new TransportFailure('IDEMPOTENCY_CONFLICT');
      await prior.promise;
      return api.state(session, false);
    }
    if (u.pendingMutation) throw new TransportFailure('ADMISSION_CONFLICT');
    if (request.expectedAdmissionRevision !== u.revision)
      throw new TransportFailure('RETRY_WINDOW_EXPIRED');
    if (u.requests.size >= 128) throw new TransportFailure('RATE_LIMITED');
    u.revision += 1;
    u.pendingMutation = request.requestId;
    const entry = {
      fingerprint,
      promise: Promise.resolve(),
      expires: clock.monoNow() + config.lobbyTtlMs,
      settled: false,
    };
    u.requests.set(request.requestId, entry);
    entry.promise = Promise.resolve()
      .then(apply)
      .finally(() => {
        entry.settled = true;
        if (u.pendingMutation === request.requestId) delete u.pendingMutation;
      });
    await entry.promise;
    assert(session);
    return api.state(session, false);
  }
  const api = {
    scope,
    matchScope(session: GameSession, matchId: string) {
      assert(session);
      const place = user(session.principal.playerId).place;
      if (place.kind !== 'match' || place.matchId !== matchId || place.terminal)
        throw new TransportFailure('UNAUTHORIZED');
      return scope(session);
    },
    canConnect(id: string, replacing = false) {
      reclaim(id);
      const u = users.get(id);
      if (!u) return users.size < config.maxPlayers;
      if (
        replacing &&
        u.place.kind === 'match' &&
        !registry.canReplace(u.place.matchId, id)
      )
        return false;
      return (
        (u.place.kind !== 'starting' && u.place.kind !== 'match') ||
        registry.canReconnect(u.place.matchId, id)
      );
    },
    connect(id: string, replacing = false) {
      const u = user(id);
      u.revision += 1;
      const p = u.place;
      if (p.kind === 'starting' || p.kind === 'match') {
        if (replacing && p.kind === 'match')
          registry.replaceSession(p.matchId, id);
        registry.connection(p.matchId, id, true);
        return;
      }
      if (p.kind === 'lobby') {
        const room = liveRoom(p.lobbyId);
        if (room) {
          room.grace.get(id)?.();
          room.grace.delete(id);
          room.graceDeadlines.delete(id);
          const m = room.public.members.find((m) => m.playerId === id);
          if (m) m.connected = true;
          if (replacing)
            for (const member of room.public.members) member.ready = false;
          roomChanged(room);
        }
      }
    },
    disconnect(id: string) {
      const p = user(id).place;
      if (p.kind === 'queued') {
        change(id, { kind: 'idle' });
        return;
      }
      if (p.kind === 'starting' || p.kind === 'match') {
        registry.connection(p.matchId, id, false);
        return;
      }
      if (p.kind === 'lobby') {
        const room = liveRoom(p.lobbyId);
        if (!room) return;
        for (const m of room.public.members) {
          m.ready = false;
          if (m.playerId === id) m.connected = false;
        }
        room.grace.get(id)?.();
        room.graceDeadlines.set(id, clock.monoNow() + config.lobbyGraceMs);
        room.grace.set(
          id,
          clock.schedule(clock.monoNow() + config.lobbyGraceMs, () =>
            cancelRoom(room),
          ),
        );
        roomChanged(room);
      }
    },
    async state(session: GameSession, discover = true): Promise<SessionState> {
      assert(session);
      const u = user(session.principal.playerId);
      const revision = u.revision;
      if (u.place.kind === 'idle' && discover) {
        const latest = await store.readLatestForPlayer(
          session.principal.playerId,
        );
        assert(session);
        if (u.revision !== revision) return api.state(session, false);
        if (latest) {
          if (!['COMPLETED', 'ABORTED'].includes(latest.state.phase))
            throw new TransportFailure('SERVER_UNAVAILABLE');
          change(session.principal.playerId, {
            kind: 'match',
            matchId: latest.state.matchId,
            terminal: true,
          });
        }
      }
      const basic = simple(session);
      if (basic) return basic;
      const p = u.place;
      if (p.kind !== 'match') throw new TransportFailure('SERVER_UNAVAILABLE');
      const rev = u.revision;
      const update = await registry.sync(p.matchId, session.principal.playerId);
      assert(session);
      if (u.revision !== rev) return api.state(session, false);
      p.terminal = ['COMPLETED', 'ABORTED'].includes(update.snapshot.phase);
      return { ...scope(session), admission: { kind: 'match', update } };
    },
    publish(id: string, update: CommittedMatchUpdate) {
      const u = users.get(id);
      if (!u || u.place.kind !== 'match' || u.place.matchId !== update.matchId)
        return;
      u.place.terminal = ['COMPLETED', 'ABORTED'].includes(
        update.snapshot.phase,
      );
      const session = options.sessions().current(id);
      if (session) {
        try {
          assert(session);
          session.send('match.update', { ...scope(session), ...update });
        } catch {
          /* expired */
        }
      }
    },
    queueJoin(session: GameSession, request: QueueJoin) {
      return mutation(session, request, 'queue.join', request, async () => {
        const id = session.principal.playerId;
        idle(id);
        if (!(await registry.available(request.setup)))
          throw new TransportFailure('SOURCE_UNAVAILABLE');
        assert(session);
        idle(id);
        const other = [...users].find(
          ([otherId, u]) =>
            otherId !== id &&
            u.place.kind === 'queued' &&
            JSON.stringify(u.place.setup) === JSON.stringify(request.setup) &&
            !!options.sessions().current(otherId),
        );
        if (other) createLobby(request.setup, [other[0], id], 'quick');
        else {
          change(id, {
            kind: 'queued',
            ticketId: randomUUID(),
            setup: request.setup,
            joinedAt: clock.utcNow(),
          });
          notify(id);
        }
      });
    },
    queueLeave(session: GameSession, request: Mutation) {
      return mutation(session, request, 'queue.leave', request, () => {
        const id = session.principal.playerId;
        if (user(id).place.kind !== 'queued')
          throw new TransportFailure('ADMISSION_CONFLICT');
        change(id, { kind: 'idle' });
        notify(id);
      });
    },
    createRoom(session: GameSession, request: RoomCreate) {
      return mutation(session, request, 'room.create', request, async () => {
        const id = session.principal.playerId;
        idle(id);
        if (!(await registry.available(request.setup)))
          throw new TransportFailure('SOURCE_UNAVAILABLE');
        assert(session);
        idle(id);
        createLobby(request.setup, [id], 'private');
      });
    },
    preview(session: GameSession, code: string): RoomPreview {
      assert(session);
      const room = liveRoom(codes.get(code) ?? '');
      if (!room) throw new TransportFailure('ROOM_UNAVAILABLE');
      return {
        ...scope(session),
        preview: {
          lobbyId: room.public.lobbyId,
          setup: room.public.setup,
          hostId: room.public.hostId,
          expiresAt: room.public.expiresAt,
          available: room.public.members.length < 2,
        },
      };
    },
    joinRoom(session: GameSession, code: string, request: Mutation) {
      return mutation(
        session,
        request,
        'room.join',
        { code, ...request },
        () => {
          const id = session.principal.playerId;
          idle(id);
          const room = liveRoom(codes.get(code) ?? '');
          if (
            !room ||
            room.public.members.length >= 2 ||
            room.public.hostId === id
          )
            throw new TransportFailure('ROOM_UNAVAILABLE');
          room.public.members.push({
            playerId: id,
            ready: false,
            connected: true,
          });
          change(id, { kind: 'lobby', lobbyId: room.public.lobbyId });
          roomChanged(room);
        },
      );
    },
    leaveRoom(session: GameSession, code: string, request: Mutation) {
      return mutation(
        session,
        request,
        'room.leave',
        { code, ...request },
        () => {
          const id = session.principal.playerId;
          const room = liveRoom(codes.get(code) ?? '');
          if (!room || !room.public.members.some((m) => m.playerId === id))
            throw new TransportFailure('ROOM_UNAVAILABLE');
          if (room.public.hostId === id) cancelRoom(room);
          else {
            room.grace.get(id)?.();
            room.grace.delete(id);
            room.graceDeadlines.delete(id);
            room.public.members = room.public.members.filter(
              (m) => m.playerId !== id,
            );
            for (const m of room.public.members) m.ready = false;
            change(id, { kind: 'idle' });
            notify(id);
            roomChanged(room);
          }
        },
      );
    },
    ready(session: GameSession, request: LobbyReady) {
      return mutation(session, request, 'lobby.ready', request, () => {
        const id = session.principal.playerId;
        const p = user(id).place;
        const room = liveRoom(request.lobbyId);
        if (p.kind !== 'lobby' || p.lobbyId !== request.lobbyId || !room)
          throw new TransportFailure('ADMISSION_CONFLICT');
        const member = room.public.members.find((m) => m.playerId === id)!;
        member.ready = request.ready;
        roomChanged(room);
        if (
          room.public.members.length === 2 &&
          room.public.members.every(
            (m) =>
              m.ready &&
              m.connected &&
              !!options.sessions().current(m.playerId),
          )
        )
          void start(room);
      });
    },
    close() {
      closed = true;
      for (const room of rooms.values()) {
        room.cancelExpiry();
        for (const cancel of room.grace.values()) cancel();
      }
      rooms.clear();
      codes.clear();
    },
  };
  return api;
}
export type Coordinator = ReturnType<typeof createCoordinator>;
