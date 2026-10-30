import { type SessionState } from '@typeduel/contracts';
import { MatchConnection, type SocketPort } from './connection';
import { io } from 'socket.io-client';
jest.mock('socket.io-client', () => ({ io: jest.fn() }));
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const state = (n = 2): SessionState => ({
  serverInstanceId: id(1),
  sessionId: id(n),
  admissionRevision: 0,
  admission: { kind: 'idle' },
});
class FakeSocket implements SocketPort {
  connected = false;
  writable = true;
  expiredHeartbeat = false;
  sendBuffer: unknown[] = [];
  volatile = {
    emit: jest.fn(
      (
        event: string,
        payload: unknown,
        ack: (error: unknown, reply?: unknown) => void,
      ) => {
        if (!this.writable) return;
        if (this.expiredHeartbeat) {
          this.sendBuffer.push({ event, payload });
          return;
        }
        if (this.connected)
          this.emit(event, payload, (reply) => ack(null, reply));
      },
    ),
  };
  listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  packets: {
    event: string;
    payload: unknown;
    ack: (reply: unknown) => void;
  }[] = [];
  on(event: string, listener: (...args: unknown[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  emit(event: string, payload: unknown, ack: (reply: unknown) => void) {
    this.packets.push({ event, payload, ack });
  }
  connect() {
    this.connected = true;
    this.fire('connect');
  }
  disconnect() {
    this.connected = false;
  }
  removeAllListeners() {
    this.listeners.clear();
  }
  fire(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
let sockets: FakeSocket[];
let connection: MatchConnection;
let provider: { getAccessToken: jest.Mock };
let sequence: number;
beforeEach(() => {
  jest.useFakeTimers();
  sequence = 100;
  sockets = [];
  provider = { getAccessToken: jest.fn().mockResolvedValue('opaque-token') };
  connection = new MatchConnection({
    baseUrl: 'https://example.test',
    tokenProvider: provider,
    newRequestId: () => id(sequence++),
    socketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
});
afterEach(() => {
  connection.disconnect();
  jest.useRealTimers();
});
async function ready(session = state()) {
  await connection.connect();
  sockets.at(-1)!.packets[0]!.ack({ ok: true, data: session });
  await flush();
}
test('explicit sync gates actions and offline requests never enter the transport', async () => {
  await connection.connect();
  expect(connection.status).toBe('syncing');
  await expect(
    connection.request('queue.leave', {
      requestId: id(60),
      expectedAdmissionRevision: 0,
    }),
  ).rejects.toMatchObject({ code: 'OFFLINE' });
  expect(sockets[0]!.packets.map((p) => p.event)).toEqual(['session.sync']);
  sockets[0]!.packets[0]!.ack({ ok: true, data: state() });
  await flush();
  expect(connection.status).toBe('ready');
  connection.disconnect();
  await expect(
    connection.request('clock.ping', { requestId: id(60) }),
  ).rejects.toMatchObject({ code: 'OFFLINE' });
});
test('replacement stops automatic reconnect and rejects pending commands', async () => {
  await ready();
  const pending = connection.request('clock.ping', { requestId: id(60) });
  const rejected = expect(pending).rejects.toMatchObject({
    code: 'SESSION_REPLACED',
  });
  sockets[0]!.fire('game.error', { code: 'SESSION_REPLACED', requestId: null });
  await rejected;
  jest.advanceTimersByTime(60_000);
  await flush();
  expect(connection.status).toBe('replaced');
  expect(provider.getAccessToken).toHaveBeenCalledTimes(1);
  expect(sockets).toHaveLength(1);
});
test('disconnect refreshes token and syncs; old socket callbacks cannot change the new session', async () => {
  await ready();
  const old = sockets[0]!;
  const oldListener = old.listeners.get('session.update')![0]!;
  old.connected = false;
  old.fire('disconnect');
  expect(connection.consumer.ready).toBe(false);
  jest.advanceTimersByTime(500);
  await flush();
  expect(provider.getAccessToken).toHaveBeenCalledTimes(2);
  expect(connection.status).toBe('syncing');
  sockets[1]!.packets[0]!.ack({ ok: true, data: state(3) });
  await flush();
  oldListener({ ...state(), admissionRevision: 999 });
  expect(connection.consumer.state?.sessionId).toBe(id(3));
  expect(connection.consumer.state?.admissionRevision).toBe(0);
});
test('late provider resolution cannot attach a socket to a superseded generation', async () => {
  let resolve!: (token: string) => void;
  provider.getAccessToken.mockImplementationOnce(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  const first = connection.connect();
  await ready(state(3));
  resolve('old-secret');
  await first;
  expect(sockets).toHaveLength(1);
  expect(connection.consumer.state?.sessionId).toBe(id(3));
});
test('expiry and handshake authentication failures wait for deliberate refresh', async () => {
  await ready();
  sockets[0]!.fire('game.error', { code: 'UNAUTHENTICATED', requestId: null });
  jest.advanceTimersByTime(60_000);
  await flush();
  expect(connection.status).toBe('auth-required');
  expect(sockets).toHaveLength(1);
});
test('malformed ACKs cause canonical sync and timeout never retries a gameplay packet', async () => {
  await ready();
  const request = connection.request('answer.submit', {
    matchId: id(10),
    roundId: id(11),
    attemptId: id(12),
    text: 'unresolved',
  });
  const rejected = expect(request).rejects.toMatchObject({ code: 'TIMEOUT' });
  jest.advanceTimersByTime(5000);
  await rejected;
  expect(
    sockets[0]!.packets.filter((p) => p.event === 'answer.submit'),
  ).toHaveLength(1);
  const next = connection.request('clock.ping', { requestId: id(13) });
  const invalid = expect(next).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
  });
  sockets[0]!.packets
    .at(-1)!
    .ack({ ok: true, data: { token: 'must not surface' } });
  await invalid;
  expect(connection.status).toBe('syncing');
});
test('default Socket.IO adapter disables automatic reconnect and uses handshake auth', async () => {
  const socket = new FakeSocket();
  jest.mocked(io).mockReturnValue(socket as never);
  const real = new MatchConnection({
    baseUrl: 'https://example.test/',
    tokenProvider: provider,
    newRequestId: () => id(99),
  });
  await real.connect();
  expect(io).toHaveBeenCalledWith(
    'https://example.test/game',
    expect.objectContaining({
      auth: { accessToken: 'opaque-token' },
      autoConnect: false,
      reconnection: false,
      forceNew: true,
      transports: ['websocket'],
    }),
  );
  expect(socket.volatile.emit).toHaveBeenCalledWith(
    'session.sync',
    expect.any(Object),
    expect.any(Function),
  );
  socket.packets[0]!.ack({ ok: true, data: state() });
  await flush();
  socket.writable = false;
  const dropped = real.request('clock.ping', { requestId: id(80) });
  const rejected = expect(dropped).rejects.toMatchObject({ code: 'TIMEOUT' });
  jest.advanceTimersByTime(5000);
  await rejected;
  socket.writable = true;
  socket.expiredHeartbeat = true;
  const expired = real.request('clock.ping', { requestId: id(81) });
  const expiredRejected = expect(expired).rejects.toMatchObject({
    code: 'TIMEOUT',
  });
  expect(socket.sendBuffer).toEqual([]);
  jest.advanceTimersByTime(5000);
  await expiredRejected;
  expect(socket.packets).toHaveLength(1);
  real.disconnect();
});
test('publication between sync snapshot capture and ACK forces a fresh sync before actions', async () => {
  await connection.connect();
  const socket = sockets[0]!;
  socket.fire('session.update', { ...state(), admissionRevision: 1 });
  socket.packets[0]!.ack({ ok: true, data: state() });
  await flush();
  expect(connection.status).toBe('syncing');
  expect(connection.consumer.ready).toBe(false);
  expect(socket.packets.map((packet) => packet.event)).toEqual([
    'session.sync',
    'session.sync',
  ]);
  socket.packets[1]!.ack({
    ok: true,
    data: { ...state(), admissionRevision: 1 },
  });
  await flush();
  expect(connection.status).toBe('ready');
  expect(connection.consumer.state?.admissionRevision).toBe(1);
});
test('clock sampling uses only the correlated ACK when pong is emitted first', async () => {
  await ready();
  const socket = sockets[0]!;
  const pending = connection.sampleClock();
  const packet = socket.packets.at(-1)!;
  const { requestId } = packet.payload as { requestId: string };
  const sample = { requestId, serverReceivedAt: 1000, serverSentAt: 1010 };
  socket.fire('clock.pong', sample);
  expect(connection.clock.now()).toBeNull();
  jest.advanceTimersByTime(100);
  packet.ack({ ok: true, data: sample });
  expect(await pending).toBe(true);
  expect(connection.clock.now()).toBe(1055);
  socket.fire('clock.pong', { ...sample, serverSentAt: 1040 });
  expect(connection.clock.now()).toBe(1055);
});
test('a clock ACK cannot consume another outstanding request sample', async () => {
  await ready();
  const socket = sockets[0]!;
  const first = connection.sampleClock();
  const firstPacket = socket.packets.at(-1)!;
  const second = connection.sampleClock();
  const secondPacket = socket.packets.at(-1)!;
  const { requestId } = secondPacket.payload as { requestId: string };
  const sample = { requestId, serverReceivedAt: 1000, serverSentAt: 1010 };
  jest.advanceTimersByTime(100);
  firstPacket.ack({ ok: true, data: sample });
  expect(await first).toBe(false);
  expect(connection.clock.now()).toBeNull();
  secondPacket.ack({ ok: true, data: sample });
  expect(await second).toBe(true);
  expect(connection.clock.now()).toBe(1055);
});
