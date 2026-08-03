import { describe, expect, it } from 'vitest';
import { initialState, reducer } from '../reducer';
import { seed, unseed } from '../rng';
import { decide } from './brain';
import { toAgentView } from './view';
import type { GameState, SeatConfig, Tier } from '../types';

/**
 * Head-to-head: one agent of tier A vs one of tier B, plus a passive human who
 * always self-shoots. Returns how often each tier's seat won.
 */
function duel(a: Tier, b: Tier, games: number) {
  let aWins = 0, bWins = 0;
  for (let g = 0; g < games; g++) {
    // alternate seating so seat order can't explain the result
    const flip = g % 2 === 1;
    const seats: SeatConfig[] = [
      { name: 'H', kind: 'human' },
      { name: 'A', kind: 'agent', tier: flip ? b : a },
      { name: 'B', kind: 'agent', tier: flip ? a : b },
    ];
    let s: GameState = reducer(initialState(), { type: 'START_GAME', seats });
    let steps = 0;
    while (s.phase !== 'gameOver' && steps++ < 4000) {
      if (s.phase === 'roundIntro') { s = reducer(s, { type: 'BEGIN_ROUND' }); continue; }
      if (s.phase === 'resolving') { s = reducer(s, { type: 'RESOLVE_SHOT' }); continue; }
      const act = s.players.find((p) => p.id === s.activePlayerId)!;
      if (act.kind === 'agent') {
        const d = decide(toAgentView(s, act.id));
        const nxt = reducer(s, d.action);
        s = nxt === s ? reducer(s, { type: 'FIRE', targetId: act.id }) : nxt;
      } else {
        s = reducer(s, { type: 'FIRE', targetId: act.id });
      }
    }
    const w = s.players.find((p) => p.id === s.winnerId);
    if (w?.kind !== 'agent') continue;
    const wonTier = w.tier;
    const aTier = flip ? b : a;
    if (w.id === 2) { if (aTier === a) aWins++; else bWins++; }
    else if (w.id === 3) { if (aTier === a) bWins++; else aWins++; }
    void wonTier;
  }
  return { aWins, bWins };
}

describe('tier strength ordering (head-to-head)', () => {
  it('sharp beats reckless clearly', () => {
    seed(20260803);
    const { aWins, bWins } = duel('sharp', 'reckless', 400);
    console.log('sharp vs reckless →', { sharp: aWins, reckless: bWins });
    expect(aWins).toBeGreaterThan(bWins);
    unseed();
  });

  it('steady beats reckless', () => {
    seed(777);
    const { aWins, bWins } = duel('steady', 'reckless', 400);
    console.log('steady vs reckless →', { steady: aWins, reckless: bWins });
    expect(aWins).toBeGreaterThan(bWins);
    unseed();
  });

  it('sharp beats steady', () => {
    seed(31337);
    const { aWins, bWins } = duel('sharp', 'steady', 400);
    console.log('sharp vs steady →', { sharp: aWins, steady: bWins });
    // measured 229–171 at this seed; the edge is real but narrower than the
    // gap to reckless, which is the intended shape of the ladder
    expect(aWins).toBeGreaterThan(bWins);
    unseed();
  });
});
