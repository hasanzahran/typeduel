import { ClockPongSchema, RequestSchema } from '@typeduel/contracts';

/** Display estimate only. Never used to timestamp submissions or award outcomes. */
export class DisplayClock {
  private pending = new Map<string, { mono: number; wall: number }>();
  private samples: { server: number; mono: number; rtt: number }[] = [];
  constructor(
    private readonly mono: () => number = () => performance.now(),
    private readonly wall: () => number = () => Date.now(),
  ) {}
  start(requestId: string): void {
    RequestSchema.parse({ requestId });
    if (this.pending.size >= 8)
      this.pending.delete(this.pending.keys().next().value!);
    this.pending.set(requestId, { mono: this.mono(), wall: this.wall() });
  }
  receive(input: unknown): boolean {
    const result = ClockPongSchema.safeParse(input);
    if (!result.success) return false;
    const pong = result.data;
    const sent = this.pending.get(pong.requestId);
    this.pending.delete(pong.requestId);
    if (!sent) return false;
    const now = this.mono();
    const elapsed = now - sent.mono;
    const processing = pong.serverSentAt - pong.serverReceivedAt;
    const rtt = elapsed - processing;
    if (
      elapsed < 0 ||
      elapsed > 10_000 ||
      rtt < 0 ||
      Math.abs(this.wall() - sent.wall - elapsed) > 250
    )
      return false;
    this.samples.push({ server: pong.serverSentAt + rtt / 2, mono: now, rtt });
    this.samples = this.samples
      .filter((s) => now - s.mono <= 10_000)
      .slice(-16);
    return true;
  }
  /** Half RTT estimates transport uncertainty; asymmetric paths can exceed it. */
  quality(): {
    ageMs: number;
    uncertaintyMs: number;
    serverNow: number;
  } | null {
    const now = this.mono();
    this.samples = this.samples.filter(
      (sample) => now >= sample.mono && now - sample.mono <= 10_000,
    );
    const sample = this.samples.reduce<(typeof this.samples)[number] | null>(
      (best, candidate) =>
        !best || candidate.rtt < best.rtt ? candidate : best,
      null,
    );
    return sample
      ? {
          ageMs: now - sample.mono,
          uncertaintyMs: sample.rtt / 2,
          serverNow: sample.server + now - sample.mono,
        }
      : null;
  }
  now(): number | null {
    return this.quality()?.serverNow ?? null;
  }
  usable(): boolean {
    const quality = this.quality();
    return quality !== null && quality.uncertaintyMs <= 100;
  }
  remaining(deadlineAt: number): number | null {
    const now = this.now();
    return now === null ? null : Math.max(0, deadlineAt - now);
  }
  /** Host must call on suspension/resume and connection generation changes. */
  invalidate(): void {
    this.samples = [];
    this.pending.clear();
  }
}
