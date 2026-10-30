import type { MatchSnapshot } from '@typeduel/contracts';
import type { ActorClock } from './clock.js';
/** A round/version guard keeps stale source replies from opening a later round. */
export function createLifecycle(options: {
  clock: ActorClock;
  resultHoldMs: number;
  prepare(expectedRound: number): Promise<void>;
}) {
  let closed = false;
  let key: string | null = null;
  let cancel: (() => void) | undefined;
  return {
    observe(snapshot: MatchSnapshot) {
      if (closed) return;
      if (snapshot.phase === 'COMPLETED' || snapshot.phase === 'ABORTED') {
        closed = true;
        cancel?.();
        return;
      }
      if (
        snapshot.phase !== 'ROUND_RESULT' &&
        !(snapshot.phase === 'PREPARING_ROUND' && snapshot.roundNumber === 0)
      )
        return;
      const nextKey = `${snapshot.roundNumber}:${snapshot.phase}`;
      if (nextKey === key) return;
      key = nextKey;
      cancel?.();
      cancel = options.clock.schedule(
        options.clock.monoNow() +
          (snapshot.phase === 'ROUND_RESULT' ? options.resultHoldMs : 0),
        () => {
          if (!closed && key === nextKey)
            void options.prepare(snapshot.roundNumber).catch(() => {});
        },
      );
    },
    close() {
      closed = true;
      cancel?.();
    },
  };
}
