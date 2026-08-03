import { describe, expect, it } from 'vitest';
import { initialState } from '../reducer';
import { toAgentView, pLive, liveRemaining } from './view';
import type { GameState, Player, Shell } from '../types';

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

function state(over: Partial<GameState> = {}): GameState {
  return {
    ...initialState(),
    phase: 'turn',
    players: [p(1, { kind: 'agent', tier: 'sharp' }), p(2), p(3)],
    activePlayerId: 1,
    shellQueue: ['live', 'blank', 'blank'] as Shell[],
    roundComposition: { live: 1, blank: 2 },
    round: 1,
    ...over,
  };
}

describe('agent view redaction (fairness)', () => {
  it('NEVER exposes the hidden shell order', () => {
    const view = toAgentView(state(), 1);
    // the whole fairness guarantee in one assertion
    expect(Object.keys(view)).not.toContain('shellQueue');
    expect(JSON.stringify(view)).not.toContain('shellQueue');
    // and no nested field smuggles the ordered queue through
    const flat = JSON.stringify(view);
    expect(flat).not.toContain('["live","blank","blank"]');
  });

  it('exposes only the COUNT of remaining shells', () => {
    const view = toAgentView(state(), 1);
    expect(view.shellsRemaining).toBe(3);
  });

  it('does not leak another player’s peek', () => {
    // player 2 holds the gun and peeked; agent 1 must not see it
    const view = toAgentView(state({ activePlayerId: 2, peekedShell: 'live' }), 1);
    expect(view.peekedShell).toBeNull();
  });

  it('surfaces the agent’s own peek', () => {
    const view = toAgentView(state({ activePlayerId: 1, peekedShell: 'live' }), 1);
    expect(view.peekedShell).toBe('live');
    expect(pLive(view)).toBe(1);
  });

  it('reports public info the table can also see', () => {
    const view = toAgentView(state({ spentShells: ['blank'] }), 1);
    expect(view.composition).toEqual({ live: 1, blank: 2 });
    expect(view.spentShells).toEqual(['blank']);
    expect(view.opponents.map((o) => o.id)).toEqual([2, 3]);
    expect(view.self.tier).toBe('sharp');
  });

  it('derives live-remaining and p(live) from public info only', () => {
    // round announced 2 live / 2 blank; one live already fired; 2 shells left
    const view = toAgentView(
      state({
        roundComposition: { live: 2, blank: 2 },
        spentShells: ['live', 'blank'],
        shellQueue: ['live', 'blank'] as Shell[],
      }),
      1,
    );
    expect(liveRemaining(view)).toBe(1);
    expect(pLive(view)).toBe(0.5);
  });

  it('p(live) is 1 when every remaining shell must be live', () => {
    const view = toAgentView(
      state({
        roundComposition: { live: 2, blank: 2 },
        spentShells: ['blank', 'blank'],
        shellQueue: ['live', 'live'] as Shell[],
      }),
      1,
    );
    expect(pLive(view)).toBe(1);
  });

  it('p(live) is 0 when every live shell is spent', () => {
    const view = toAgentView(
      state({
        roundComposition: { live: 1, blank: 3 },
        spentShells: ['live'],
        shellQueue: ['blank', 'blank', 'blank'] as Shell[],
      }),
      1,
    );
    expect(pLive(view)).toBe(0);
  });
});
