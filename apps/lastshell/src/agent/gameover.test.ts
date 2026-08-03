/**
 * Regression: a finished game must be announced to the agent.
 *
 * The bug: the publish effect returned early whenever it wasn't an agent's turn,
 * so at gameOver the app wrote nothing and `.lastshell/` froze on the last agent
 * turn — `phase: "turn"`, `awaitingSeat: 4`, tick stuck on `turn 7 seat 4`. An
 * agent polling turn.txt then correctly concluded it was still its move and
 * waited forever. Observed live: seats 1 and 3 dead, one seat alive, file still
 * advertising a turn.
 */
import { describe, expect, it } from 'vitest';
import { initialState, reducer } from '../engine/reducer';
import { buildStatePayload, tickLine, type AgentSeat } from './protocol';
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
    blankSelfShots: 0,
    kind: 'human',
    ...over,
  };
}

/** Mirrors `gameKey` in useAgentBridge — the roster identity of a game. */
function gameKey(s: GameState): string {
  return `${s.players.length}:${s.players.map((x) => x.name).join(',')}`;
}

/** Fire and let the shot resolve — `FIRE` only reaches `resolving`. */
function fireAndResolve(s: GameState, targetId: number): GameState {
  const shot = reducer(s, { type: 'FIRE', targetId });
  return reducer(shot, { type: 'RESOLVE_SHOT' });
}

/** A table one live shell away from ending: seat 2 (agent) can finish seat 1. */
function onePlayerFromDeath(): GameState {
  return {
    ...initialState(),
    phase: 'turn',
    players: [
      p(1, { name: 'Player 1', lives: 1 }),
      p(2, { name: 'UNIT-7', kind: 'agent', tier: 'steady' }),
    ],
    activePlayerId: 2,
    shellQueue: ['live'] as Shell[],
    roundComposition: { live: 1, blank: 1 },
    spentShells: ['blank'] as Shell[],
    round: 1,
  };
}

describe('game over reaches the agent', () => {
  it('the reducer actually ends the game (fixture sanity)', () => {
    const end = fireAndResolve(onePlayerFromDeath(), 1);
    expect(end.phase).toBe('gameOver');
    expect(end.winnerId).toBe(2);
  });

  it('the published payload stops advertising a turn once the game is over', () => {
    const end = fireAndResolve(onePlayerFromDeath(), 1);
    const payload = buildStatePayload(end, SEATS, 8, []);

    expect(payload.phase).toBe('gameOver');
    // the two fields an agent judges by — neither may imply "your move"
    expect(payload.awaitingSeat).toBeNull();
    expect(payload.awaitingPersona).toBeNull();
    expect(payload.legalActions).toEqual([]);
  });

  it('the payload names the winner and the final standings', () => {
    const end = fireAndResolve(onePlayerFromDeath(), 1);
    const payload = buildStatePayload(end, SEATS, 8, []);

    expect(payload.outcome).not.toBeNull();
    expect(payload.outcome!.winnerSeat).toBe(2);
    expect(payload.outcome!.winnerName).toBe('UNIT-7');
    expect(payload.outcome!.agentWon).toBe(true);
    expect(payload.outcome!.standings).toEqual([
      { seat: 1, name: 'Player 1', lives: 0, alive: false },
      { seat: 2, name: 'UNIT-7', lives: 3, alive: true },
    ]);
  });

  it('reports a human win as agentWon: false', () => {
    const s: GameState = {
      ...onePlayerFromDeath(),
      players: [
        p(1, { name: 'Player 1' }),
        p(2, { name: 'UNIT-7', kind: 'agent', tier: 'steady', lives: 1 }),
      ],
      activePlayerId: 1,
    };
    const end = fireAndResolve(s, 2);
    expect(end.phase).toBe('gameOver');
    const payload = buildStatePayload(end, SEATS, 4, []);
    expect(payload.outcome!.winnerSeat).toBe(1);
    expect(payload.outcome!.agentWon).toBe(false);
  });

  it('outcome is null while the game is still running', () => {
    const payload = buildStatePayload(onePlayerFromDeath(), SEATS, 1, []);
    expect(payload.phase).toBe('turn');
    expect(payload.outcome).toBeNull();
  });

  it('never leaks the shell order in the final payload either', () => {
    // fairness holds at the boundary too — gameOver is not an excuse to dump state
    const end = fireAndResolve(onePlayerFromDeath(), 1);
    const json = JSON.stringify(buildStatePayload(end, SEATS, 8, []));
    expect(json).not.toContain('shellQueue');
  });
});

