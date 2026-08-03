import { afterEach, describe, expect, it } from 'vitest';
import {
  initialState,
  reducer,
  MAX_ITEMS,
  START_LIVES,
  MIN_PLAYERS,
  MAX_PLAYERS,
  MAX_HUMANS,
  MAX_AGENTS,
} from './reducer';
import { generateRound, MAX_SHELLS } from './shells';
import { seed, unseed, shuffle } from './rng';
import type { GameState, Player, Shell, Item } from './types';

afterEach(() => unseed());

function player(id: number, over: Partial<Player> = {}): Player {
  return {
    id,
    name: `Player ${id}`,
    lives: START_LIVES,
    items: [],
    alive: true,
    cuffedBy: null,
    blankSelfShots: 0,
    kind: 'human',
    ...over,
  };
}

function turnState(over: Partial<GameState> = {}): GameState {
  return {
    ...initialState(),
    phase: 'turn',
    players: [player(1), player(2), player(3)],
    activePlayerId: 1,
    shellQueue: ['live', 'blank'] as Shell[],
    roundComposition: { live: 1, blank: 1 },
    round: 1,
    ...over,
  };
}

/** FIRE + RESOLVE_SHOT in sequence. */
function shoot(state: GameState, targetId: number): GameState {
  return reducer(reducer(state, { type: 'FIRE', targetId }), { type: 'RESOLVE_SHOT' });
}

describe('shell generation (§4)', () => {
  it('respects count and composition bounds across many rounds', () => {
    seed(999);
    for (const aliveCount of [2, 3, 4, 5, 6, 7, 8]) {
      let minCount = Infinity;
      let maxCount = 0;
      let maxLive = 0;
      for (let i = 0; i < 500; i++) {
        const { queue, live, blank } = generateRound(aliveCount);
        expect(queue.length).toBe(live + blank);
        expect(queue.length).toBeGreaterThanOrEqual(aliveCount);
        expect(queue.length).toBeLessThanOrEqual(8);
        expect(live).toBeGreaterThanOrEqual(1);
        expect(live).toBeLessThanOrEqual(4);
        expect(blank).toBeGreaterThanOrEqual(1);
        expect(blank).toBeLessThanOrEqual(4);
        expect(queue.filter((s) => s === 'live').length).toBe(live);
        expect(queue.filter((s) => s === 'blank').length).toBe(blank);
        minCount = Math.min(minCount, queue.length);
        maxCount = Math.max(maxCount, queue.length);
        maxLive = Math.max(maxLive, live);
      }
      // inclusive endpoints are attainable — catches exclusive-bound randInt regressions
      expect(minCount).toBe(aliveCount);
      expect(maxCount).toBe(8);
      expect(maxLive).toBe(4);
    }
  });

  it('clamps the shell count past 8 seats instead of inverting the range', () => {
    seed(4242);
    // regression: randInt(aliveCount, 8) inverts past 8 alive — randInt(11, 8)
    // returned 9 or 10, exceeding the cap, and could then invert the live range
    // too, yielding more live shells than the round holds.
    for (const aliveCount of [9, 10, 11]) {
      for (let i = 0; i < 400; i++) {
        const { queue, live, blank } = generateRound(aliveCount);
        expect(queue.length).toBeLessThanOrEqual(MAX_SHELLS);
        expect(queue.length).toBe(live + blank);
        expect(live).toBeGreaterThanOrEqual(1);
        expect(live).toBeLessThanOrEqual(4);
        expect(blank).toBeGreaterThanOrEqual(1);
        expect(blank).toBeLessThanOrEqual(4);
        expect(queue.filter((s) => s === 'live').length).toBe(live);
      }
    }
  });

  it('self-shot item grants produce all five item types over many shots', () => {
    seed(5);
    const seen = new Set<Item>();
    for (let i = 0; i < 300; i++) {
      const s = shoot(turnState({ shellQueue: ['blank', 'live'] }), 1);
      s.players[0].items.forEach((it) => seen.add(it));
    }
    expect(seen).toEqual(new Set(['glass', 'saw', 'life', 'cuffs', 'split']));
  });

  it('is deterministic under a seed', () => {
    seed(42);
    const a = generateRound(3);
    seed(42);
    const b = generateRound(3);
    expect(a).toEqual(b);
  });

  it('shuffle preserves the multiset', () => {
    const arr: Shell[] = ['live', 'live', 'blank', 'blank', 'blank'];
    const out = shuffle([...arr]);
    expect(out.filter((s) => s === 'live').length).toBe(2);
    expect(out.filter((s) => s === 'blank').length).toBe(3);
  });
});

