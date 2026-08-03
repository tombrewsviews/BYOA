import { afterEach, describe, expect, it } from 'vitest';
import { initialState, reducer } from '../reducer';
import { seed, unseed } from '../rng';
import { decide } from './brain';
import { toAgentView } from './view';
import type { GameState, Item, Player, Shell, Tier } from '../types';

afterEach(() => unseed());

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

/** Agent in seat 1; `live`/`blank` describe the round, `spent` what was fired. */
function view(opts: {
  tier: Tier;
  live: number;
  blank: number;
  spent?: Shell[];
  remaining?: number;
  items?: Item[];
  lives?: number;
  others?: Player[];
  sawActive?: boolean;
  peeked?: Shell | null;
}) {
  const spent = opts.spent ?? [];
  const remaining = opts.remaining ?? opts.live + opts.blank - spent.length;
  const st: GameState = {
    ...initialState(),
    phase: 'turn',
    players: [
      p(1, { kind: 'agent', tier: opts.tier, items: opts.items ?? [], lives: opts.lives ?? 3 }),
      ...(opts.others ?? [p(2), p(3)]),
    ],
    activePlayerId: 1,
    shellQueue: Array(remaining).fill('blank') as Shell[],
    roundComposition: { live: opts.live, blank: opts.blank },
    spentShells: spent,
    sawActive: opts.sawActive ?? false,
    peekedShell: opts.peeked ?? null,
    round: 1,
  };
  return toAgentView(st, 1);
}

describe('agent brain — shared guarantees', () => {
  it('every tier returns a legal action the reducer accepts', () => {
    seed(7);
    for (const tier of ['reckless', 'steady', 'sharp'] as Tier[]) {
      for (let i = 0; i < 200; i++) {
        const st: GameState = {
          ...initialState(),
          phase: 'turn',
          players: [
            p(1, { kind: 'agent', tier, items: ['glass', 'saw'], lives: 1 + (i % 3) }),
            p(2, { lives: 1 + (i % 2) }),
            p(3, { lives: 2 }),
          ],
          activePlayerId: 1,
          shellQueue: Array(1 + (i % 5)).fill('live') as Shell[],
          roundComposition: { live: 2, blank: 2 },
          spentShells: i % 2 ? ['blank'] : [],
          round: 1,
        };
        const d = decide(toAgentView(st, 1));
        // the reducer is the arbiter of legality: state must actually change
        const after = reducer(st, d.action);
        expect(after).not.toBe(st);
        expect(d.thoughts.length).toBeGreaterThan(0);
      }
    }
  });

  it('always explains itself', () => {
    seed(3);
    for (const tier of ['reckless', 'steady', 'sharp'] as Tier[]) {
      const d = decide(view({ tier, live: 2, blank: 2 }));
      expect(d.thoughts.every((t) => typeof t === 'string' && t.length > 0)).toBe(true);
      expect(d.rule).toBeTruthy();
    }
  });
});

describe('steady tier — plays the odds', () => {
  it('self-shoots when blanks dominate', () => {
    const d = decide(view({ tier: 'steady', live: 1, blank: 3 }));
    expect(d.action).toEqual({ type: 'FIRE', targetId: 1 });
    expect(d.rule).toBe('odds-self');
  });

  it('fires outward when live shells dominate', () => {
    const d = decide(view({ tier: 'steady', live: 3, blank: 1 }));
    expect(d.action.type).toBe('FIRE');
    expect((d.action as { targetId: number }).targetId).not.toBe(1);
    expect(d.rule).toBe('odds-other');
  });

  it('takes the free item when no live shells remain', () => {
    const d = decide(view({ tier: 'steady', live: 1, blank: 3, spent: ['live'] }));
    expect(d.action).toEqual({ type: 'FIRE', targetId: 1 });
    expect(d.rule).toBe('certain-blank');
    expect(d.confidence).toBe(1);
  });

  it('saws before a guaranteed live round', () => {
    const d = decide(
      view({ tier: 'steady', live: 2, blank: 2, spent: ['blank', 'blank'], items: ['saw'] }),
    );
    expect(d.action).toEqual({ type: 'USE_ITEM', item: 'saw' });
    expect(d.rule).toBe('certain-live-saw');
  });
});

