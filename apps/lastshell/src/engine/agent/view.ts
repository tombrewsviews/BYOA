import type { GameState, Item, Shell, Tier } from '../types';

/**
 * What an agent is allowed to know.
 *
 * CRITICAL: this deliberately omits `shellQueue`. That field holds the hidden
 * shell ORDER — an agent given the raw GameState could read the future and play
 * unbeatably. Everything here is information a human at the table also has:
 * the public round composition (§4), the revealed spent tray, and each player's
 * visible lives/items/cuffs.
 *
 * `peekedShell` is the one piece of private information, and it is only ever
 * populated for the agent that spent its own magnifying glass.
 */
export interface AgentOpponent {
  id: number;
  name: string;
  lives: number;
  items: Item[];
  alive: boolean;
  cuffedBy: number | null;
  kind: 'human' | 'agent';
}

export interface AgentSelf extends AgentOpponent {
  tier: Tier;
  /** blank self-shots so far; GOLDEN_BLANKS_REQUIRED of them earn a golden bullet */
  blankSelfShots: number;
}

export interface AgentView {
  self: AgentSelf;
  opponents: AgentOpponent[]; // alive and dead, excluding self
  shellsRemaining: number; // COUNT only — never the contents
  composition: { live: number; blank: number }; // public, for the whole round
  spentShells: Shell[]; // revealed in fired order
  peekedShell: Shell | null; // only if THIS agent peeked the current chamber
  sawActive: boolean;
  /** a split shell is armed: the next shot hits two targets */
  splitActive: boolean;
  round: number;
}

function toOpponent(p: GameState['players'][number]): AgentOpponent {
  return {
    id: p.id,
    name: p.name,
    lives: p.lives,
    items: p.items,
    alive: p.alive,
    cuffedBy: p.cuffedBy,
    kind: p.kind,
  };
}

/**
 * Project the full game state down to what agent `agentId` may see.
 * The returned object is the ONLY input the brain receives.
 */
export function toAgentView(state: GameState, agentId: number): AgentView {
  const me = state.players.find((p) => p.id === agentId);
  if (!me) throw new Error(`toAgentView: no such player ${agentId}`);
  return {
    self: { ...toOpponent(me), tier: me.tier ?? 'steady', blankSelfShots: me.blankSelfShots },
    opponents: state.players.filter((p) => p.id !== agentId).map(toOpponent),
    shellsRemaining: state.shellQueue.length,
    composition: { ...state.roundComposition },
    spentShells: [...state.spentShells],
    // the peek belongs to whoever is holding the gun; only surface it to them
    peekedShell: state.activePlayerId === agentId ? state.peekedShell : null,
    sawActive: state.sawActive,
    splitActive: state.splitActive,
    round: state.round,
  };
}

/**
 * Live shells left among the unfired ones, derived only from public info:
 * the round's announced composition minus what the spent tray reveals.
 */
export function liveRemaining(view: AgentView): number {
  const spentLive = view.spentShells.filter((s) => s === 'live').length;
  return Math.max(0, view.composition.live - spentLive);
}

/** Probability the next shell is live, from public info alone. */
export function pLive(view: AgentView): number {
  if (view.peekedShell) return view.peekedShell === 'live' ? 1 : 0;
  if (view.shellsRemaining <= 0) return 0;
  return Math.min(1, liveRemaining(view) / view.shellsRemaining);
}