describe('game start (§3)', () => {
  it('creates players with 3 lives, 0 items; player 1 acts first; round 1 loaded', () => {
    const s = reducer(initialState(), { type: 'START_GAME', playerNames: ['A', 'B', 'C'] });
    expect(s.phase).toBe('roundIntro');
    expect(s.players.length).toBe(3);
    expect(s.players.every((p) => p.lives === 3 && p.items.length === 0 && p.alive)).toBe(true);
    expect(s.activePlayerId).toBe(1);
    expect(s.round).toBe(1);
    expect(s.shellQueue.length).toBe(s.roundComposition.live + s.roundComposition.blank);
  });

  it('seats a full 5-player table and truncates beyond the cap', () => {
    const five = reducer(initialState(), {
      type: 'START_GAME',
      playerNames: ['A', 'B', 'C', 'D', 'E'],
    });
    expect(five.players.map((p) => p.id)).toEqual([1, 2, 3, 4, 5]);
    expect(five.activePlayerId).toBe(1);
    // shell count floors at the alive count, so a 5-seat table never runs a
    // round shorter than one shell per player
    expect(five.shellQueue.length).toBeGreaterThanOrEqual(5);

    const over = reducer(initialState(), {
      type: 'START_GAME',
      playerNames: Array.from({ length: MAX_PLAYERS + 3 }, (_, i) => `P${i + 1}`),
    });
    expect(over.players.length).toBe(MAX_PLAYERS);
  });

  it('defaults every seat to human when started from bare names', () => {
    const s = reducer(initialState(), { type: 'START_GAME', playerNames: ['A', 'B'] });
    expect(s.players.every((p) => p.kind === 'human' && p.tier === undefined)).toBe(true);
  });

  it('seats mixed human/agent tables with tiers', () => {
    const s = reducer(initialState(), {
      type: 'START_GAME',
      seats: [
        { name: 'Me', kind: 'human' },
        { name: 'Bot A', kind: 'agent', tier: 'reckless' },
        { name: 'Bot B', kind: 'agent', tier: 'sharp' },
        { name: 'Bot C', kind: 'agent' }, // tier omitted → default
      ],
    });
    expect(s.phase).toBe('roundIntro');
    expect(s.players.map((p) => p.kind)).toEqual(['human', 'agent', 'agent', 'agent']);
    expect(s.players.map((p) => p.tier)).toEqual([undefined, 'reckless', 'sharp', 'steady']);
  });

  it('rejects an all-agent table (at least one human must play)', () => {
    const s = reducer(initialState(), {
      type: 'START_GAME',
      seats: [
        { name: 'Bot A', kind: 'agent' },
        { name: 'Bot B', kind: 'agent' },
      ],
    });
    expect(s.phase).toBe('setup');
  });

  it('rejects more than 3 agents', () => {
    const s = reducer(initialState(), {
      type: 'START_GAME',
      seats: [
        { name: 'Me', kind: 'human' },
        ...Array.from({ length: MAX_AGENTS + 1 }, (_, i) => ({
          name: `Bot ${i}`,
          kind: 'agent' as const,
        })),
      ],
    });
    expect(s.phase).toBe('setup');
  });

  it('seats a full 11-player table (8 humans + 3 agents)', () => {
    const s = reducer(initialState(), {
      type: 'START_GAME',
      seats: [
        ...Array.from({ length: MAX_HUMANS }, (_, i) => ({
          name: `H${i + 1}`,
          kind: 'human' as const,
        })),
        ...Array.from({ length: MAX_AGENTS }, (_, i) => ({
          name: `A${i + 1}`,
          kind: 'agent' as const,
          tier: 'steady' as const,
        })),
      ],
    });
    expect(s.players.length).toBe(MAX_PLAYERS);
    expect(s.players.length).toBe(11);
    // 11 seats but the round caps at 8 shells — the round ends before every
    // seat fires, then reloads (§4 clamp)
    expect(s.shellQueue.length).toBeLessThanOrEqual(8);
  });

  it('rejects fewer than 2 players and defaults blank names', () => {
    const none = reducer(initialState(), { type: 'START_GAME', playerNames: ['solo'] });
    expect(none.phase).toBe('setup');
    const s = reducer(initialState(), { type: 'START_GAME', playerNames: ['  ', 'B'] });
    expect(s.players[0].name).toBe('Player 1');
  });
});

