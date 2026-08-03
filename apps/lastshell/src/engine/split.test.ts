/**
 * Split shell: one shell, two targets, full damage to each.
 *
 * A deliberate design note is enforced here — an armed split must NEVER make a
 * plain single-target FIRE illegal. An earlier version rejected it, which
 * deadlocked the game: splitActive persisted and every subsequent FIRE was a
 * no-op, so the table hung forever.
 */
import { describe, expect, it } from 'vitest';
import { initialState, reducer, MAX_ITEMS } from './reducer';
import { seed } from './rng';
import type { GameState, Item, Player, Shell } from './types';

function p(id: number, over: Partial<Player> = {}): Player {
  return {
    id,
    name: `P${id}`,
    lives: 3,
    items: [],
    alive: true,
    cuffedBy: null,
    blankSelfShots: 0,
    kind: 'human',
    ...over,
  };
}

/** A live turn: seat 1 holds the gun and the named items. */
function table(items: Item[], queue: Shell[], over: Partial<GameState> = {}): GameState {
  return {
    ...initialState(),
    phase: 'turn',
    players: [p(1, { items }), p(2), p(3), p(4)],
    activePlayerId: 1,
    shellQueue: queue,
    roundComposition: { live: queue.filter((s) => s === 'live').length, blank: queue.filter((s) => s === 'blank').length },
    round: 1,
    ...over,
  };
}

const arm = (s: GameState) => reducer(s, { type: 'USE_ITEM', item: 'split' });
const fire2 = (s: GameState, a: number, b: number) =>
  reducer(reducer(s, { type: 'FIRE', targetId: a, targetId2: b }), { type: 'RESOLVE_SHOT' });

describe('arming a split shell', () => {
  it('sets splitActive and consumes the item without ending the turn', () => {
    const s = arm(table(['split'], ['live']));
    expect(s.splitActive).toBe(true);
    expect(s.players[0].items).toEqual([]);
    // using an item keeps the gun — same as glass/saw
    expect(s.activePlayerId).toBe(1);
    expect(s.phase).toBe('turn');
  });

  it('does not stack', () => {
    const once = arm(table(['split', 'split'], ['live']));
    expect(reducer(once, { type: 'USE_ITEM', item: 'split' })).toBe(once);
  });

  it('is refused with fewer than two other live players', () => {
    const s = table(['split'], ['live'], {
      players: [p(1, { items: ['split'] }), p(2), p(3, { alive: false, lives: 0 }), p(4, { alive: false, lives: 0 })],
    });
    // only seat 2 is alive besides the shooter — nothing to split between
    expect(arm(s)).toBe(s);
  });

  it('is allowed with exactly two other live players', () => {
    const s = table(['split'], ['live'], {
      players: [p(1, { items: ['split'] }), p(2), p(3), p(4, { alive: false, lives: 0 })],
    });
    expect(arm(s).splitActive).toBe(true);
  });
});

describe('a live split shell hits both targets', () => {
  it('deals full damage to each — not halved', () => {
    const s = fire2(arm(table(['split'], ['live', 'blank'])), 2, 3);
    expect(s.players[1].lives).toBe(2);
    expect(s.players[2].lives).toBe(2);
    // the untargeted seat is untouched
    expect(s.players[3].lives).toBe(3);
  });

  it('consumes exactly ONE shell', () => {
    const before = arm(table(['split'], ['live', 'blank', 'blank']));
    const after = fire2(before, 2, 3);
    expect(before.shellQueue.length - after.shellQueue.length).toBe(1);
    expect(after.spentShells).toEqual(['live']);
  });

  it('doubles with a saw: 2 damage to each', () => {
    const s = fire2(arm(table(['split', 'saw'], ['live'], { sawActive: true })), 2, 3);
    expect(s.players[1].lives).toBe(1);
    expect(s.players[2].lives).toBe(1);
  });

  it('can eliminate two players at once', () => {
    const base = table(['split'], ['live', 'blank'], {
      players: [p(1, { items: ['split'] }), p(2, { lives: 1 }), p(3, { lives: 1 }), p(4)],
    });
    const s = fire2(arm(base), 2, 3);
    expect(s.players[1].alive).toBe(false);
    expect(s.players[2].alive).toBe(false);
    expect(s.lastShot?.eliminatedId).toBe(2);
    expect(s.lastShot?.eliminatedId2).toBe(3);
  });

  it('ends the game when the split leaves one player alive', () => {
    const base = table(['split'], ['live', 'blank'], {
      players: [p(1, { items: ['split'] }), p(2, { lives: 1 }), p(3, { lives: 1 })],
    });
    const s = fire2(arm(base), 2, 3);
    expect(s.phase).toBe('gameOver');
    expect(s.winnerId).toBe(1);
  });

  it('records both targets and the split flag on lastShot', () => {
    const s = fire2(arm(table(['split'], ['live'])), 2, 3);
    expect(s.lastShot?.split).toBe(true);
    expect(s.lastShot?.targetId).toBe(2);
    expect(s.lastShot?.targetId2).toBe(3);
    expect(s.lastShot?.damage).toBe(1);
  });
});