describe('sharp tier — reads the table', () => {
  it('takes a certain kill on the weakest opponent', () => {
    const d = decide(
      view({
        tier: 'sharp',
        live: 2,
        blank: 2,
        spent: ['blank', 'blank'], // only live shells left
        others: [p(2, { lives: 3 }), p(3, { lives: 1 })],
      }),
    );
    expect(d.action).toEqual({ type: 'FIRE', targetId: 3 });
    expect(d.rule).toBe('certain-kill');
  });

  it('never gambles a self-shot on its last life', () => {
    const d = decide(view({ tier: 'sharp', live: 2, blank: 2, lives: 1 }));
    expect(d.action.type).toBe('FIRE');
    expect((d.action as { targetId: number }).targetId).not.toBe(1);
  });

  it('heals first when on one life', () => {
    const d = decide(view({ tier: 'sharp', live: 2, blank: 2, lives: 1, items: ['life'] }));
    expect(d.action).toEqual({ type: 'USE_ITEM', item: 'life' });
    expect(d.rule).toBe('heal-critical');
  });

  it('spends the glass at maximum uncertainty', () => {
    const d = decide(view({ tier: 'sharp', live: 2, blank: 2, items: ['glass'] }));
    expect(d.action).toEqual({ type: 'USE_ITEM', item: 'glass' });
    expect(d.rule).toBe('glass-uncertain');
  });

  it('does not waste the glass when the odds are already lopsided', () => {
    const d = decide(view({ tier: 'sharp', live: 1, blank: 7, items: ['glass'] }));
    expect(d.rule).not.toBe('glass-uncertain');
  });

  it('acts on its own peek instead of re-checking', () => {
    const d = decide(
      view({ tier: 'sharp', live: 2, blank: 2, items: ['glass'], peeked: 'blank' }),
    );
    // a known blank is a free item
    expect(d.action).toEqual({ type: 'FIRE', targetId: 1 });
    expect(d.rule).toBe('certain-blank');
  });

  it('cuffs the biggest threat', () => {
    const d = decide(
      view({
        tier: 'sharp',
        live: 1,
        blank: 3,
        items: ['cuffs'],
        others: [p(2, { lives: 3 }), p(3, { lives: 1, items: ['saw', 'glass'] })],
      }),
    );
    expect(d.action).toEqual({ type: 'USE_ITEM', item: 'cuffs', targetId: 3 });
    expect(d.rule).toBe('cuff-threat');
  });
});

describe('tiers are actually different', () => {
  it('sharp protects its last life where reckless does not care', () => {
    seed(11);
    // 50/50 chamber, agent on 1 life: sharp must fire outward every time
    for (let i = 0; i < 30; i++) {
      const d = decide(view({ tier: 'sharp', live: 2, blank: 2, lives: 1 }));
      expect((d.action as { targetId: number }).targetId).not.toBe(1);
    }
    // reckless self-shoots at least sometimes in the same spot
    let recklessSelfShots = 0;
    for (let i = 0; i < 60; i++) {
      const d = decide(view({ tier: 'reckless', live: 2, blank: 2, lives: 1 }));
      if ((d.action as { targetId: number }).targetId === 1) recklessSelfShots++;
    }
    expect(recklessSelfShots).toBeGreaterThan(0);
  });

  it('reckless ignores a certain-live chamber that steady exploits', () => {
    seed(5);
    const certainLive = { live: 2, blank: 2, spent: ['blank', 'blank'] as Shell[] };
    const steady = decide(view({ tier: 'steady', ...certainLive }));
    expect(steady.rule).toBe('certain-live');
    // reckless has no such rule — its reasoning never cites the count
    const reckless = decide(view({ tier: 'reckless', ...certainLive }));
    expect(['coinflip-self', 'coinflip-other', 'whim']).toContain(reckless.rule);
  });
});