describe('resolution table (§5)', () => {
  it('self + blank: no damage, +1 item, turn passes to next alive player', () => {
    const s = shoot(turnState({ shellQueue: ['blank', 'live'] }), 1);
    expect(s.players[0].lives).toBe(3);
    expect(s.players[0].items.length).toBe(1);
    expect(['glass', 'saw', 'life', 'cuffs']).toContain(s.players[0].items[0]);
    expect(s.activePlayerId).toBe(2);
    expect(s.phase).toBe('turn');
    expect(s.spentShells).toEqual(['blank']);
  });

  it('self + blank skips eliminated seats when passing the gun', () => {
    const s = shoot(
      turnState({
        players: [player(1), player(2, { alive: false, lives: 0 }), player(3)],
        shellQueue: ['blank', 'live'],
      }),
      1,
    );
    expect(s.activePlayerId).toBe(3);
  });

  it('self + live: shooter loses 1 life, +1 item, next alive player in seat order', () => {
    const s = shoot(turnState({ shellQueue: ['live', 'blank'] }), 1);
    expect(s.players[0].lives).toBe(2);
    expect(s.players[0].items.length).toBe(1);
    expect(s.activePlayerId).toBe(2);
  });

  it('other + blank: no damage, no item, target takes the turn', () => {
    const s = shoot(turnState({ shellQueue: ['blank', 'live'] }), 3);
    expect(s.players[2].lives).toBe(3);
    expect(s.players[0].items.length).toBe(0);
    expect(s.players[2].items.length).toBe(0);
    expect(s.activePlayerId).toBe(3);
  });

  it('other + live: target loses 1 life and takes the turn if alive', () => {
    const s = shoot(turnState({ shellQueue: ['live', 'blank'] }), 2);
    expect(s.players[1].lives).toBe(2);
    expect(s.activePlayerId).toBe(2);
    expect(s.players[0].items.length).toBe(0);
  });

  it('other + live kill: next alive clockwise from the TARGET seat (§10.4)', () => {
    const s = shoot(
      turnState({
        players: [player(1), player(2, { lives: 1 }), player(3)],
        activePlayerId: 1,
        shellQueue: ['live', 'blank'],
      }),
      2,
    );
    expect(s.players[1].alive).toBe(false);
    expect(s.activePlayerId).toBe(3); // clockwise from seat 2, not from shooter seat 1
  });

  it('kill wraps around seat order', () => {
    const s = shoot(
      turnState({
        players: [player(1), player(2), player(3, { lives: 1 })],
        activePlayerId: 2,
        shellQueue: ['live', 'blank'],
      }),
      3,
    );
    expect(s.activePlayerId).toBe(1); // wraps past seat 3 to seat 1
  });

  it('self + live at 1 life eliminates the shooter, no item granted, turn passes', () => {
    const s = shoot(
      turnState({
        players: [player(1, { lives: 1, items: ['glass'] }), player(2), player(3)],
        shellQueue: ['live', 'blank'],
      }),
      1,
    );
    expect(s.players[0].alive).toBe(false);
    expect(s.players[0].items).toEqual([]); // items discarded on elimination
    expect(s.lastShot?.itemGained).toBeNull();
    expect(s.activePlayerId).toBe(2);
  });

  it('cannot target an eliminated player', () => {
    const st = turnState({ players: [player(1), player(2, { alive: false, lives: 0 }), player(3)] });
    const s = reducer(st, { type: 'FIRE', targetId: 2 });
    expect(s).toBe(st);
  });

  it('self-shot at 4 items: reward discarded with feedback flag (§10.5)', () => {
    const items: Item[] = ['glass', 'glass', 'saw', 'saw'];
    const s = shoot(turnState({ players: [player(1, { items }), player(2)], shellQueue: ['blank', 'live'] }), 1);
    expect(s.players[0].items.length).toBe(MAX_ITEMS);
    expect(s.lastShot?.itemGained).toBeNull();
    expect(s.lastShot?.itemDiscarded).toBe(true);
  });

  it('peeked self-shot grants NO item; the next unpeeked self-shot does again', () => {
    let s = turnState({
      players: [player(1, { items: ['glass'] }), player(2)],
      shellQueue: ['blank', 'blank', 'blank'],
    });
    s = reducer(s, { type: 'USE_ITEM', item: 'glass' });
    expect(s.peekedShell).toBe('blank');
    s = shoot(s, 1); // knew it was a blank → no reward
    expect(s.players[0].items).toEqual([]);
    expect(s.lastShot?.itemGained).toBeNull();
    expect(s.lastShot?.itemSuppressed).toBe(true);
    // the self-shot passed the gun on; play it back round to player 1
    expect(s.activePlayerId).toBe(2);
    s = shoot(s, 2);
    expect(s.activePlayerId).toBe(1);
    s = shoot(s, 1); // player 1 again, this time unpeeked → reward
    expect(s.players[0].items.length).toBe(1);
    expect(s.lastShot?.itemSuppressed).toBe(false);
  });

  it('peeked self + live still grants nothing (suppression is outcome-independent)', () => {
    let s = turnState({
      players: [player(1, { items: ['glass'] }), player(2)],
      shellQueue: ['live', 'blank'],
    });
    s = reducer(s, { type: 'USE_ITEM', item: 'glass' });
    s = shoot(s, 1);
    expect(s.players[0].lives).toBe(2);
    expect(s.players[0].items).toEqual([]);
    expect(s.lastShot?.itemSuppressed).toBe(true);
  });
});

