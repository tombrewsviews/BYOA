/**
 * Golden bullet: earned by three blank self-shots, takes 2 lives from EVERY
 * other player when used.
 *
 * It is the only item that cannot drop at random and the only item that can end
 * the game, so both of those paths are pinned down here.
 */
import { describe, expect, it } from 'vitest';
import { initialState, reducer, GOLDEN_DAMAGE, MAX_ITEMS, START_LIVES } from './reducer';
import { seed, unseed } from './rng';
import { GOLDEN_BLANKS_REQUIRED } from './types';
import type { GameState, Item, Player, Shell } from './types';

function p(id: number, over: Partial<Player> = {}): Player {
  return {
    id,
    name: `P${id}`,
    lives: START_LIVES,
    items: [],
    alive: true,
    cuffedBy: null,
    blankSelfShots: 0,
    kind: 'human',
    ...over,
  };
}

function table(over: Partial<GameState> = {}): GameState {
  return {
    ...initialState(),
    phase: 'turn',
    players: [p(1), p(2), p(3), p(4)],
    activePlayerId: 1,
    shellQueue: ['blank', 'live'] as Shell[],
    roundComposition: { live: 1, blank: 1 },
    round: 1,
    ...over,
  };
}

const shoot = (s: GameState, targetId: number) =>
  reducer(reducer(s, { type: 'FIRE', targetId }), { type: 'RESOLVE_SHOT' });

/** Self-shoot a blank n times in a row, keeping the gun by re-seating the shooter. */
function blankSelfShots(s: GameState, n: number): GameState {
  let cur = s;
  for (let i = 0; i < n; i++) {
    cur = shoot({ ...cur, activePlayerId: 1, shellQueue: ['blank', 'live'], phase: 'turn' }, 1);
  }
  return cur;
}

describe('earning a golden bullet', () => {
  it('is never granted at random, however many self-shots are taken', () => {
    seed(11);
    const dropped = new Set<Item>();
    for (let i = 0; i < 400; i++) {
      const s = shoot(table(), 1);
      s.players[0].items.forEach((it) => dropped.add(it));
    }
    // the random pool must not contain it — only the earn path grants it
    expect(dropped.has('golden')).toBe(false);
    unseed();
  });

  it('counts blank self-shots and pays out on the third', () => {
    seed(7);
    let s = table();
    for (let i = 1; i < GOLDEN_BLANKS_REQUIRED; i++) {
      s = blankSelfShots(s, 1);
      expect(s.players[0].blankSelfShots).toBe(i);
      expect(s.players[0].items.includes('golden')).toBe(false);
    }
    s = blankSelfShots(s, 1);
    expect(s.players[0].items.includes('golden')).toBe(true);
    expect(s.lastShot?.goldenEarned).toBe(true);
    unseed();
  });

  it('resets the tally after paying out, so the next one costs three more', () => {
    seed(7);
    const s = blankSelfShots(table(), GOLDEN_BLANKS_REQUIRED);
    expect(s.players[0].items.includes('golden')).toBe(true);
    expect(s.players[0].blankSelfShots).toBe(0);
    unseed();
  });

  it('does NOT count a live self-shot', () => {
    const s = shoot({ ...table(), shellQueue: ['live', 'blank'] }, 1);
    expect(s.players[0].blankSelfShots).toBe(0);
  });

  it('does NOT count shooting someone else with a blank', () => {
    const s = shoot(table(), 2);
    expect(s.players[0].blankSelfShots).toBe(0);
  });

  it('does NOT count a peeked blank — the risk is the price', () => {
    const peeked = reducer({ ...table(), players: [p(1, { items: ['glass'] }), p(2), p(3), p(4)] }, {
      type: 'USE_ITEM',
      item: 'glass',
    });
    expect(peeked.peekedShell).toBe('blank');
    const s = shoot(peeked, 1);
    expect(s.lastShot?.itemSuppressed).toBe(true);
    expect(s.players[0].blankSelfShots).toBe(0);
  });

  it('respects the item cap, holding the tally until a slot frees up', () => {
    // full hands: the payout must not push a 5th item, and must not be lost
    const full = table({
      players: [p(1, { items: ['glass', 'saw', 'life', 'cuffs'] }), p(2), p(3), p(4)],
    });
    const s = blankSelfShots(full, GOLDEN_BLANKS_REQUIRED);
    expect(s.players[0].items.length).toBeLessThanOrEqual(MAX_ITEMS);
    expect(s.players[0].items.includes('golden')).toBe(false);
    // the tally is still at/over the threshold, so it pays out once there is room
    expect(s.players[0].blankSelfShots).toBeGreaterThanOrEqual(GOLDEN_BLANKS_REQUIRED);
    const freed = { ...s, players: s.players.map((x) => (x.id === 1 ? { ...x, items: [] as Item[] } : x)) };
    const paid = blankSelfShots(freed, 1);
    expect(paid.players[0].items.includes('golden')).toBe(true);
  });
});

