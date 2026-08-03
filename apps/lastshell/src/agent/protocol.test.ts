import { describe, expect, it } from 'vitest';
import { initialState, reducer } from '../engine/reducer';
import {
  buildStatePayload,
  legalActionsFor,
  validateMove,
  type AgentSeat,
} from './protocol';
import type { GameState, Player, Shell } from '../engine/types';

const SEATS: AgentSeat[] = [
  { seat: 2, name: 'UNIT-7', tier: 'steady' },
  { seat: 3, name: 'DEALER', tier: 'sharp' },
];

function p(id: number, over: Partial<Player> = {}): Player {
  return {
    id,
    name: `P${id}`,
    lives: 3,
    items: [],
    alive: true,
    cuffedBy: null,
    kind: 'human',
    ...over,
  };
}

function state(over: Partial<GameState> = {}): GameState {
  return {
    ...initialState(),
    phase: 'turn',
    players: [
      p(1),
      p(2, { kind: 'agent', tier: 'steady' }),
      p(3, { kind: 'agent', tier: 'sharp' }),
    ],
    activePlayerId: 2,
    shellQueue: ['live', 'blank', 'blank'] as Shell[],
    roundComposition: { live: 1, blank: 2 },
    round: 1,
    ...over,
  };
}

describe('state payload (fairness on disk)', () => {
  it('NEVER writes the hidden shell order to the file', () => {
    const payload = buildStatePayload(state(), SEATS, 1, []);
    const json = JSON.stringify(payload);
    expect(json).not.toContain('shellQueue');
    // the actual ordered queue must not appear in any form
    expect(json).not.toContain('["live","blank","blank"]');
    expect(payload.view?.shellsRemaining).toBe(3);
  });

  it('tells the agent which seat and persona to play', () => {
    const payload = buildStatePayload(state(), SEATS, 7, []);
    expect(payload.awaitingSeat).toBe(2);
    expect(payload.awaitingPersona?.name).toBe('UNIT-7');
    expect(payload.turn).toBe(7);
    expect(payload.agentSeats).toHaveLength(2);
  });

  it('awaits nobody on a human turn', () => {
    const payload = buildStatePayload(state({ activePlayerId: 1 }), SEATS, 1, []);
    expect(payload.awaitingSeat).toBeNull();
    expect(payload.view).toBeNull();
    expect(payload.legalActions).toEqual([]);
  });

  it('publishes public odds so the agent needn’t re-derive them', () => {
    const payload = buildStatePayload(
      state({ roundComposition: { live: 2, blank: 2 }, spentShells: ['live'] }),
      SEATS,
      1,
      [],
    );
    expect(payload.odds?.liveRemaining).toBe(1);
    expect(payload.odds?.pLive).toBeCloseTo(1 / 3);
  });
});

describe('legal action enumeration', () => {
  it('lists a shot at every alive seat', () => {
    const acts = legalActionsFor(state(), 2);
    const fires = acts.filter((a) => a.action === 'FIRE').map((a) => a.target);
    expect(fires).toEqual([1, 2, 3]);
  });

  it('omits dead seats', () => {
    const s = state({ players: [p(1), p(2, { kind: 'agent' }), p(3, { alive: false, lives: 0 })] });
    const fires = legalActionsFor(s, 2).filter((a) => a.action === 'FIRE').map((a) => a.target);
    expect(fires).toEqual([1, 2]);
  });

  it('expands cuffs into one option per valid victim', () => {
    const s = state({
      players: [p(1), p(2, { kind: 'agent', items: ['cuffs'] }), p(3)],
    });
    const cuffs = legalActionsFor(s, 2).filter((a) => a.item === 'cuffs');
    expect(cuffs.map((c) => c.target)).toEqual([1, 3]);
  });

  it('hides a saw that is already active and a heal at full lives', () => {
    const s = state({
      players: [p(1), p(2, { kind: 'agent', items: ['saw', 'life'], lives: 3 }), p(3)],
      sawActive: true,
    });
    const items = legalActionsFor(s, 2).filter((a) => a.action === 'USE_ITEM');
    expect(items).toEqual([]);
  });
});

describe('move validation (the app is the referee)', () => {
  const ok = (raw: unknown, s = state(), turn = 1) =>
    validateMove(s, SEATS, turn, raw, reducer);

  it('accepts a legal move for the agent’s own seat', () => {
    const r = ok({ turn: 1, seat: 2, action: 'FIRE', target: 1, thoughts: ['odds are bad'] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action).toEqual({ type: 'FIRE', targetId: 1 });
      expect(r.thoughts).toEqual(['odds are bad']);
    }
  });

  it('REJECTS a move for a seat the agent does not control', () => {
    // seat 1 is the human — an agent must never move for them
    const r = ok({ turn: 1, seat: 1, action: 'FIRE', target: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong-seat');
  });

  it('REJECTS an agent seat moving out of turn', () => {
    // seat 3 is an agent, but it is seat 2's turn
    const r = ok({ turn: 1, seat: 3, action: 'FIRE', target: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong-seat');
  });

  it('REJECTS a stale move from a previous turn', () => {
    const r = ok({ turn: 4, seat: 2, action: 'FIRE', target: 1 }, state(), 9);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('stale-turn');
  });

  it('REJECTS an illegal action the rules forbid', () => {
    // no saw in inventory
    const r = ok({ turn: 1, seat: 2, action: 'USE_ITEM', item: 'saw' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('illegal-action');
  });

  it('REJECTS firing at a dead seat', () => {
    const s = state({
      players: [p(1, { alive: false, lives: 0 }), p(2, { kind: 'agent' }), p(3)],
    });
    const r = validateMove(s, SEATS, 1, { turn: 1, seat: 2, action: 'FIRE', target: 1 }, reducer);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('illegal-action');
  });

  it('REJECTS malformed payloads instead of throwing', () => {
    for (const bad of [null, 42, 'nope', {}, { seat: 2 }, { seat: 2, action: 'DANCE' }]) {
      const r = ok(bad);
      expect(r.ok).toBe(false);
    }
    const noItem = ok({ turn: 1, seat: 2, action: 'USE_ITEM' });
    expect(noItem.ok).toBe(false);
  });

  it('rejects any move when it is not a turn phase', () => {
    const r = ok({ turn: 1, seat: 2, action: 'FIRE', target: 1 }, state({ phase: 'resolving' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not-agent-turn');
  });
});