describe('items (§6, §7)', () => {
  it('glass reveals the next chamber and is consumed; second glass re-reveals (§10.7)', () => {
    let s = turnState({
      players: [player(1, { items: ['glass', 'glass'] }), player(2)],
      shellQueue: ['live', 'blank'],
    });
    s = reducer(s, { type: 'USE_ITEM', item: 'glass' });
    expect(s.peekedShell).toBe('live');
    expect(s.players[0].items).toEqual(['glass']);
    s = reducer(s, { type: 'USE_ITEM', item: 'glass' });
    expect(s.peekedShell).toBe('live');
    expect(s.players[0].items).toEqual([]);
  });

  it('peek is cleared on fire', () => {
    let s = turnState({ players: [player(1, { items: ['glass'] }), player(2)] });
    s = reducer(s, { type: 'USE_ITEM', item: 'glass' });
    s = reducer(s, { type: 'FIRE', targetId: 2 });
    expect(s.peekedShell).toBeNull();
  });

  it('saw doubles exactly one live shot', () => {
    let s = turnState({ players: [player(1, { items: ['saw'] }), player(2)], shellQueue: ['live', 'blank'] });
    s = reducer(s, { type: 'USE_ITEM', item: 'saw' });
    expect(s.sawActive).toBe(true);
    s = shoot(s, 2);
    expect(s.players[1].lives).toBe(1);
    expect(s.sawActive).toBe(false);
    expect(s.lastShot?.damage).toBe(2);
  });

  it('saw is consumed by a blank shot (§10.6)', () => {
    let s = turnState({ players: [player(1, { items: ['saw'] }), player(2)], shellQueue: ['blank', 'live'] });
    s = reducer(s, { type: 'USE_ITEM', item: 'saw' });
    s = shoot(s, 2);
    expect(s.sawActive).toBe(false);
    expect(s.players[1].lives).toBe(3);
    expect(s.players[0].items).toEqual([]);
  });

  it('saw does not stack: second saw is rejected and not consumed', () => {
    let s = turnState({ players: [player(1, { items: ['saw', 'saw'] }), player(2)] });
    s = reducer(s, { type: 'USE_ITEM', item: 'saw' });
    const after = reducer(s, { type: 'USE_ITEM', item: 'saw' });
    expect(after).toBe(s);
    expect(after.players[0].items).toEqual(['saw']);
  });

  it('cannot use an item you do not hold', () => {
    const st = turnState();
    expect(reducer(st, { type: 'USE_ITEM', item: 'glass' })).toBe(st);
  });

  it('sawed self + live deals 2 to the shooter', () => {
    let s = turnState({ players: [player(1, { items: ['saw'] }), player(2)], shellQueue: ['live'] });
    s = reducer(s, { type: 'USE_ITEM', item: 'saw' });
    s = shoot(s, 1);
    expect(s.players[0].lives).toBe(1);
  });

  it('extra life restores 1 life and is consumed', () => {
    const s = reducer(
      turnState({ players: [player(1, { lives: 1, items: ['life', 'saw'] }), player(2)] }),
      { type: 'USE_ITEM', item: 'life' },
    );
    expect(s.players[0].lives).toBe(2);
    expect(s.players[0].items).toEqual(['saw']);
    expect(s.phase).toBe('turn'); // use does not end the turn
  });

  it('extra life is rejected (not consumed) at full lives', () => {
    const st = turnState({ players: [player(1, { lives: START_LIVES, items: ['life'] }), player(2)] });
    const s = reducer(st, { type: 'USE_ITEM', item: 'life' });
    expect(s).toBe(st);
    expect(st.players[0].items).toEqual(['life']);
  });

  it('lives never exceed the 3-life maximum via extra lives', () => {
    let s = turnState({ players: [player(1, { lives: 2, items: ['life', 'life'] }), player(2)] });
    s = reducer(s, { type: 'USE_ITEM', item: 'life' });
    expect(s.players[0].lives).toBe(3);
    const again = reducer(s, { type: 'USE_ITEM', item: 'life' });
    expect(again).toBe(s);
    expect(again.players[0].lives).toBe(3);
  });
});

