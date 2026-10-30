import { type SessionState, type MatchSetup } from '@typeduel/contracts';
import { MatchLobby } from './lobby';
import { MatchConsumer, sameSession } from './consumer';
import { MatchConnection, type HttpContext } from './connection';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = {
  serverInstanceId: id(1),
  sessionId: id(2),
  admissionRevision: 0,
};
const setup: MatchSetup = {
  mode: 'classic',
  categorySlug: 'general',
  difficulty: 1,
};
const code = 'a'.repeat(22);
let consumer: MatchConsumer;
let lobby: MatchLobby;
let fetchRoom: jest.Mock;
let request: jest.Mock;
let connection: MatchConnection;
let sequence: number;
const idle = (revision: number): SessionState => ({
  ...scope,
  admissionRevision: revision,
  admission: { kind: 'idle' },
});
const queued = (revision: number): SessionState => ({
  ...scope,
  admissionRevision: revision,
  admission: { kind: 'queued', ticketId: id(10), setup, joinedAt: 1000 },
});
beforeEach(() => {
  consumer = new MatchConsumer();
  consumer.beginGeneration(1);
  consumer.acceptSession(idle(0), 1, true);
  fetchRoom = jest.fn();
  request = jest.fn();
  sequence = 100;
  connection = {
    consumer,
    status: 'ready',
    newRequestId: () => id(sequence++),
    request,
    captureHttpContext: () => ({
      generation: 1,
      scope: {
        serverInstanceId: consumer.state!.serverInstanceId,
        sessionId: consumer.state!.sessionId,
        admissionRevision: consumer.state!.admissionRevision,
      },
      accessToken: 'opaque-token',
      baseUrl: 'https://example.test',
    }),
    isCurrent: (context: HttpContext) =>
      consumer.ready &&
      consumer.state !== null &&
      sameSession(context.scope, consumer.state),
    synchronize: jest.fn(),
    reportTransportError: jest.fn(),
  } as unknown as MatchConnection;
  lobby = new MatchLobby(connection, fetchRoom);
});
test('HTTP uses bearer and current-session headers with immutable revision; network retries preserve it', async () => {
  fetchRoom.mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce({
    json: async () => ({ ok: true, data: queued(1) }),
  });
  await expect(lobby.createRoom(setup, id(60))).rejects.toMatchObject({
    code: 'SERVER_UNAVAILABLE',
  });
  await lobby.createRoom(setup, id(60));
  const [url, init] = fetchRoom.mock.calls[0]!;
  expect(url).toBe('https://example.test/v1/rooms');
  expect(init.headers).toMatchObject({
    Authorization: 'Bearer opaque-token',
    'x-typeduel-session-id': id(2),
  });
  expect(JSON.parse(init.body)).toEqual({
    setup,
    requestId: id(60),
    expectedAdmissionRevision: 0,
  });
  expect(fetchRoom.mock.calls[1]![1].body).toBe(init.body);
});
test('late HTTP response cannot replace newer queue or match admission', async () => {
  let finish!: (response: { json(): Promise<unknown> }) => void;
  fetchRoom.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = lobby.createRoom(setup);
  consumer.acceptSession(queued(2), 1);
  finish({ json: async () => ({ ok: true, data: idle(1) }) });
  await expect(pending).rejects.toMatchObject({ code: 'STALE_SESSION' });
  expect(consumer.state?.admission.kind).toBe('queued');
});
test('canonical event arriving before the same HTTP reply does not turn success into failure', async () => {
  let finish!: (response: { json(): Promise<unknown> }) => void;
  fetchRoom.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = lobby.createRoom(setup);
  consumer.acceptSession(queued(1), 1);
  finish({ json: async () => ({ ok: true, data: queued(1) }) });
  expect((await pending).admission.kind).toBe('queued');
});
test('lobby readiness uses lobby identity and never emits audio readiness', async () => {
  request.mockResolvedValue(idle(1));
  await lobby.ready(id(20), true, id(60));
  expect(request.mock.calls).toEqual([
    [
      'lobby.ready',
      {
        requestId: id(60),
        expectedAdmissionRevision: 0,
        lobbyId: id(20),
        ready: true,
      },
    ],
  ]);
});
test('reusing a control ID with changed input fails before transport', async () => {
  request.mockResolvedValue(queued(1));
  await lobby.joinQueue(setup, id(60));
  await expect(
    lobby.joinQueue({ ...setup, difficulty: 2 }, id(60)),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  expect(request).toHaveBeenCalledTimes(1);
});
test('preview never changes admission and is discarded after its captured revision', async () => {
  const preview = {
    ...scope,
    preview: {
      lobbyId: id(20),
      setup,
      hostId: id(30),
      expiresAt: 2000,
      available: true,
    },
  };
  fetchRoom.mockResolvedValueOnce({
    json: async () => ({ ok: true, data: preview }),
  });
  expect(await lobby.previewRoom(code, id(60))).toEqual(preview);
  expect(consumer.state?.admission.kind).toBe('idle');
  consumer.acceptSession(queued(1), 1);
  fetchRoom.mockResolvedValueOnce({
    json: async () => ({ ok: true, data: preview }),
  });
  await expect(lobby.previewRoom(code, id(61))).rejects.toMatchObject({
    code: 'STALE_SESSION',
  });
});
test('join and cancel use the frozen room endpoint and mutation bodies', async () => {
  fetchRoom.mockResolvedValue({
    json: async () => ({ ok: true, data: idle(0) }),
  });
  await lobby.joinRoom(code, id(60));
  await lobby.cancelRoom(code, id(61));
  expect(fetchRoom.mock.calls[0]![0]).toBe(
    `https://example.test/v1/rooms/${code}/join`,
  );
  expect(fetchRoom.mock.calls[1]![1].method).toBe('DELETE');
  expect(JSON.parse(fetchRoom.mock.calls[1]![1].body)).toEqual({
    requestId: id(61),
    expectedAdmissionRevision: 0,
  });
});
test('transport error correlation prevents unrelated errors from replacing the session', async () => {
  fetchRoom.mockResolvedValue({
    json: async () => ({
      ok: false,
      error: { code: 'SESSION_REPLACED', requestId: id(999) },
    }),
  });
  await expect(lobby.createRoom(setup, id(60))).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
  });
  expect(connection.reportTransportError).not.toHaveBeenCalled();
});
test('settled control history rotates with authenticated scope without losing uncertain fingerprints', async () => {
  request.mockResolvedValue(idle(0));
  for (let n = 0; n < 128; n++) await lobby.leaveQueue(id(1000 + n));
  await expect(lobby.leaveQueue(id(2000))).rejects.toMatchObject({
    code: 'RATE_LIMITED',
  });
  consumer.acceptSession({ ...idle(0), sessionId: id(3) }, 1, true);
  request.mockResolvedValue({ ...idle(0), sessionId: id(3) });
  await expect(lobby.leaveQueue(id(2000))).resolves.toMatchObject({
    sessionId: id(3),
  });
  request.mockRejectedValueOnce(new Error('uncertain'));
  await expect(lobby.leaveQueue(id(2001))).rejects.toThrow('uncertain');
  consumer.acceptSession({ ...idle(0), sessionId: id(4) }, 1, true);
  request.mockResolvedValue({ ...idle(0), sessionId: id(4) });
  await expect(lobby.leaveQueue(id(2001))).rejects.toMatchObject({
    code: 'IDEMPOTENCY_CONFLICT',
  });
  await expect(lobby.leaveQueue(id(2002))).resolves.toMatchObject({
    sessionId: id(4),
  });
});
