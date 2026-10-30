import { ClockPongSchema, RequestSchema } from '@typeduel/contracts';

/** Display estimate only. Never used to timestamp submissions or award outcomes. */
export class DisplayClock {
  private pending = new Map<string, { mono: number; wall: number }>();
  private sample: { server: number; mono: number; rtt: number } | null = null;
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
    if (
      !this.sample ||
      rtt <= this.sample.rtt ||
      now - this.sample.mono > 30_000
    )
      this.sample = { server: pong.serverSentAt + rtt / 2, mono: now, rtt };
    return true;
  }
  now(): number | null {
    if (!this.sample) return null;
    const elapsed = this.mono() - this.sample.mono;
    if (elapsed < 0 || elapsed > 60_000) {
      this.invalidate();
      return null;
    }
    return this.sample.server + elapsed;
  }
  remaining(deadlineAt: number): number | null {
    const now = this.now();
    return now === null ? null : Math.max(0, deadlineAt - now);
  }
  /** Host must call on suspension/resume and connection generation changes. */
  invalidate(): void {
    this.sample = null;
    this.pending.clear();
  }
}