describe('handcuffs (§7)', () => {
  it('cuffing marks the target and consumes the item; use does not end the turn', () => {
    const s = reducer(
      turnState({ players: [player(1, { items: ['cuffs'] }), player(2), player(3)] }),
      { type: 'USE_ITEM', item: 'cuffs', targetId: 2 },
    );
    expect(s.players[1].cuffedBy).toBe(1);
    expect(s.players[0].items).toEqual([]);
    expect(s.phase).toBe('turn');
    expect(s.activePlayerId).toBe(1);
  });

  it('cannot cuff yourself, a dead player, an already-cuffed player, or without a target', () => {
    const st = turnState({
      players: [
        player(1, { items: ['cuffs'] }),
        player(2, { cuffedBy: 3 }),
        player(3, { alive: false, lives: 0 }),
      ],
    });
    expect(reducer(st, { type: 'USE_ITEM', item: 'cuffs', targetId: 1 })).toBe(st);
    expect(reducer(st, { type: 'USE_ITEM', item: 'cuffs', targetId: 2 })).toBe(st);
    expect(reducer(st, { type: 'USE_ITEM', item: 'cuffs', targetId: 3 })).toBe(st);
    expect(reducer(st, { type: 'USE_ITEM', item: 'cuffs' })).toBe(st);
    expect(st.players[0].items).toEqual(['cuffs']); // never consumed
  });

  it('other + blank at a cuffed target: the gun comes back to the cuffer, cuffs break', () => {
    let s = turnState({
      players: [player(1, { items: ['cuffs'] }), player(2), player(3)],
      shellQueue: ['blank', 'live'],
    });
    s = reducer(s, { type: 'USE_ITEM', item: 'cuffs', targetId: 2 });
    s = shoot(s, 2); // blank at the cuffed player — they would take the turn
    expect(s.activePlayerId).toBe(1); // …but it returns to the cuffer
    expect(s.players[1].cuffedBy).toBeNull();
    expect(s.lastShot?.cuffSkippedIds).toEqual([2]);
  });

  it('seat-order pass to a cuffed player also redirects to the cuffer', () => {
    // player 3 cuffs player 2 is impossible mid-turn-1; construct state directly:
    const s = shoot(
      turnState({
        players: [player(1), player(2, { cuffedBy: 3 }), player(3)],
        activePlayerId: 1,
        shellQueue: ['live', 'blank'],
      }),
      1, // self + live → next alive in seat order would be player 2
    );
    expect(s.activePlayerId).toBe(3); // redirected to the cuffer
    expect(s.players[1].cuffedBy).toBeNull();
    expect(s.lastShot?.cuffSkippedIds).toEqual([2]);
  });

  it('cuffer already eliminated: skip still happens, gun falls to next alive from the cuffed seat', () => {
    const s = shoot(
      turnState({
        players: [
          player(1),
          player(2, { cuffedBy: 4 }),
          player(3),
          player(4, { alive: false, lives: 0 }),
        ],
        activePlayerId: 1,
        shellQueue: ['blank', 'live'],
      }),
      2, // blank at cuffed player 2
    );
    expect(s.activePlayerId).toBe(3); // cuffer 4 is dead → next alive clockwise from seat 2
    expect(s.players[1].cuffedBy).toBeNull();
  });

  it('cuffs persist across a round boundary until they trigger', () => {
    let s = turnState({
      players: [player(1, { items: ['cuffs'] }), player(2), player(3)],
      shellQueue: ['blank'], // final shell
    });
    s = reducer(s, { type: 'USE_ITEM', item: 'cuffs', targetId: 3 });
    s = shoot(s, 2); // round ends; player 2 takes the gun into round 2
    expect(s.phase).toBe('roundIntro');
    expect(s.activePlayerId).toBe(2);
    expect(s.players[2].cuffedBy).toBe(1); // still cuffed
    s = reducer(s, { type: 'BEGIN_ROUND' });
    s = reducer(s, { ...{ type: 'FIRE' as const, targetId: 3 } });
    s = reducer(s, { type: 'RESOLVE_SHOT' });
    // whatever the shell, a pass to player 3 (blank→target / live→target-alive) redirects
    if (s.lastShot?.shell === 'blank' || s.players[2].alive) {
      expect(s.activePlayerId).toBe(1);
      expect(s.players[2].cuffedBy).toBeNull();
    }
  });

  it('killing the cuffed player clears their cuff without a skip', () => {
    const s = shoot(
      turnState({
        players: [player(1), player(2, { lives: 1, cuffedBy: 1 }), player(3)],
        shellQueue: ['live', 'blank'],
      }),
      2,
    );
    expect(s.players[1].alive).toBe(false);
    expect(s.players[1].cuffedBy).toBeNull();
    expect(s.lastShot?.cuffSkippedIds).toEqual([]);
    expect(s.activePlayerId).toBe(3); // normal kill pass from the target's seat
  });

  it('two-player duel: cuff the opponent, eat a live shell, keep the gun anyway', () => {
    let s = turnState({
      players: [player(1, { items: ['cuffs'] }), player(2)],
      shellQueue: ['live', 'blank'],
    });
    s = reducer(s, { type: 'USE_ITEM', item: 'cuffs', targetId: 2 });
    s = shoot(s, 1); // self + live: turn would pass to player 2
    expect(s.players[0].lives).toBe(2);
    expect(s.activePlayerId).toBe(1); // cuffs bounce it straight back
    expect(s.players[1].cuffedBy).toBeNull();
  });

  it('chained cuffs cascade until an un-cuffed player receives the gun', () => {
    // 1 shoots self+live; seat order → 2 (cuffed by 3) → 3 (cuffed by 2)… → resolves to 2? No:
    // 2's cuff redirects to its cuffer 3; 3 is cuffed by 1 → redirects to 1.
    const s = shoot(
      turnState({
        players: [player(1), player(2, { cuffedBy: 3 }), player(3, { cuffedBy: 1 })],
        activePlayerId: 1,
        shellQueue: ['live', 'blank'],
      }),
      1,
    );
    expect(s.activePlayerId).toBe(1);
    expect(s.lastShot?.cuffSkippedIds).toEqual([2, 3]);
    expect(s.players[1].cuffedBy).toBeNull();
    expect(s.players[2].cuffedBy).toBeNull();
  });
});

