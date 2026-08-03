export type Item = 'glass' | 'saw' | 'life' | 'cuffs';
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
  shell: Shell;
  damage: number; // 0 for blank, 1 or 2 for live
  sawed: boolean;
  itemGained: Item | null; // self-shot reward, null if none received
  itemDiscarded: boolean; // reward lost to the 4-item cap
  itemSuppressed: boolean; // reward denied because the chamber was peeked
  eliminatedId: number | null;
  cuffSkippedIds: number[]; // players whose cuffs triggered on this turn pass
}

export interface GameState {
  phase: Phase;
  players: Player[];
  activePlayerId: number;
  shellQueue: Shell[]; // hidden order, fires front-to-back
  spentShells: Shell[]; // revealed, in fired order
  roundComposition: { live: number; blank: number }; // public
  sawActive: boolean;
  peekedShell: Shell | null; // set by glass, cleared on fire
  winnerId: number | null;
  round: number;
  // set by FIRE, consumed by RESOLVE_SHOT; peeked = chamber was revealed by a glass
  pendingShot: { targetId: number; shell: Shell; peeked: boolean } | null;
  lastShot: ShotResult | null;
}

export type Action =
  // seats wins if both are given; playerNames is the all-humans shorthand
  | { type: 'START_GAME'; playerNames?: string[]; seats?: SeatConfig[] }
  | { type: 'BEGIN_ROUND' }
  | { type: 'USE_ITEM'; item: Item; targetId?: number } // targetId required for cuffs
  | { type: 'FIRE'; targetId: number }
  | { type: 'RESOLVE_SHOT' }
  | { type: 'RESTART' };
