import type { MatchSetup } from '@typeduel/contracts';
import type { RoundDescriptor } from './types.js';
export interface RoundSource {
  checkAvailability(setup: MatchSetup): Promise<boolean>;
  nextRound(input: {
    matchId: string;
    setup: MatchSetup;
    roundNumber: number;
    level: number;
    usedWordIds: string[];
  }): Promise<RoundDescriptor>;
}
export const unavailableSource: RoundSource = {
  async checkAvailability() {
    return false;
  },
  async nextRound() {
    throw new Error('Source unavailable');
  },
};