describe('the tick line tells the agent which of the three states it is in', () => {
  it('an agent turn names the seat and persona', () => {
    const payload = buildStatePayload(onePlayerFromDeath(), SEATS, 5, []);
    expect(tickLine(payload)).toBe('turn 5 seat 2 UNIT-7');
  });

  it('a human turn is marked human, and still names the seat that holds the gun', () => {
    const s = { ...onePlayerFromDeath(), activePlayerId: 1 };
    const payload = buildStatePayload(s, SEATS, 6, []);
    expect(payload.awaitingSeat).toBeNull();
    // regression: the tick must not go stale just because no agent is up
    expect(tickLine(payload)).toBe('turn 6 seat 1 human');
  });

  it('game over says so and names the winner', () => {
    const end = fireAndResolve(onePlayerFromDeath(), 1);
    const payload = buildStatePayload(end, SEATS, 7, []);
    expect(tickLine(payload)).toBe('turn 7 gameOver winner 2 UNIT-7');
  });

  it('a finished game never emits a tick that looks like a pending turn', () => {
    const end = fireAndResolve(onePlayerFromDeath(), 1);
    const tick = tickLine(buildStatePayload(end, SEATS, 7, []));
    // this exact shape is what kept the agent waiting
    expect(tick).not.toMatch(/seat \d+ (UNIT-7|DEALER)$/);
    expect(tick).toContain('gameOver');
  });

  it('the tick changes on every transition through the end of a game', () => {
    const start = onePlayerFromDeath();
    const end = fireAndResolve(start, 1);
    const ticks = [
      tickLine(buildStatePayload(start, SEATS, 1, [])),
      tickLine(buildStatePayload(end, SEATS, 2, [])),
    ];
    expect(new Set(ticks).size).toBe(ticks.length);
  });
});

describe('a new game is distinguishable from the one that ended', () => {
  it('a fresh table changes the game key even though round returns to 1', () => {
    const end = fireAndResolve(onePlayerFromDeath(), 1);
    const next = reducer(end, {
      type: 'START_GAME',
      seats: [
        { name: 'Ana', kind: 'human' },
        { name: 'UNIT-7', kind: 'agent', tier: 'steady' },
        { name: 'DEALER', kind: 'agent', tier: 'sharp' },
      ],
    });

    expect(next.phase).not.toBe('gameOver');
    expect(next.round).toBe(1);
    // round alone can't tell "new game" from "next round"; the roster can
    expect(gameKey(next)).not.toBe(gameKey(end));
  });

  it('a rematch with the identical roster still republishes via phase', () => {
    // gameKey is stable here, so the phase transition is what must carry it
    const end = fireAndResolve(onePlayerFromDeath(), 1);
    const seats = end.players.map((x) => ({
      name: x.name,
      kind: x.kind,
      tier: x.tier,
    }));
    const rematch = reducer(end, { type: 'START_GAME', seats });
    expect(gameKey(rematch)).toBe(gameKey(end));
    expect(end.phase).toBe('gameOver');
    expect(rematch.phase).not.toBe('gameOver');
  });

  it('the first payload of a new game advertises a live turn again', () => {
    const end = fireAndResolve(onePlayerFromDeath(), 1);
    const next = reducer(end, {
      type: 'START_GAME',
      seats: [
        { name: 'Ana', kind: 'human' },
        { name: 'UNIT-7', kind: 'agent', tier: 'steady' },
      ],
    });
    const payload = buildStatePayload(next, [{ seat: 2, name: 'UNIT-7', tier: 'steady' }], 1, []);
    expect(payload.outcome).toBeNull();
    // whoever holds the gun, the stale gameOver must not persist in the payload
    expect(payload.phase).not.toBe('gameOver');
  });
});
