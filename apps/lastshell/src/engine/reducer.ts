import { pick } from './rng';
import { generateRound } from './shells';
import type { Action, GameState, Item, Player, SeatConfig, ShotResult } from './types';

export const MAX_ITEMS = 4;
export const START_LIVES = 3;
export const MAX_PLAYERS = 11; // 8 humans + 3 agents
export const MIN_PLAYERS = 2; // two seats minimum; one may be the only human
export const MAX_HUMANS = 8;
export const MAX_AGENTS = 3;
export const MIN_HUMANS = 1;

const ITEMS: readonly Item[] = ['glass', 'saw', 'life', 'cuffs'];

export function initialState(): GameState {
  return {
    phase: 'setup',
    players: [],
    activePlayerId: 0,
    shellQueue: [],
    spentShells: [],
    roundComposition: { live: 0, blank: 0 },
    sawActive: false,
    peekedShell: null,
    winnerId: null,
    round: 0,
    pendingShot: null,
    lastShot: null,
  };
}

function seatIndex(players: Player[], id: number): number {
  return players.findIndex((p) => p.id === id);
}

/** Next alive player in seat order, scanning clockwise from (and excluding) fromId's seat. */
function nextAliveFrom(players: Player[], fromId: number): number {
  const start = seatIndex(players, fromId);
  for (let i = 1; i <= players.length; i++) {
    const p = players[(start + i) % players.length];
    if (p.alive) return p.id;
  }
  return fromId;
}

