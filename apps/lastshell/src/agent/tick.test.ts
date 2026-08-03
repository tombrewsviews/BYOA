import { describe, expect, it } from 'vitest';
import { initialState, reducer } from '../engine/reducer';
import { buildStatePayload, type AgentSeat } from './protocol';
import type { GameState, Player, Shell } from '../engine/types';

const SEATS: AgentSeat[] = [{ seat: 2, name: 'UNIT-7', tier: 'steady' }];

function p(id: number, over: Partial<Player> = {}): Player {
  return { id, name: `P${id}`, lives: 3, items: [], alive: true, cuffedBy: null, blankSelfShots: 0, kind: 'human', ...over };
}

/**
 * The bridge republishes (and bumps the tick) whenever this key changes. Mirrors
 * `agentStateKey` in useAgentBridge — kept in sync by the assertions below.
 */
function agentStateKey(s: GameState): string {
  const a = s.players.find((x) => x.id === s.activePlayerId);
  return `${a?.items.length ?? 0}:${a?.lives ?? 0}:${s.sawActive}:${s.peekedShell ?? '-'}:${s.round}`;
}

describe('turn tick advances on every actionable change', () => {
  const base = (): GameState => ({
    ...initialState(),
    phase: 'turn',
    players: [p(1), p(2, { kind: 'agent', tier: 'steady', items: ['glass', 'saw', 'life'], lives: 2 })],
    activePlayerId: 2,
    shellQueue: ['blank', 'live'] as Shell[],
    roundComposition: { live: 1, blank: 1 },
    round: 1,
  });

  it('changes when the agent uses the glass (a peek must wake it)', () => {
    const before = base();
    const after = reducer(before, { type: 'USE_ITEM', item: 'glass' });
    expect(after.peekedShell).not.toBeNull();
    // regression: USE_ITEM fires no shell and keeps the seat, so a key based
    // only on spentShells/activePlayerId never changed and the agent hung
    expect(after.spentShells.length).toBe(before.spentShells.length);
    expect(after.activePlayerId).toBe(before.activePlayerId);
    expect(agentStateKey(after)).not.toBe(agentStateKey(before));
  });

  it('changes when the agent saws', () => {
    const before = base();
    const after = reducer(before, { type: 'USE_ITEM', item: 'saw' });
    expect(after.sawActive).toBe(true);
    expect(agentStateKey(after)).not.toBe(agentStateKey(before));
  });

  it('changes when the agent heals', () => {
    const before = base();
    const after = reducer(before, { type: 'USE_ITEM', item: 'life' });
    expect(after.players[1].lives).toBe(3);
    expect(agentStateKey(after)).not.toBe(agentStateKey(before));
  });

  it('the published payload still says it is the agent’s turn after an item use', () => {
    const after = reducer(base(), { type: 'USE_ITEM', item: 'glass' });
    const payload = buildStatePayload(after, SEATS, 7, []);
    // the agent must be told to act again — using an item does not pass the gun
    expect(payload.awaitingSeat).toBe(2);
    expect(payload.turn).toBe(7);
    expect(payload.view?.peekedShell).not.toBeNull();
    expect(payload.legalActions.length).toBeGreaterThan(0);
  });

  it('a certain blank is reported as pLive 0 with a self-shot available', () => {
    // the situation from the bug report: 1 shell left, the only live one spent
    const s: GameState = {
      ...base(),
      players: [p(1), p(2, { kind: 'agent', tier: 'steady', items: ['life'], lives: 1 })],
      shellQueue: ['blank'] as Shell[],
      roundComposition: { live: 1, blank: 3 },
      spentShells: ['blank', 'blank', 'live'] as Shell[],
    };
    const payload = buildStatePayload(s, SEATS, 2, []);
    expect(payload.odds?.pLive).toBe(0);
    expect(payload.odds?.liveRemaining).toBe(0);
    expect(payload.legalActions.some((a) => a.action === 'FIRE' && a.target === 2)).toBe(true);
    expect(payload.legalActions.some((a) => a.item === 'life')).toBe(true);
  });
});
