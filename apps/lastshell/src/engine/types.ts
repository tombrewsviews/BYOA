export type Item = 'glass' | 'saw' | 'life' | 'cuffs' | 'split' | 'golden';

/**
 * Blank self-shots needed to earn a golden bullet. It is the only item that
 * cannot drop at random — it must be earned by taking the risk three times.
 */
export const GOLDEN_BLANKS_REQUIRED = 3;
export type Shell = 'live' | 'blank';

/** Agent skill tiers. `steady` plays the odds; `sharp` also reads the table. */
export type Tier = 'reckless' | 'steady' | 'sharp';

export interface Player {
  id: number;
  name: string;
  lives: number;
  items: Item[];
  alive: boolean;
  cuffedBy: number | null; // id of the player whose handcuffs are on this player
  kind: 'human' | 'agent';
  tier?: Tier; // agents only
  /**
   * Blank self-shots this player has survived. Counts up for the whole game and
   * resets to 0 each time a golden bullet is earned, so the third blank in a row
   * is always the one that pays out.
   */
  blankSelfShots: number;
}

/** One seat as configured on the setup screen. */
export interface SeatConfig {
  name: string;
  kind: 'human' | 'agent';
  tier?: Tier;
}

export type Phase = 'setup' | 'roundIntro' | 'turn' | 'resolving' | 'gameOver';

/** Everything the UI needs to animate the outcome of the last resolved shot. */
export interface ShotResult {
  shooterId: number;
  targetId: number;
  /** second target, split shell only — takes the same shell and damage */
  targetId2?: number;
  shell: Shell;
  damage: number; // 0 for blank, 1 or 2 for live — per target
  sawed: boolean;
  /** true when this shot was fired through a split shell */
  split: boolean;
  itemGained: Item | null; // self-shot reward, null if none received
  itemDiscarded: boolean; // reward lost to the 4-item cap
  itemSuppressed: boolean; // reward denied because the chamber was peeked
  eliminatedId: number | null;
  /** second elimination, split shell only */
  eliminatedId2?: number | null;
  cuffSkippedIds: number[]; // players whose cuffs triggered on this turn pass
  /** the blank self-shot that just earned a golden bullet, if any */
  goldenEarned?: boolean;
}

/** What a golden bullet did — reported separately since it is not a shot. */
export interface GoldenResult {
  userId: number;
  /** every player who lost lives, and how many they had left afterwards */
  hit: { id: number; livesLost: number; livesLeft: number }[];
  eliminatedIds: number[];
  k: number; // bump per use so the UI can re-animate
}

export interface GameState {
  phase: Phase;
  players: Player[];
  activePlayerId: number;
  shellQueue: Shell[]; // hidden order, fires front-to-back
  spentShells: Shell[]; // revealed, in fired order
  roundComposition: { live: number; blank: number }; // public
  sawActive: boolean;
  /** set by the split shell; the next shot hits two targets. Consumed on fire. */
  splitActive: boolean;
  peekedShell: Shell | null; // set by glass, cleared on fire
  winnerId: number | null;
  round: number;
  // set by FIRE, consumed by RESOLVE_SHOT; peeked = chamber was revealed by a glass
  pendingShot: {
    targetId: number;
    /** second target when the shot was split */
    targetId2?: number;
    shell: Shell;
    peeked: boolean;
    split: boolean;
  } | null;
  lastShot: ShotResult | null;
  /** set when a golden bullet fires; drives its own overlay, cleared on next shot */
  lastGolden: GoldenResult | null;
}

export type Action =
  // seats wins if both are given; playerNames is the all-humans shorthand
  | { type: 'START_GAME'; playerNames?: string[]; seats?: SeatConfig[] }
  | { type: 'BEGIN_ROUND' }
  | { type: 'USE_ITEM'; item: Item; targetId?: number } // targetId required for cuffs
  // targetId2 is only honoured while splitActive; it must differ from targetId
  | { type: 'FIRE'; targetId: number; targetId2?: number }
  | { type: 'RESOLVE_SHOT' }
  | { type: 'RESTART' };