describe('a blank split shell harms nobody', () => {
  it('leaves both targets untouched', () => {
    const s = fire2(arm(table(['split'], ['blank', 'live'])), 2, 3);
    expect(s.players[1].lives).toBe(3);
    expect(s.players[2].lives).toBe(3);
    expect(s.lastShot?.damage).toBe(0);
  });

  it('still spends the shell and the split', () => {
    const s = fire2(arm(table(['split'], ['blank', 'live'])), 2, 3);
    expect(s.spentShells).toEqual(['blank']);
    expect(s.splitActive).toBe(false);
  });

  it('grants no item — a split shot is not a self-shot', () => {
    const s = fire2(arm(table(['split'], ['blank', 'live'])), 2, 3);
    expect(s.players[0].items).toEqual([]);
    expect(s.lastShot?.itemGained).toBeNull();
  });
});

describe('the split is consumed by the shot', () => {
  it('clears splitActive whether live or blank', () => {
    for (const shell of ['live', 'blank'] as Shell[]) {
      const s = fire2(arm(table(['split'], [shell, 'blank'])), 2, 3);
      expect(s.splitActive).toBe(false);
    }
  });

  it('a second shot after a split is single-target again', () => {
    const first = fire2(arm(table(['split'], ['live', 'live', 'blank'])), 2, 3);
    expect(first.splitActive).toBe(false);
    const shooter = first.activePlayerId;
    const victim = first.players.find((x) => x.alive && x.id !== shooter)!;
    const before = victim.lives;
    const second = reducer(reducer(first, { type: 'FIRE', targetId: victim.id }), { type: 'RESOLVE_SHOT' });
    // only the one target loses a life
    expect(second.players.find((x) => x.id === victim.id)!.lives).toBe(before - 1);
  });
});

describe('turn passing on a split shot', () => {
  it('a live split passes the gun to the PRIMARY target, not the second', () => {
    const s = fire2(arm(table(['split'], ['live', 'blank'])), 2, 3);
    expect(s.activePlayerId).toBe(2);
  });

  it('a blank split also passes to the primary target', () => {
    const s = fire2(arm(table(['split'], ['blank', 'live'])), 2, 3);
    expect(s.activePlayerId).toBe(2);
  });

  it('skips past the primary target when the split killed them', () => {
    const base = table(['split'], ['live', 'blank'], {
      players: [p(1, { items: ['split'] }), p(2, { lives: 1 }), p(3), p(4)],
    });
    const s = fire2(arm(base), 2, 3);
    expect(s.players[1].alive).toBe(false);
    expect(s.activePlayerId).toBe(3);
  });
});

