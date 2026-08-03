import { randInt, shuffle } from './rng';
import type { Shell } from './types';

export interface RoundLoad {
  queue: Shell[];
  live: number;
  blank: number;
}

export const MAX_SHELLS = 8;

/**
 * §4 Round setup: shellCount ∈ [min(aliveCount, 8), 8] inclusive; composition
 * uniform among valid (live, blank) pairs with live+blank = shellCount,
 * 1 ≤ live ≤ 4, 1 ≤ blank ≤ 4; order is a hidden Fisher–Yates shuffle.
 *
 * The low bound is clamped: past 8 seats the round can no longer give every
 * player a shell, so it loads a full 8 and the round simply ends early (the
 * next round reloads and play continues from whoever holds the gun). Without
 * the clamp randInt(9, 8) inverts and yields counts above the cap.
 */
export function generateRound(aliveCount: number): RoundLoad {
  const count = randInt(Math.min(aliveCount, MAX_SHELLS), MAX_SHELLS);
  const minLive = Math.max(1, count - 4);
  const maxLive = Math.min(4, count - 1);
  const live = randInt(minLive, maxLive);
  const blank = count - live;
  const shells: Shell[] = [
    ...(Array(live).fill('live') as Shell[]),
    ...(Array(blank).fill('blank') as Shell[]),
  ];
  return { queue: shuffle(shells), live, blank };
}
