export interface ActorClock {
  monoNow(): number;
  utcNow(): number;
  schedule(atMonoMs: number, callback: () => void): () => void;
}
export function createSystemClock(): ActorClock {
  const monoNow = () => Number(process.hrtime.bigint() / 1_000_000n);
  return {
    monoNow,
    utcNow: () => Date.now(),
    schedule(atMonoMs, callback) {
      const timer = setTimeout(
        callback,
        Math.min(2_147_483_647, Math.max(0, atMonoMs - monoNow())),
      );
      return () => clearTimeout(timer);
    },
  };
}