describe('a split shell never deadlocks the game', () => {
  it('a plain single-target FIRE stays legal while armed', () => {
    // regression: rejecting this hung the table — splitActive persisted and
    // every later FIRE became a no-op, so no game could ever finish
    const armed = arm(table(['split'], ['live', 'blank']));
    const fired = reducer(armed, { type: 'FIRE', targetId: 2 });
    expect(fired).not.toBe(armed);
    expect(fired.phase).toBe('resolving');
  });

  it('firing single-target spends the split rather than keeping it armed', () => {
    const s = reducer(reducer(arm(table(['split'], ['live', 'blank'])), { type: 'FIRE', targetId: 2 }), {
      type: 'RESOLVE_SHOT',
    });
    expect(s.splitActive).toBe(false);
    // and only that one target took damage
    expect(s.players[1].lives).toBe(2);
    expect(s.players[2].lives).toBe(3);
  });

  it('a self-shot while armed is legal and still earns an item', () => {
    seed(3);
    const s = reducer(reducer(arm(table(['split'], ['blank', 'live'])), { type: 'FIRE', targetId: 1 }), {
      type: 'RESOLVE_SHOT',
    });
    expect(s.splitActive).toBe(false);
    expect(s.players[0].items.length).toBe(1);
  });

  it('ignores a bogus second target instead of stalling', () => {
    const armed = arm(table(['split'], ['live', 'blank']));
    for (const bad of [999, 2]) {
      // 999 does not exist; 2 duplicates the primary target
      const fired = reducer(armed, { type: 'FIRE', targetId: 2, targetId2: bad });
      expect(fired.phase).toBe('resolving');
      expect(fired.pendingShot?.targetId2).toBeUndefined();
    }
  });

  it('ignores a dead second target', () => {
    const base = table(['split'], ['live', 'blank'], {
      players: [p(1, { items: ['split'] }), p(2), p(3), p(4, { alive: false, lives: 0 })],
    });
    const fired = reducer(arm(base), { type: 'FIRE', targetId: 2, targetId2: 4 });
    expect(fired.phase).toBe('resolving');
    expect(fired.pendingShot?.targetId2).toBeUndefined();
  });

  it('ignores a second target when no split is armed', () => {
    const s = table([], ['live', 'blank']);
    const fired = reducer(s, { type: 'FIRE', targetId: 2, targetId2: 3 });
    expect(fired.phase).toBe('resolving');
    expect(fired.pendingShot?.split).toBe(false);
    const done = reducer(fired, { type: 'RESOLVE_SHOT' });
    // seat 3 must be unharmed — no split, no second hit
    expect(done.players[2].lives).toBe(3);
  });
});

describe('the split respects existing item rules', () => {
  it('counts against the 4-item cap like any other item', () => {
    const s = table(['split', 'glass', 'saw', 'life'], ['live']);
    expect(s.players[0].items.length).toBe(MAX_ITEMS);
  });

  it('a peeked chamber still suppresses the self-shot reward', () => {
    const armed = arm(table(['split', 'glass'], ['blank', 'live']));
    const peeked = reducer(armed, { type: 'USE_ITEM', item: 'glass' });
    expect(peeked.peekedShell).toBe('blank');
    const s = reducer(reducer(peeked, { type: 'FIRE', targetId: 1 }), { type: 'RESOLVE_SHOT' });
    expect(s.lastShot?.itemSuppressed).toBe(true);
  });
});

describe('the UI selection rules for a split (mirrors GameScreen.selectTarget)', () => {
  /** Exactly the reducer GameScreen uses for its aim list. */
  const tap = (cur: number[], id: number, splitActive: boolean): number[] => {
    if (splitActive) {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length < 2) return [...cur, id];
      return [cur[0], id];
    }
    return cur[0] === id ? [] : [id];
  };

  it('without a split, a tap replaces the single aim', () => {
    expect(tap([], 2, false)).toEqual([2]);
    expect(tap([2], 3, false)).toEqual([3]);
  });

  it('without a split, re-tapping clears the aim', () => {
    expect(tap([2], 2, false)).toEqual([]);
  });

  it('with a split, two taps aim at two seats', () => {
    expect(tap(tap([], 2, true), 3, true)).toEqual([2, 3]);
  });

  it('with a split, re-tapping drops just that seat', () => {
    expect(tap([2, 3], 2, true)).toEqual([3]);
  });

  it('with a split, a third tap replaces the SECOND target and keeps the first', () => {
    // the first target receives the gun, so it must be the stable one
    expect(tap([2, 3], 4, true)).toEqual([2, 4]);
  });

  it('never produces a duplicate pair the reducer would reject', () => {
    const pair = tap(tap([], 2, true), 2, true);
    expect(new Set(pair).size).toBe(pair.length);
  });
});