describe('round end (§6, §10)', () => {
  it('round end goes straight to the next roundIntro: NO items are distributed', () => {
    const s = shoot(
      turnState({
        players: [
          player(1, { items: ['glass', 'saw'] }),
          player(2),
          player(3, { alive: false, lives: 0 }),
        ],
        shellQueue: ['blank'], // last shell, shot at another player
      }),
      2,
    );
    expect(s.phase).toBe('roundIntro');
    expect(s.round).toBe(2);
    expect(s.players[0].items).toEqual(['glass', 'saw']); // unchanged
    expect(s.players[1].items).toEqual([]);
    expect(s.players[2].items).toEqual([]);
    expect(s.spentShells).toEqual(['blank']); // final shell stays revealed through the intro
    expect(s.activePlayerId).toBe(2); // other + blank → target holds the gun
    const racked = reducer(s, { type: 'BEGIN_ROUND' });
    expect(racked.spentShells).toEqual([]); // tray clears when the new round starts
  });

  it('the new round is sized to the shrunken aliveCount (§10.8)', () => {
    seed(7);
    const fired = reducer(
      turnState({
        players: [player(1), player(2), player(3, { alive: false, lives: 0 })],
        shellQueue: ['blank'],
      }),
      { type: 'FIRE', targetId: 2 },
    );
    for (let i = 0; i < 200; i++) {
      const next = reducer(fired, { type: 'RESOLVE_SHOT' });
      expect(next.phase).toBe('roundIntro');
      expect(next.round).toBe(2);
      expect(next.shellQueue.length).toBeGreaterThanOrEqual(2); // aliveCount = 2
      expect(next.shellQueue.length).toBeLessThanOrEqual(8);
      expect(next.spentShells).toEqual(['blank']);
    }
  });

  it('turn continuity: self-blank on the final shell passes the gun (and keeps its reward) into the new round (§10.2)', () => {
    let s = shoot(turnState({ shellQueue: ['blank'] }), 1);
    expect(s.phase).toBe('roundIntro');
    expect(s.activePlayerId).toBe(2); // the self-shot ends the turn, even at a round boundary
    expect(s.players[0].items.length).toBe(1); // self-shot reward still granted
    s = reducer(s, { type: 'BEGIN_ROUND' });
    expect(s.activePlayerId).toBe(2); // and the new round opens on that same seat
    expect(s.lastShot).toBeNull(); // stale shot feedback cleared at rack
  });
});

