/**
 * Wires the game to the agent's file protocol.
 *
 * On every agent turn:
 *   1. publish `game-state.json` (public info only)
 *   2. wait for the agent to write `moves.json`
 *   3. validate it against the pure reducer — the app is the referee
 *   4. apply it, or fall back to the built-in heuristic if the agent never
 *      answers (so a table is never stuck waiting on a CLI that isn't running)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action, GameState } from '../engine/types';
import { reducer } from '../engine/reducer';
import { decide } from '../engine/agent/brain';
import { toAgentView } from '../engine/agent/view';
import { isTauri } from '../runtime';
import {
  buildStatePayload,
  tickLine,
  validateMove,
  type AgentSeat,
  type MovePayload,
} from './protocol';

/**
 * How long to wait for the agent before the local heuristic takes the seat.
 *
 * Deliberately generous: a real agent turn is a model round-trip plus two file
 * reads, and an impatient fallback is worse than a slow turn — it steals the
 * seat and the agent's actual reasoning never reaches the table. Only fires
 * when the agent has genuinely stopped responding.
 */
const AGENT_TIMEOUT_MS = 300_000;
/** Minimum on-screen think time so a fast move is still readable. */
const MIN_THINK_MS = 700;

export interface AgentActivity {
  seat: number;
  name: string;
  tier: AgentSeat['tier'];
  thoughts: string[];
  confidence: number;
  /** who actually decided: the real agent, or the local fallback */
  source: 'agent' | 'fallback';
}