export function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'START_GAME': {
      const requested: SeatConfig[] =
        action.seats ?? (action.playerNames ?? []).map((name) => ({ name, kind: 'human' }));
      const seats = requested.slice(0, MAX_PLAYERS);
      if (seats.length < MIN_PLAYERS) return state;
      // A table needs a human to play for, and agents are capped (§3).
      if (seats.filter((s) => s.kind === 'human').length < MIN_HUMANS) return state;
      if (seats.filter((s) => s.kind === 'agent').length > MAX_AGENTS) return state;
      const players: Player[] = seats.map((seat, i) => ({
        id: i + 1,
        name: seat.name.trim() || `Player ${i + 1}`,
        lives: START_LIVES,
        items: [],
        alive: true,
        cuffedBy: null,
        kind: seat.kind,
        ...(seat.kind === 'agent' ? { tier: seat.tier ?? 'steady' } : {}),
      }));
      const { queue, live, blank } = generateRound(players.length);
      return {
        ...initialState(),
        phase: 'roundIntro',
        players,
        activePlayerId: players[0].id,
        shellQueue: queue,
        roundComposition: { live, blank },
        round: 1,
      };
    }

    case 'BEGIN_ROUND': {
      if (state.phase !== 'roundIntro') return state;
      // The previous round's spent tray and shot feedback stay visible through
      // the intro (so the final shell's reveal isn't swallowed); racking clears them.
      return { ...state, phase: 'turn', lastShot: null, spentShells: [] };
    }

    case 'USE_ITEM': {
      if (state.phase !== 'turn') return state;
      const active = state.players.find((p) => p.id === state.activePlayerId);
      if (!active) return state;
      const idx = active.items.indexOf(action.item);
      if (idx === -1) return state;
      if (action.item === 'saw' && state.sawActive) return state; // §7: saw does not stack
      if (action.item === 'life' && active.lives >= START_LIVES) return state; // lives cap at 3
      if (action.item === 'cuffs') {
        const target = state.players.find((p) => p.id === action.targetId);
        // must cuff another alive, not-already-cuffed player
        if (!target || !target.alive || target.id === active.id || target.cuffedBy !== null) {
          return state;
        }
      }
      const items = active.items.filter((_, i) => i !== idx);
      if (action.item === 'life') {
        const players = state.players.map((p) =>
          p.id === active.id ? { ...p, items, lives: p.lives + 1 } : p,
        );
        return { ...state, players };
      }
      if (action.item === 'cuffs') {
        const players = state.players.map((p) =>
          p.id === active.id
            ? { ...p, items }
            : p.id === action.targetId
              ? { ...p, cuffedBy: active.id }
              : p,
        );
        return { ...state, players };
      }
      const players = state.players.map((p) => (p.id === active.id ? { ...p, items } : p));
      if (action.item === 'glass') {
        return { ...state, players, peekedShell: state.shellQueue[0] ?? null };
      }
      return { ...state, players, sawActive: true };
    }

    case 'FIRE': {
      if (state.phase !== 'turn') return state;
      const target = state.players.find((p) => p.id === action.targetId);
      if (!target || !target.alive || state.shellQueue.length === 0) return state;
      const [shell, ...rest] = state.shellQueue;
      return {
        ...state,
        phase: 'resolving',
        shellQueue: rest,
        pendingShot: { targetId: target.id, shell, peeked: state.peekedShell !== null },
        peekedShell: null,
      };
    }

    case 'RESOLVE_SHOT': {
      if (state.phase !== 'resolving' || !state.pendingShot) return state;
      const { targetId, shell, peeked } = state.pendingShot;
      const shooterId = state.activePlayerId;
      const isSelf = targetId === shooterId;
      const sawed = state.sawActive;
      const damage = shell === 'live' ? (sawed ? 2 : 1) : 0;

      let eliminatedId: number | null = null;
      let players = state.players.map((p) => {
        if (p.id !== targetId || damage === 0) return p;
        const lives = Math.max(0, p.lives - damage);
        if (lives === 0) {
          eliminatedId = p.id;
          // §5: eliminated → items discarded, any cuffs on them are moot
          return { ...p, lives, alive: false, items: [], cuffedBy: null };
        }
        return { ...p, lives };
      });

      // §5: a self-shot grants one random item (cap 4) — but not if the shooter
      // peeked this chamber with a magnifying glass
      let itemGained: Item | null = null;
      let itemDiscarded = false;
      let itemSuppressed = false;
      if (isSelf) {
        const shooter = players.find((p) => p.id === shooterId)!;
        if (shooter.alive) {
          if (peeked) {
            itemSuppressed = true;
          } else {
            const item = pick(ITEMS);
            if (shooter.items.length < MAX_ITEMS) {
              itemGained = item;
              players = players.map((p) =>
                p.id === shooterId ? { ...p, items: [...p.items, item] } : p,
              );
            } else {
              itemDiscarded = true;
            }
          }
        }
      }

      // Turn passing per the resolution table. Any self-shot ends the turn —
      // blank or live — so the gun always moves on from the shooter's seat.
      let nextActive: number;
      if (isSelf) {
        nextActive = nextAliveFrom(players, shooterId);
      } else if (shell === 'blank') {
        nextActive = targetId;
      } else {
        const target = players.find((p) => p.id === targetId)!;
        nextActive = target.alive ? targetId : nextAliveFrom(players, targetId);
      }

      // §7 handcuffs: a cuffed player never receives the gun — it goes back to
      // their cuffer instead (or next alive from their seat if the cuffer died),
      // and the cuffs break. Loop: the redirect can land on another cuffed player.
      const cuffSkippedIds: number[] = [];
      for (let guard = 0; guard <= players.length; guard++) {
        const receiver = players.find((p) => p.id === nextActive)!;
        if (!receiver.alive || receiver.cuffedBy === null) break;
        const cufferId = receiver.cuffedBy;
        cuffSkippedIds.push(receiver.id);
        players = players.map((p) => (p.id === receiver.id ? { ...p, cuffedBy: null } : p));
        const cuffer = players.find((p) => p.id === cufferId);
        nextActive = cuffer && cuffer.alive ? cuffer.id : nextAliveFrom(players, receiver.id);
      }

      const lastShot: ShotResult = {
        shooterId,
        targetId,
        shell,
        damage,
        sawed,
        itemGained,
        itemDiscarded,
        itemSuppressed,
        eliminatedId,
        cuffSkippedIds,
      };

      const base: GameState = {
        ...state,
        players,
        activePlayerId: nextActive,
        spentShells: [...state.spentShells, shell],
        sawActive: false, // consumed whether blank or live (§7)
        peekedShell: null,
        pendingShot: null,
        lastShot,
      };

      const alivePlayers = players.filter((p) => p.alive);
      if (alivePlayers.length <= 1) {
        // Game ends the moment one player remains — no item drop, no reload (§10.3)
        return {
          ...base,
          phase: 'gameOver',
          winnerId: alivePlayers[0]?.id ?? null,
          activePlayerId: alivePlayers[0]?.id ?? nextActive,
        };
      }

      if (state.shellQueue.length === 0) {
        // Round over → load the next round directly; no items between rounds (§6).
        // spentShells keeps the final shell so its tray reveal renders; BEGIN_ROUND clears it.
        const aliveCount = players.filter((p) => p.alive).length;
        const { queue, live, blank } = generateRound(aliveCount);
        return {
          ...base,
          phase: 'roundIntro',
          round: state.round + 1,
          shellQueue: queue,
          roundComposition: { live, blank },
        };
      }

      return { ...base, phase: 'turn' };
    }

    case 'RESTART': {
      // Back to setup, names preserved (§5 game end)
      return {
        ...initialState(),
        players: state.players.map((p) => ({
          ...p,
          lives: START_LIVES,
          items: [],
          alive: true,
          cuffedBy: null,
        })),
      };
    }
  }
}
