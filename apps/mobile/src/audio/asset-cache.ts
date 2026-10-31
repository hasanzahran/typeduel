import { fetch as expoFetch } from 'expo/fetch';
import { File, Paths } from 'expo-file-system';
import { digest, CryptoDigestAlgorithm } from 'expo-crypto';
import {
  AudioAccessReplySchema,
  AudioAccessRequestSchema,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_DURATION_MS,
  type PreparedRound,
} from '@typeduel/contracts';
import { MatchConnection } from '../features/match/connection';

export type AudioFailureCode =
  | 'DOWNLOAD_FAILED'
  | 'INTEGRITY_FAILED'
  | 'DECODE_FAILED'
  | 'PLAYBACK_FAILED'
  | 'LATE_PLAYBACK'
  | 'APP_INACTIVE';
export class AudioFailure extends Error {
  constructor(readonly code: AudioFailureCode) {
    super(code);
    this.name = 'AudioFailure';
  }
}
export interface ByteResponse {
  ok: boolean;
  status: number;
  url: string;
  redirected: boolean;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
}
export type AudioFetch = (
  url: string,
  init: RequestInit,
) => Promise<ByteResponse>;
export async function boundedBytes(
  response: ByteResponse,
  limit: number,
): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > limit)
  )
    throw new AudioFailure('DOWNLOAD_FAILED');
  const reader = response.body?.getReader();
  if (!reader) throw new AudioFailure('DOWNLOAD_FAILED');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        length += value.length;
        if (length > limit) throw new AudioFailure('DOWNLOAD_FAILED');
        chunks.push(value);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export interface VerifiedAsset {
  uri: string;
  remove(): void;
}
export interface AssetPorts {
  fetch: AudioFetch;
  hash(bytes: Uint8Array): Promise<string>;
  write(name: string, bytes: Uint8Array): Promise<VerifiedAsset>;
}
const nativePorts: AssetPorts = {
  fetch: async (url, init) => expoFetch(url, init),
  hash: async (bytes) => {
    const hash = await digest(
      CryptoDigestAlgorithm.SHA256,
      new Uint8Array(bytes).buffer,
    );
    return [...new Uint8Array(hash)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('');
  },
  async write(name, bytes) {
    const file = new File(Paths.cache, name);
    try {
      await file.write(bytes);
    } catch {
      if (file.exists) file.delete();
      throw new AudioFailure('DOWNLOAD_FAILED');
    }
    return {
      uri: file.uri,
      remove() {
        if (file.exists) file.delete();
      },
    };
  },
};
/** A single verified round file is owned by the audio controller and removed on disposal. */
export class AssetCache {
  constructor(
    private readonly connection: MatchConnection,
    private readonly ports: AssetPorts = nativePorts,
  ) {}
  async prepare(
    matchId: string,
    round: PreparedRound,
    signal: AbortSignal,
  ): Promise<VerifiedAsset> {
    const context = this.connection.captureHttpContext();
    const origin = new URL(context.baseUrl);
    // Credentials never travel over an unencrypted LAN or through a redirect.
    if (origin.protocol !== 'https:') throw new AudioFailure('DOWNLOAD_FAILED');
    const requestId = this.connection.newRequestId();
    const body = AudioAccessRequestSchema.parse({
      requestId,
      roundId: round.roundId,
      assetId: round.audio.assetId,
      audioVersion: round.audio.audioVersion,
    });
    const path = `/v1/audio/${body.assetId}/${body.audioVersion}`;
    const canonical = new URL(round.audio.url);
    if (
      canonical.origin !== origin.origin ||
      canonical.pathname !== path ||
      canonical.search ||
      canonical.hash ||
      canonical.username ||
      canonical.password ||
      round.audio.clipDurationMs > MAX_AUDIO_DURATION_MS
    )
      throw new AudioFailure('INTEGRITY_FAILED');
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal.addEventListener('abort', cancel);
    if (signal.aborted) cancel();
    const timeout = setTimeout(cancel, 15_000);
    const current = () => {
      const snapshot = this.connection.consumer.snapshot;
      if (
        abort.signal.aborted ||
        !this.connection.isCurrent(context) ||
        !snapshot ||
        snapshot.matchId !== matchId ||
        !('round' in snapshot) ||
        snapshot.round?.roundId !== round.roundId ||
        snapshot.round.audio.audioVersion !== body.audioVersion
      )
        throw new AudioFailure('DOWNLOAD_FAILED');
    };
    const headers = {
      Authorization: `Bearer ${context.accessToken}`,
      'X-TypeDuel-Session-Id': context.scope.sessionId,
    };
    const get = async (url: string, init: RequestInit, limit: number) => {
      const response = await this.ports.fetch(url, {
        ...init,
        signal: abort.signal,
        redirect: 'error',
        headers: { ...headers, ...init.headers },
      });
      if (!response.ok || response.redirected || response.url !== url)
        throw new AudioFailure('DOWNLOAD_FAILED');
      const bytes = await boundedBytes(response, limit);
      current();
      return bytes;
    };
    try {
      current();
      const json = await get(
        `${context.baseUrl}/v1/matches/${matchId}/audio-access`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        32_768,
      );
      const reply = AudioAccessReplySchema.safeParse(
        JSON.parse(new TextDecoder().decode(json)),
      );
      if (!reply.success) throw new AudioFailure('DOWNLOAD_FAILED');
      if (!reply.data.ok) {
        if (reply.data.error.requestId === requestId)
          this.connection.reportTransportError(reply.data.error.code);
        throw new AudioFailure('DOWNLOAD_FAILED');
      }
      const grant = reply.data.data;
      const url = new URL(grant.url);
      const now = this.connection.clock.now();
      if (
        grant.requestId !== requestId ||
        grant.matchId !== matchId ||
        grant.roundId !== body.roundId ||
        grant.assetId !== body.assetId ||
        grant.audioVersion !== body.audioVersion ||
        grant.serverInstanceId !== context.scope.serverInstanceId ||
        grant.sessionId !== context.scope.sessionId ||
        grant.admissionRevision !== context.scope.admissionRevision ||
        url.origin !== origin.origin ||
        url.pathname !== path ||
        !url.searchParams.get('grant') ||
        [...url.searchParams.keys()].some((key) => key !== 'grant') ||
        url.searchParams.getAll('grant').length !== 1 ||
        now === null ||
        grant.expiresAt <= now ||
        grant.expiresAt > now + 61_000
      )
        throw new AudioFailure('DOWNLOAD_FAILED');
      const bytes = await get(grant.url, { method: 'GET' }, MAX_AUDIO_BYTES);
      if (
        bytes.length !== grant.byteLength ||
        (await this.ports.hash(bytes)) !== round.audio.sha256
      )
        throw new AudioFailure('INTEGRITY_FAILED');
      current();
      const asset = await this.ports.write(
        `typeduel-${body.assetId}-${body.audioVersion}-${requestId}.mp3`,
        bytes,
      );
      try {
        current();
        return asset;
      } catch (error) {
        asset.remove();
        throw error;
      }
    } catch (error) {
      throw error instanceof AudioFailure
        ? error
        : new AudioFailure('DOWNLOAD_FAILED');
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
    }
  }
}