export function useAgentBridge({
  state,
  dispatch,
  project,
  agentSeats,
  enabled,
}: {
  state: GameState;
  dispatch: (a: Action) => void;
  project: string | null;
  agentSeats: AgentSeat[];
  enabled: boolean;
}) {
  const [activity, setActivity] = useState<AgentActivity | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const turnRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const busyRef = useRef(false);

  const note = useCallback((line: string) => {
    setLog((l) => [...l.slice(-39), line]);
  }, []);

  const active = state.players.find((p) => p.id === state.activePlayerId);
  const isAgentTurn =
    enabled &&
    state.phase === 'turn' &&
    !!active &&
    agentSeats.some((s) => s.seat === active.id);

  /**
   * A game identity that changes when a NEW game starts. `round` restarts at 1
   * and phase returns to 'turn', so neither alone distinguishes "new table" from
   * "next round" — the seat roster does.
   */
  const gameKey = `${state.players.length}:${state.players.map((p) => p.name).join(',')}`;

  /**
   * Everything mid-turn that changes what the agent should do next. An item use
   * keeps the gun, so these must trigger a republish or the agent is left
   * waiting on a tick that never advances.
   */
  const agentStateKey = `${active?.items.length ?? 0}:${active?.lives ?? 0}:${state.sawActive}:${state.peekedShell ?? '-'}:${state.round}`;

  /** Take the turn with the local heuristic. */
  const playFallback = useCallback(
    (reason: string) => {
      const cur = stateRef.current;
      const seat = cur.players.find((p) => p.id === cur.activePlayerId);
      if (!seat) return;
      const persona = agentSeats.find((s) => s.seat === seat.id);
      const d = decide(toAgentView(cur, seat.id));
      setActivity({
        seat: seat.id,
        name: persona?.name ?? seat.name,
        tier: persona?.tier ?? 'steady',
        thoughts: d.thoughts,
        confidence: d.confidence,
        source: 'fallback',
      });
      note(`seat ${seat.id}: local fallback (${reason}) → ${d.rule}`);
      // Mark the turn as taken so the arming effect can't double-play it, then
      // let the reasoning render before the shot resolves — dispatching in this
      // tick would clear the panel before anyone could read it.
      busyRef.current = true;
      const legal = reducer(cur, d.action) !== cur;
      const action = legal ? d.action : ({ type: 'FIRE', targetId: seat.id } as Action);
      setTimeout(() => dispatch(action), MIN_THINK_MS);
    },
    [agentSeats, dispatch, note],
  );

  /**
   * Publish a terminal/idle state so a watching agent learns the table moved on.
   *
   * Without this the files froze on the last agent turn: `phase` stayed `"turn"`
   * and the tick stayed `turn N seat M` forever, so an agent polling turn.txt
   * correctly concluded it was still its move and waited on a signal the app had
   * stopped sending. A game ending is every bit as much news as a turn starting.
   */
  const publishIdle = useCallback(
    () => {
      if (!isTauri() || !project) return;
      const cur = stateRef.current;
      const turn = ++turnRef.current;
      const payload = buildStatePayload(cur, agentSeats, turn, log);
      void (async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        // Retract any move for the turn that just ended so a late write can't be
        // mistaken for a fresh one when the next game starts.
        await invoke('game_clear_moves', { project }).catch(() => {});
        await invoke('game_write_state', {
          project,
          json: JSON.stringify(payload, null, 2),
          tick: `${tickLine(payload)}\n`,
        }).catch((e) => note(`write state failed: ${e}`));
      })();
    },
    // `log` is read as a snapshot; it changes as a result of publishing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, agentSeats, note],
  );

  // Announce game over exactly once per finished game, whoever won and whether
  // or not an agent held the gun at the end.
  useEffect(() => {
    if (!enabled || state.phase !== 'gameOver') return;
    const winner = state.players.find((p) => p.id === state.winnerId);
    publishIdle();
    note(`game over — ${winner ? `${winner.name} wins` : 'no winner'}`);
    setActivity(null);
    // Keyed on the finished game's identity so a rematch re-announces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, state.phase, state.winnerId, gameKey]);

  // Publish state + arm the timeout whenever an agent seat gets the gun.
  useEffect(() => {
    if (!isAgentTurn || !active) {
      // Clear the panel, and if the game is still live tell the agent it is now
      // a human's turn (awaitingSeat: null) rather than leaving a stale tick.
      // gameOver is handled by its own effect, which also names the winner.
      if (!isAgentTurn) {
        setActivity(null);
        if (enabled && state.phase === 'turn') publishIdle();
      }
      return;
    }
    let cancelled = false;
    busyRef.current = false;
    const turn = ++turnRef.current;

    const payload = buildStatePayload(stateRef.current, agentSeats, turn, log);
    const persona = agentSeats.find((s) => s.seat === active.id);
    setActivity({
      seat: active.id,
      name: persona?.name ?? active.name,
      tier: persona?.tier ?? 'steady',
      thoughts: [],
      confidence: 0,
      source: 'agent',
    });

    if (isTauri() && project) {
      void (async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        // clear any stale move before advertising the new turn
        await invoke('game_clear_moves', { project }).catch(() => {});
        // The tick line is what a watching agent blocks on; keep it terse and
        // greppable. Derived from the payload so the two can't disagree. Written
        // after the state file (see game.rs).
        await invoke('game_write_state', {
          project,
          json: JSON.stringify(payload, null, 2),
          tick: `${tickLine(payload)}\n`,
        }).catch((e) => note(`write state failed: ${e}`));
      })();
    } else {
      // No desktop shell → no agent CLI is reachable, so the built-in
      // heuristic takes the seat. playFallback holds the reasoning on screen
      // for MIN_THINK_MS before dispatching.
      playFallback('no desktop runtime');
      return () => {
        cancelled = true;
      };
    }

    const timeout = setTimeout(() => {
      if (!cancelled && !busyRef.current) playFallback('agent timed out');
    }, AGENT_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // Republish on EVERY change the agent could act on — not just a fired shell.
    // Using an item does not end the turn, so item count / saw / peek must be in
    // here: without them the tick never advances after a USE_ITEM and an agent
    // watching turn.txt waits forever for a signal that never comes.
    // `log` is intentionally omitted: it changes as a result of this effect.
    // gameKey is in here so a rematch republishes even if the new game happens to
    // open on the same seat and turn number as the last one ended on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAgentTurn,
    state.phase,
    state.activePlayerId,
    state.spentShells.length,
    agentStateKey,
    gameKey,
    project,
  ]);

  // React to the agent writing moves.json.
  useEffect(() => {
    if (!enabled || !isTauri() || !project) return;
    let unlisten: (() => void) | null = null;
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');
      unlisten = await listen('moves://changed', async () => {
        if (busyRef.current) return;
        const raw = await invoke<string | null>('game_read_moves', { project }).catch(() => null);
        if (!raw) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          note('moves.json is not valid JSON — ignoring');
          return;
        }
        const cur = stateRef.current;
        const result = validateMove(cur, agentSeats, turnRef.current, parsed, reducer);
        if (!result.ok) {
          note(`move rejected (${result.reason}): ${result.detail}`);
          return;
        }
        busyRef.current = true;
        const m = parsed as MovePayload;
        const persona = agentSeats.find((s) => s.seat === m.seat);
        setActivity({
          seat: m.seat,
          name: persona?.name ?? `seat ${m.seat}`,
          tier: persona?.tier ?? 'steady',
          thoughts: result.thoughts,
          confidence: result.confidence,
          source: 'agent',
        });
        note(`seat ${m.seat}: ${m.action}${m.target ? ` → ${m.target}` : ''}`);
        await invoke('game_clear_moves', { project }).catch(() => {});
        // let the reasoning land on screen before the shot fires
        setTimeout(() => dispatch(result.action), MIN_THINK_MS);
      });
    })();
    return () => unlisten?.();
  }, [enabled, project, agentSeats, dispatch, note]);

  return { activity, log };
}
