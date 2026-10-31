import { MAX_AUDIO_BYTES, type PreparedRound } from '@typeduel/contracts';
import {
  AssetCache,
  AudioFailure,
  boundedBytes,
  type AssetPorts,
  type ByteResponse,
} from './asset-cache';
import type { MatchConnection } from '../features/match/connection';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = {
  serverInstanceId: id(1),
  sessionId: id(2),
  admissionRevision: 4,
};
const matchId = id(3);
const round: PreparedRound = {
  roundId: id(4),
  roundNumber: 1,
  level: 1,
  audio: {
    assetId: id(5),
    audioVersion: id(6),
    url: `https://game.test/v1/audio/${id(5)}/${id(6)}`,
    clipDurationMs: 500,
    sha256: 'a'.repeat(64),
  },
};
const stream = (chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
const reply = (
  value: unknown,
  url: string,
  chunks?: Uint8Array[],
): ByteResponse => {
  const bytes = chunks ?? [new TextEncoder().encode(JSON.stringify(value))];
  return {
    ok: true,
    status: 200,
    url,
    redirected: false,
    headers: { get: () => null },
    body: stream(bytes),
  };
};
const grant = {
  ok: true as const,
  data: {
    ...scope,
    requestId: id(7),
    matchId,
    roundId: round.roundId,
    assetId: round.audio.assetId,
    audioVersion: round.audio.audioVersion,
    url: `${round.audio.url}?grant=opaque`,
    expiresAt: 50_000,
    byteLength: 3,
  },
};

function setup(fetch: jest.Mock) {
  const snapshot = { matchId, round };
  const connection = {
    captureHttpContext: () => ({
      generation: 1,
      scope,
      accessToken: 'secret-access-token',
      baseUrl: 'https://game.test',
    }),
    newRequestId: () => id(7),
    isCurrent: () => true,
    consumer: { snapshot },
    clock: { now: () => 1000 },
    reportTransportError: jest.fn(),
  } as unknown as MatchConnection;
  const remove = jest.fn();
  const ports: AssetPorts = {
    fetch,
    hash: jest.fn().mockResolvedValue('a'.repeat(64)),
    write: jest.fn().mockResolvedValue({ uri: 'file:///verified.mp3', remove }),
  };
  return { cache: new AssetCache(connection, ports), ports, remove, snapshot };
}

test('issues a scoped grant and downloads exact same-origin bytes without redirects', async () => {
  const fetch = jest
    .fn()
    .mockImplementationOnce((url: string) => Promise.resolve(reply(grant, url)))
    .mockImplementationOnce((url: string) =>
      Promise.resolve(reply(null, url, [new Uint8Array([1, 2, 3])])),
    );
  const { cache, ports } = setup(fetch);
  await expect(
    cache.prepare(matchId, round, new AbortController().signal),
  ).resolves.toMatchObject({
    uri: 'file:///verified.mp3',
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [, init] of fetch.mock.calls)
    expect(init).toMatchObject({
      redirect: 'error',
      headers: expect.objectContaining({
        Authorization: 'Bearer secret-access-token',
        'X-TypeDuel-Session-Id': scope.sessionId,
      }),
    });
  expect(ports.write).toHaveBeenCalledWith(
    expect.stringMatching(/^typeduel-/),
    new Uint8Array([1, 2, 3]),
  );
});

test('rejects off-origin grants before sending credentials to their URL', async () => {
  const hostile = {
    ...grant,
    data: {
      ...grant.data,
      url: `https://attacker.test/v1/audio/${id(5)}/${id(6)}?grant=opaque`,
    },
  };
  const fetch = jest
    .fn()
    .mockImplementation((url: string) => Promise.resolve(reply(hostile, url)));
  const { cache } = setup(fetch);
  await expect(
    cache.prepare(matchId, round, new AbortController().signal),
  ).rejects.toMatchObject({
    code: 'DOWNLOAD_FAILED',
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![0]).toBe(
    `https://game.test/v1/matches/${matchId}/audio-access`,
  );
});

test('bounds streamed bodies even without a content length', async () => {
  const response = reply(null, 'https://game.test/audio', [
    new Uint8Array(MAX_AUDIO_BYTES),
    new Uint8Array([1]),
  ]);
  await expect(boundedBytes(response, MAX_AUDIO_BYTES)).rejects.toEqual(
    new AudioFailure('DOWNLOAD_FAILED'),
  );
});

test('removes a written file if the session becomes stale during the write', async () => {
  let current = true;
  let finish!: (value: { uri: string; remove(): void }) => void;
  const fetch = jest
    .fn()
    .mockImplementationOnce((url: string) => Promise.resolve(reply(grant, url)))
    .mockImplementationOnce((url: string) =>
      Promise.resolve(reply(null, url, [new Uint8Array([1, 2, 3])])),
    );
  const { cache, ports, remove } = setup(fetch);
  (
    cache as unknown as { connection: { isCurrent(): boolean } }
  ).connection.isCurrent = () => current;
  jest
    .mocked(ports.write)
    .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  const pending = cache.prepare(matchId, round, new AbortController().signal);
  for (let index = 0; index < 20 && !finish; index++) await Promise.resolve();
  expect(finish).toBeDefined();
  current = false;
  finish({ uri: 'file:///verified.mp3', remove });
  await expect(pending).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
  expect(remove).toHaveBeenCalledTimes(1);
});
