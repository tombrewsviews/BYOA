/**
 * Centralized RNG. All game randomness goes through this module.
 * Defaults to Math.random; seedable (mulberry32) for deterministic tests.
 */
let next: () => number = Math.random;

export function seed(s: number): void {
  let a = s >>> 0;
  next = () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function unseed(): void {
  next = Math.random;
}

export function random(): number {
  return next();
}

/** Uniform integer in [min, max], inclusive on both ends. */
export function randInt(min: number, max: number): number {
  return min + Math.floor(next() * (max - min + 1));
}

export function pick<T>(arr: readonly T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

/** In-place Fisher–Yates shuffle. Returns the same array. */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