describe('using a golden bullet', () => {
  const armed = (over: Partial<GameState> = {}) =>
    table({ players: [p(1, { items: ['golden'] }), p(2), p(3), p(4)], ...over });
  const fire = (s: GameState) => reducer(s, { type: 'USE_ITEM', item: 'golden' });

  it('takes 2 lives from every other player', () => {
    const s = fire(armed());
    expect(s.players[1].lives).toBe(START_LIVES - GOLDEN_DAMAGE);
    expect(s.players[2].lives).toBe(START_LIVES - GOLDEN_DAMAGE);
    expect(s.players[3].lives).toBe(START_LIVES - GOLDEN_DAMAGE);
  });

  it('does not harm the user', () => {
    const s = fire(armed());
    expect(s.players[0].lives).toBe(START_LIVES);
  });

  it('consumes the item', () => {
    const s = fire(armed());
    expect(s.players[0].items).toEqual([]);
  });

  it('fires no shell — the chamber and the odds are untouched', () => {
    const before = armed();
    const s = fire(before);
    expect(s.shellQueue).toEqual(before.shellQueue);
    expect(s.spentShells).toEqual(before.spentShells);
  });

  it('does not end the turn', () => {
    const s = fire(armed());
    expect(s.activePlayerId).toBe(1);
    expect(s.phase).toBe('turn');
  });

  it('eliminates everyone who cannot absorb 2 damage', () => {
    const s = fire(armed({ players: [p(1, { items: ['golden'] }), p(2, { lives: 2 }), p(3, { lives: 1 }), p(4, { lives: 3 })] }));
    expect(s.players[1].alive).toBe(false);
    expect(s.players[2].alive).toBe(false);
    expect(s.players[3].alive).toBe(true);
    expect(s.lastGolden?.eliminatedIds).toEqual([2, 3]);
  });

  it('strips items and cuffs from anyone it eliminates', () => {
    const s = fire(
      armed({ players: [p(1, { items: ['golden'] }), p(2, { lives: 1, items: ['saw'], cuffedBy: 1 }), p(3), p(4)] }),
    );
    expect(s.players[1].items).toEqual([]);
    expect(s.players[1].cuffedBy).toBeNull();
  });

  it('never drives lives below zero', () => {
    const s = fire(armed({ players: [p(1, { items: ['golden'] }), p(2, { lives: 1 }), p(3), p(4)] }));
    expect(s.players[1].lives).toBe(0);
  });

  it('leaves already-dead players alone', () => {
    const s = fire(armed({ players: [p(1, { items: ['golden'] }), p(2, { alive: false, lives: 0 }), p(3), p(4)] }));
    expect(s.lastGolden?.hit.map((h) => h.id)).toEqual([3, 4]);
  });

  it('ENDS THE GAME when it kills everyone else', () => {
    // the only item that can win outright — the win check must run in USE_ITEM
    const s = fire(armed({ players: [p(1, { items: ['golden'] }), p(2, { lives: 2 }), p(3, { lives: 1 })] }));
    expect(s.phase).toBe('gameOver');
    expect(s.winnerId).toBe(1);
  });

  it('reports what it did for the UI', () => {
    const s = fire(armed({ players: [p(1, { items: ['golden'] }), p(2, { lives: 3 }), p(3, { lives: 1 })] }));
    expect(s.lastGolden?.userId).toBe(1);
    expect(s.lastGolden?.hit).toEqual([
      { id: 2, livesLost: 2, livesLeft: 1 },
      { id: 3, livesLost: 1, livesLeft: 0 },
    ]);
  });

  it('bumps k on each use so the overlay re-animates', () => {
    const first = fire(armed());
    const k1 = first.lastGolden!.k;
    const again = fire({
      ...first,
      players: first.players.map((x) => (x.id === 1 ? { ...x, items: ['golden' as Item] } : x)),
      phase: 'turn',
    });
    expect(again.lastGolden!.k).toBe(k1 + 1);
  });

  it('is rejected when the player does not hold one', () => {
    const s = table();
    expect(reducer(s, { type: 'USE_ITEM', item: 'golden' })).toBe(s);
  });

  it('is rejected outside a turn', () => {
    const s = { ...armed(), phase: 'resolving' as const };
    expect(reducer(s, { type: 'USE_ITEM', item: 'golden' })).toBe(s);
  });
});
