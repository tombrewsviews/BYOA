import { pick } from './rng';
import { generateRound } from './shells';
import { GOLDEN_BLANKS_REQUIRED } from './types';
import type { Action, GameState, Item, Player, SeatConfig, ShotResult } from './types';

export const MAX_ITEMS = 4;
export const START_LIVES = 3;
export const MAX_PLAYERS = 11; // 8 humans + 3 agents
export const MIN_PLAYERS = 2; // two seats minimum; one may be the only human
export const MAX_HUMANS = 8;
export const MAX_AGENTS = 3;
export const MIN_HUMANS = 1;

/**
 * The random self-shot drop pool. `golden` is deliberately NOT here — a golden
 * bullet is only ever earned by surviving three blank self-shots, never by luck.
 */
const ITEMS: readonly Item[] = ['glass', 'saw', 'life', 'cuffs', 'split'];

/** Lives a golden bullet takes from every other player. */
export const GOLDEN_DAMAGE = 2;

export function initialState(): GameState {
  return {
    phase: 'setup',
    players: [],
    activePlayerId: 0,
    shellQueue: [],
    spentShells: [],
    roundComposition: { live: 0, blank: 0 },
    sawActive: false,
    splitActive: false,
    peekedShell: null,
    winnerId: null,
    round: 0,
    pendingShot: null,
    lastShot: null,
    lastGolden: null,
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
        blankSelfShots: 0,
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
      if (action.item === 'split') {
        if (state.splitActive) return state; // does not stack, same as the saw
        // Needs two other live players to aim at, or there is nothing to split.
        if (state.players.filter((p) => p.alive && p.id !== active.id).length < 2) return state;
      }
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
      if (action.item === 'golden') {
        // Takes GOLDEN_DAMAGE lives from EVERY other player at once. It fires no
        // shell, so it neither consumes the chamber nor ends the turn — but it
        // can end the game, which no other item can, so the win check that
        // normally lives in RESOLVE_SHOT has to run here too.
        const hit: NonNullable<GameState['lastGolden']>['hit'] = [];
        const eliminatedIds: number[] = [];
        const players = state.players.map((p) => {
          if (p.id === active.id) return { ...p, items };
          if (!p.alive) return p;
          const lives = Math.max(0, p.lives - GOLDEN_DAMAGE);
          hit.push({ id: p.id, livesLost: p.lives - lives, livesLeft: lives });
          if (lives === 0) {
            eliminatedIds.push(p.id);
            return { ...p, lives, alive: false, items: [], cuffedBy: null };
          }
          return { ...p, lives };
        });

        const lastGolden = {
          userId: active.id,
          hit,
          eliminatedIds,
          k: (state.lastGolden?.k ?? 0) + 1,
        };
        const alive = players.filter((p) => p.alive);
        if (alive.length <= 1) {
          return {
            ...state,
            players,
            lastGolden,
            phase: 'gameOver',
            winnerId: alive[0]?.id ?? null,
            activePlayerId: alive[0]?.id ?? state.activePlayerId,
          };
        }
        return { ...state, players, lastGolden };
      }

      const players = state.players.map((p) => (p.id === active.id ? { ...p, items } : p));
      if (action.item === 'glass') {
        return { ...state, players, peekedShell: state.shellQueue[0] ?? null };
      }
      if (action.item === 'split') {
        return { ...state, players, splitActive: true };
      }
      return { ...state, players, sawActive: true };
    }

    case 'FIRE': {
      if (state.phase !== 'turn') return state;
      const target = state.players.find((p) => p.id === action.targetId);
      if (!target || !target.alive || state.shellQueue.length === 0) return state;

      // A split shell widens the shot; like the saw it never constrains who you
      // may aim at. A second target is honoured only when one is armed AND the
      // target is a distinct live player — otherwise it is ignored and the shot
      // proceeds against one target, spending the split.
      //
      // It must NOT reject: a caller that arms a split and then fires a single
      // target would deadlock the game outright, since splitActive persists and
      // every subsequent FIRE would be a no-op.
      let target2: Player | undefined;
      if (state.splitActive && action.targetId2 !== undefined && action.targetId2 !== action.targetId) {
        const t2 = state.players.find((p) => p.id === action.targetId2);
        if (t2?.alive) target2 = t2;
      }

      const [shell, ...rest] = state.shellQueue;
      return {
        ...state,
        phase: 'resolving',
        // A shot supersedes the last golden bullet: clearing it here stops its
        // flash and damage floats replaying over every later turn.
        lastGolden: null,
        shellQueue: rest,
        pendingShot: {
          targetId: target.id,
          targetId2: target2?.id,
          shell,
          peeked: state.peekedShell !== null,
          split: state.splitActive,
        },
        peekedShell: null,
      };
    }

    case 'RESOLVE_SHOT': {
      if (state.phase !== 'resolving' || !state.pendingShot) return state;
      const { targetId, targetId2, shell, peeked, split } = state.pendingShot;
      const shooterId = state.activePlayerId;
      const isSelf = targetId === shooterId;
      const sawed = state.sawActive;
      const damage = shell === 'live' ? (sawed ? 2 : 1) : 0;

      // One shell, both barrels: a split shot applies the SAME shell to both
      // targets at full damage. A blank harms neither, so the public odds stay
      // meaningful — the split doubles the payoff, not the shell count.
      const hitIds = split && targetId2 !== undefined ? [targetId, targetId2] : [targetId];

      let eliminatedId: number | null = null;
      let eliminatedId2: number | null = null;
      let players = state.players.map((p) => {
        if (!hitIds.includes(p.id) || damage === 0) return p;
        const lives = Math.max(0, p.lives - damage);
        if (lives === 0) {
          // first/second recorded separately so the UI can animate both
          if (p.id === targetId) eliminatedId = p.id;
          else eliminatedId2 = p.id;
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
      let goldenEarned = false;
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

          // A golden bullet is EARNED, never dropped: three blank self-shots.
          // A peeked chamber does not count — the whole price of the golden
          // bullet is the risk, and a peek removes the risk.
          if (shell === 'blank' && !peeked) {
            const tally = shooter.blankSelfShots + 1;
            // The 4-item cap is an invariant the whole game relies on, so the
            // golden bullet obeys it too. If there is no room the tally HOLDS at
            // the threshold rather than resetting, so the reward is still waiting
            // as soon as a slot frees up — earning it is never wasted.
            const holder = players.find((p) => p.id === shooterId)!;
            if (tally >= GOLDEN_BLANKS_REQUIRED && holder.items.length < MAX_ITEMS) {
              goldenEarned = true;
              players = players.map((p) =>
                p.id === shooterId
                  ? { ...p, blankSelfShots: 0, items: [...p.items, 'golden' as Item] }
                  : p,
              );
            } else {
              players = players.map((p) =>
                p.id === shooterId ? { ...p, blankSelfShots: tally } : p,
              );
            }
          }
        }
      }

      // Turn passing per the resolution table. Any self-shot ends the turn —
      // blank or live — so the gun always moves on from the shooter's seat.
      // A split shot passes on its PRIMARY target; the second is collateral and
      // does not claim the gun, otherwise two seats would have a claim on it.
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
        targetId2,
        shell,
        damage,
        sawed,
        split,
        itemGained,
        itemDiscarded,
        itemSuppressed,
        eliminatedId,
        eliminatedId2,
        cuffSkippedIds,
        goldenEarned,
      };

      const base: GameState = {
        ...state,
        players,
        activePlayerId: nextActive,
        spentShells: [...state.spentShells, shell],
        sawActive: false, // consumed whether blank or live (§7)
        splitActive: false, // likewise consumed by the shot, hit or miss
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
          blankSelfShots: 0,
        })),
      };
    }
  }
}
