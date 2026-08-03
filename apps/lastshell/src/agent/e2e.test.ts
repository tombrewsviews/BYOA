/**
 * End-to-end file protocol: simulate an agent reading game-state.json and
 * writing moves.json, exactly as the SKILL.md instructs, and assert the app
 * would accept it and advance the game.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialState, reducer } from '../engine/reducer';
import { buildStatePayload, validateMove, type AgentSeat } from './protocol';
import type { GameState } from '../engine/types';

const SEATS: AgentSeat[] = [{ seat: 2, name: 'UNIT-7', tier: 'sharp' }];

function table(): GameState {
  return reducer(initialState(), {
    type: 'START_GAME',
    seats: [
      { name: 'Human', kind: 'human' },
      { name: 'UNIT-7', kind: 'agent', tier: 'sharp' },
    ],
  });
}

describe('agent file protocol, end to end', () => {
  it('an agent following SKILL.md can play a full game via files only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lastshell-'));
    mkdirSync(join(dir, '.lastshell'), { recursive: true });
    let s = reducer(table(), { type: 'BEGIN_ROUND' });
    let turn = 0;
    let agentMoves = 0;
    let steps = 0;

    while (s.phase !== 'gameOver' && steps++ < 500) {
      if (s.phase === 'roundIntro') { s = reducer(s, { type: 'BEGIN_ROUND' }); continue; }
      if (s.phase === 'resolving') { s = reducer(s, { type: 'RESOLVE_SHOT' }); continue; }

      turn++;
      // ---- app publishes what the agent may see
      const payload = buildStatePayload(s, SEATS, turn, []);
      writeFileSync(join(dir, '.lastshell/game-state.json'), JSON.stringify(payload, null, 2));

      if (payload.awaitingSeat === null) {
        // human seat — the agent must NOT move. Play the human naively.
        s = reducer(s, { type: 'FIRE', targetId: s.activePlayerId });
        continue;
      }

      // ---- "agent" reads the file and picks from legalActions using the
      //      public odds, exactly as the skill describes
      const seen = JSON.parse(readFileSync(join(dir, '.lastshell/game-state.json'), 'utf8'));
      expect(JSON.stringify(seen)).not.toContain('shellQueue'); // fairness, on disk
      const pLive = seen.odds.pLive as number;
      const self = seen.legalActions.find((a: any) => a.action === 'FIRE' && a.target === seen.awaitingSeat);
      const other = seen.legalActions.find((a: any) => a.action === 'FIRE' && a.target !== seen.awaitingSeat);
      const pick = pLive < 0.5 ? self : (other ?? self);

      writeFileSync(join(dir, '.lastshell/moves.json'), JSON.stringify({
        turn: seen.turn,
        seat: seen.awaitingSeat,
        action: 'FIRE',
        target: pick.target,
        thoughts: [`${seen.view.shellsRemaining} left`, `pLive ${pLive.toFixed(2)}`],
        confidence: 1 - pLive,
      }));

      // ---- app validates and applies
      const raw = JSON.parse(readFileSync(join(dir, '.lastshell/moves.json'), 'utf8'));
      const res = validateMove(s, SEATS, turn, raw, reducer);
      expect(res.ok, `move rejected: ${JSON.stringify(res)}`).toBe(true);
      if (res.ok) { s = reducer(s, res.action); agentMoves++; }
    }

    expect(s.phase).toBe('gameOver');
    expect(agentMoves).toBeGreaterThan(0);
    expect(existsSync(join(dir, '.lastshell/game-state.json'))).toBe(true);
    console.log(`game finished in ${steps} steps; agent made ${agentMoves} moves via files; winner seat ${s.winnerId}`);
  });

  it('rejects an agent that tries to move for the human seat, via the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lastshell-rogue-'));
    mkdirSync(join(dir, '.lastshell'), { recursive: true });
    const s = reducer(table(), { type: 'BEGIN_ROUND' });
    // seat 1 (human) holds the gun
    expect(s.activePlayerId).toBe(1);
    const payload = buildStatePayload(s, SEATS, 1, []);
    expect(payload.awaitingSeat).toBeNull(); // skill says: do nothing

    // a misbehaving agent writes a move for the human anyway
    writeFileSync(
      join(dir, '.lastshell/moves.json'),
      JSON.stringify({ turn: 1, seat: 1, action: 'FIRE', target: 2 }),
    );
    const raw = JSON.parse(readFileSync(join(dir, '.lastshell/moves.json'), 'utf8'));
    const res = validateMove(s, SEATS, 1, raw, reducer);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('wrong-seat');
  });

  it('runs many agent turns when both seats are agents driving through files', () => {
    let s = reducer(
      reducer(initialState(), {
        type: 'START_GAME',
        seats: [
          { name: 'Human', kind: 'human' },
          { name: 'UNIT-7', kind: 'agent', tier: 'sharp' },
          { name: 'DEALER', kind: 'agent', tier: 'steady' },
        ],
      }),
      { type: 'BEGIN_ROUND' },
    );
    const seats: AgentSeat[] = [
      { seat: 2, name: 'UNIT-7', tier: 'sharp' },
      { seat: 3, name: 'DEALER', tier: 'steady' },
    ];
    let turn = 0;
    let moves = 0;
    let steps = 0;
    while (s.phase !== 'gameOver' && steps++ < 1000) {
      if (s.phase === 'roundIntro') { s = reducer(s, { type: 'BEGIN_ROUND' }); continue; }
      if (s.phase === 'resolving') { s = reducer(s, { type: 'RESOLVE_SHOT' }); continue; }
      turn++;
      const payload = buildStatePayload(s, seats, turn, []);
      if (payload.awaitingSeat === null) {
        s = reducer(s, { type: 'FIRE', targetId: s.activePlayerId });
        continue;
      }
      // never leaks the order, on every single turn
      expect(JSON.stringify(payload)).not.toContain('shellQueue');
      const p = payload.odds!.pLive;
      const acts = payload.legalActions.filter((a) => a.action === 'FIRE');
      const self = acts.find((a) => a.target === payload.awaitingSeat)!;
      const other = acts.find((a) => a.target !== payload.awaitingSeat);
      const chosen = p < 0.5 ? self : other ?? self;
      const res = validateMove(
        s,
        seats,
        turn,
        { turn, seat: payload.awaitingSeat, action: 'FIRE', target: chosen.target },
        reducer,
      );
      expect(res.ok).toBe(true);
      if (res.ok) { s = reducer(s, res.action); moves++; }
    }
    expect(s.phase).toBe('gameOver');
    expect(moves).toBeGreaterThan(5);
    console.log(`3-seat table: ${moves} agent moves through the protocol, winner seat ${s.winnerId}`);
  });
});