describe('elimination and game end (§5, §10)', () => {
  it('game ends immediately mid-round when one player remains', () => {
    const s = shoot(
      turnState({
        players: [player(1), player(2, { lives: 1 })],
        shellQueue: ['live', 'blank', 'blank'], // shells still left after the kill
      }),
      2,
    );
    expect(s.phase).toBe('gameOver');
    expect(s.winnerId).toBe(1);
  });

  it('gun empties on the killing shot → game over, no reload (§10.3)', () => {
    const s = shoot(
      turnState({ players: [player(1), player(2, { lives: 1 })], shellQueue: ['live'] }),
      2,
    );
    expect(s.phase).toBe('gameOver');
    expect(s.winnerId).toBe(1);
    expect(s.players[0].items.length).toBe(0);
    expect(s.shellQueue).toEqual([]);
  });

  it('sawed self-kill with 2 lives ends a 2-player game with the other player winning', () => {
    let s = turnState({
      players: [player(1, { lives: 2, items: ['saw'] }), player(2)],
      shellQueue: ['live'],
    });
    s = reducer(s, { type: 'USE_ITEM', item: 'saw' });
    s = shoot(s, 1);
    expect(s.phase).toBe('gameOver');
    expect(s.winnerId).toBe(2);
  });

  it('RESTART returns to setup preserving names', () => {
    const s = reducer(
      turnState({
        phase: 'gameOver',
        players: [player(1, { name: 'Ada', lives: 0, alive: false }), player(2, { name: 'Bo' })],
      }),
      { type: 'RESTART' },
    );
    expect(s.phase).toBe('setup');
    expect(s.players.map((p) => p.name)).toEqual(['Ada', 'Bo']);
    expect(s.players.every((p) => p.lives === 3 && p.alive && p.items.length === 0)).toBe(true);
  });
});

describe('input guards (§10.9)', () => {
  it('FIRE is ignored outside the turn phase and RESOLVE_SHOT outside resolving', () => {
    const st = turnState();
    const firing = reducer(st, { type: 'FIRE', targetId: 2 });
    expect(firing.phase).toBe('resolving');
    // double-FIRE while resolving is a no-op
    expect(reducer(firing, { type: 'FIRE', targetId: 2 })).toBe(firing);
    // double-RESOLVE is a no-op
    const resolved = reducer(firing, { type: 'RESOLVE_SHOT' });
    expect(reducer(resolved, { type: 'RESOLVE_SHOT' })).toBe(resolved);
    // items locked while resolving
    expect(reducer(firing, { type: 'USE_ITEM', item: 'glass' })).toBe(firing);
  });
});

describe('full-game simulation (fuzz)', () => {
  it('plays 300 random games to completion without invariant violations', () => {
    seed(1234);
    for (let g = 0; g < 300; g++) {
      const n = MIN_PLAYERS + (g % (MAX_PLAYERS - MIN_PLAYERS + 1));
      let s = reducer(initialState(), {
        type: 'START_GAME',
        playerNames: Array.from({ length: n }, (_, i) => `P${i + 1}`),
      });
      let steps = 0;
      while (s.phase !== 'gameOver' && steps++ < 2000) {
        if (s.phase === 'roundIntro') s = reducer(s, { type: 'BEGIN_ROUND' });
        else if (s.phase === 'turn') {
          const active = s.players.find((p) => p.id === s.activePlayerId)!;
          expect(active.alive).toBe(true);
          expect(active.cuffedBy).toBeNull(); // a cuffed player never holds the gun
          // occasionally use items
          if (active.items.length > 0 && s.round % 2 === 0) {
            const item = active.items[0];
            if (item === 'cuffs') {
              const cuffable = s.players.find(
                (p) => p.alive && p.id !== active.id && p.cuffedBy === null,
              );
              if (cuffable) s = reducer(s, { type: 'USE_ITEM', item, targetId: cuffable.id });
            } else {
              s = reducer(s, { type: 'USE_ITEM', item });
            }
          }
          const alive = s.players.filter((p) => p.alive);
          const target = alive[(steps + g) % alive.length];
          s = reducer(s, { type: 'FIRE', targetId: target.id });
        } else if (s.phase === 'resolving') {
          s = reducer(s, { type: 'RESOLVE_SHOT' });
        }
        // invariants
        for (const p of s.players) {
          expect(p.items.length).toBeLessThanOrEqual(MAX_ITEMS);
          expect(p.lives).toBeGreaterThanOrEqual(0);
          expect(p.lives).toBeLessThanOrEqual(START_LIVES);
          expect(p.alive).toBe(p.lives > 0);
          if (!p.alive) expect(p.cuffedBy).toBeNull();
        }
      }
      expect(s.phase).toBe('gameOver');
      expect(s.winnerId).not.toBeNull();
      expect(s.players.find((p) => p.id === s.winnerId)!.alive).toBe(true);
    }
  });
});
