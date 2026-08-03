/**
 * The file protocol the agent plays through.
 *
 * DreamStore's agent-native pattern (cf. Lens's `query.json`): the app owns the
 * document, the agent edits a file, the app reacts. Here:
 *
 *   app   → .lastshell/game-state.json   what the agent may know (PUBLIC ONLY)
 *   agent → .lastshell/moves.json        the move it wants to make + why
 *
 * FAIRNESS: game-state.json is built from `toAgentView`, so the hidden shell
 * order (`GameState.shellQueue`) never reaches disk. A real LLM agent reading
 * the file therefore cannot see the future — it counts the same odds a human at
 * the table can. Do not add the queue to this payload.
 */
import type { Action, GameState, Item, Tier } from '../engine/types';
import { toAgentView, pLive, liveRemaining, type AgentView } from '../engine/agent/view';

export const STATE_FILE = 'game-state.json';
export const MOVES_FILE = 'moves.json';
export const TABLE_FILE = 'table.json';

/** Personas the skill impersonates — one per agent seat. */
export interface AgentSeat {
  seat: number;
  name: string;
  tier: Tier;
}

/** What the app writes for the agent to read. */
export interface StatePayload {
  /** bumped every time the app writes; the agent echoes it back */
  turn: number;
  phase: GameState['phase'];
  round: number;
  /** whose move the app is waiting for; null when it's a human's turn */
  awaitingSeat: number | null;
  /**
   * The seat holding the gun, agent or human. Unlike `awaitingSeat` this is set
   * on a human's turn too, so the agent can see the table is progressing rather
   * than guess from an unchanging tick.
   */
  activeSeat: number | null;
  /** the persona this seat should play as */
  awaitingPersona: AgentSeat | null;
  /** every agent seat, so the skill knows who it speaks for */
  agentSeats: AgentSeat[];
  view: AgentView | null;
  /** pre-computed public odds, so the agent needn't re-derive them */
  odds: { liveRemaining: number; pLive: number } | null;
  legalActions: LegalAction[];
  /** append-only log of what has happened, newest last */
  log: string[];
  /**
   * Set only when `phase` is `"gameOver"`. Present so the agent learns the
   * outcome from the same file it plays through, rather than inferring an ending
   * from a tick that stopped changing.
   */
  outcome: GameOutcome | null;
}

/** Who won, once the table is finished. */
export interface GameOutcome {
  winnerSeat: number | null;
  winnerName: string | null;
  /** true when the winning seat is one the agent was playing */
  agentWon: boolean;
  /** every seat's final standing, in seat order */
  standings: { seat: number; name: string; lives: number; alive: boolean }[];
}

/** A move the agent is allowed to make, spelled out so it needn't guess. */
export interface LegalAction {
  action: 'FIRE' | 'USE_ITEM';
  target?: number;
  /** second target — only present for split-shell shots */
  target2?: number;
  item?: Item;
  label: string;
}

/** What the agent writes back. */
export interface MovePayload {
  turn: number;
  seat: number;
  action: 'FIRE' | 'USE_ITEM';
  target?: number;
  /** second target — required when a split shell is armed */
  target2?: number;
  item?: Item;
  thoughts?: string[];
  confidence?: number;
}

/** Enumerate every legal move for the active seat, from public info only. */
export function legalActionsFor(state: GameState, seatId: number): LegalAction[] {
  if (state.phase !== 'turn' || state.activePlayerId !== seatId) return [];
  const me = state.players.find((p) => p.id === seatId);
  if (!me) return [];
  const out: LegalAction[] = [];

  for (const p of state.players) {
    if (!p.alive) continue;
    out.push({
      action: 'FIRE',
      target: p.id,
      label: p.id === seatId ? 'FIRE at yourself' : `FIRE at seat ${p.id} (${p.name})`,
    });
  }

  if (state.splitActive) {
    // With a split armed, every ordered pair of distinct live seats is also
    // legal. The FIRST of the pair receives the gun (the second is collateral),
    // so (a,b) and (b,a) are genuinely different moves and both are listed.
    // Single-target shots above stay legal — the split is simply wasted.
    const alive = state.players.filter((p) => p.alive);
    for (const a of alive) {
      for (const b of alive) {
        if (a.id === b.id) continue;
        out.push({
          action: 'FIRE',
          target: a.id,
          target2: b.id,
          label: `SPLIT FIRE at seat ${a.id} (${a.name}) + seat ${b.id} (${b.name})`,
        });
      }
    }
  }

  const seen = new Set<Item>();
  for (const item of me.items) {
    if (seen.has(item)) continue;
    seen.add(item);
    if (item === 'saw' && state.sawActive) continue;
    if (item === 'life' && me.lives >= 3) continue;
    if (item === 'split') {
      // matches the reducer's guards: no stacking, and two other live targets
      if (state.splitActive) continue;
      if (state.players.filter((p) => p.alive && p.id !== seatId).length < 2) continue;
    }
    if (item === 'golden') {
      // Always usable when held. Spell out the effect so the agent doesn't have
      // to infer it from the item name.
      const hits = state.players.filter((p) => p.alive && p.id !== seatId).length;
      out.push({
        action: 'USE_ITEM',
        item: 'golden',
        label: `USE golden bullet — 2 lives off all ${hits} other player${hits === 1 ? '' : 's'}`,
      });
      continue;
    }
    if (item === 'cuffs') {
      for (const p of state.players) {
        if (!p.alive || p.id === seatId || p.cuffedBy !== null) continue;
        out.push({
          action: 'USE_ITEM',
          item: 'cuffs',
          target: p.id,
          label: `USE cuffs on seat ${p.id} (${p.name})`,
        });
      }
      continue;
    }
    out.push({ action: 'USE_ITEM', item, label: `USE ${item}` });
  }
  return out;
}

/** Build the payload the app writes to disk. */
export function buildStatePayload(
  state: GameState,
  agentSeats: AgentSeat[],
  turn: number,
  log: string[],
): StatePayload {
  const active = state.players.find((p) => p.id === state.activePlayerId);
  const isAgentTurn =
    state.phase === 'turn' && !!active && agentSeats.some((s) => s.seat === active.id);
  const awaitingSeat = isAgentTurn ? active!.id : null;
  const view = awaitingSeat !== null ? toAgentView(state, awaitingSeat) : null;
  const winner = state.players.find((p) => p.id === state.winnerId) ?? null;
  return {
    turn,
    phase: state.phase,
    round: state.round,
    awaitingSeat,
    activeSeat: state.phase === 'gameOver' ? null : (active?.id ?? null),
    awaitingPersona: agentSeats.find((s) => s.seat === awaitingSeat) ?? null,
    agentSeats,
    view,
    odds: view ? { liveRemaining: liveRemaining(view), pLive: pLive(view) } : null,
    legalActions: awaitingSeat !== null ? legalActionsFor(state, awaitingSeat) : [],
    log: log.slice(-40),
    outcome:
      state.phase === 'gameOver'
        ? {
            winnerSeat: state.winnerId,
            winnerName: winner?.name ?? null,
            agentWon: agentSeats.some((s) => s.seat === state.winnerId),
            standings: state.players.map((p) => ({
              seat: p.id,
              name: p.name,
              lives: p.lives,
              alive: p.alive,
            })),
          }
        : null,
  };
}

/**
 * The one line the agent blocks on. It must differ whenever the agent's correct
 * next action differs, and must never advertise a turn that isn't happening.
 *
 * Derived from the payload rather than passed in, so the tick and the state file
 * cannot disagree — they used to, which is how a finished game kept announcing
 * `seat 4` and the agent kept waiting for a move it already made.
 */
export function tickLine(payload: StatePayload): string {
  if (payload.phase === 'gameOver') {
    const o = payload.outcome;
    return `turn ${payload.turn} gameOver winner ${o?.winnerSeat ?? 'none'} ${o?.winnerName ?? ''}`.trimEnd();
  }
  if (payload.awaitingSeat === null) {
    return `turn ${payload.turn} seat ${payload.activeSeat ?? '-'} human`;
  }
  return `turn ${payload.turn} seat ${payload.awaitingSeat} ${payload.awaitingPersona?.name ?? ''}`.trimEnd();
}

export type MoveRejection =
  | 'not-agent-turn'
  | 'wrong-seat'
  | 'stale-turn'
  | 'malformed'
  | 'illegal-action';

export type MoveResult =
  | { ok: true; action: Action; thoughts: string[]; confidence: number }
  | { ok: false; reason: MoveRejection; detail: string };

/**
 * Validate an agent-written move against the authoritative state.
 *
 * The app — not the agent — is the referee. A move is rejected unless it is for
 * the seat the agent actually controls, for the current turn, and legal by the
 * pure reducer's own judgement.
 */
export function validateMove(
  state: GameState,
  agentSeats: AgentSeat[],
  expectedTurn: number,
  raw: unknown,
  applyReducer: (s: GameState, a: Action) => GameState,
): MoveResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'malformed', detail: 'moves.json is not an object' };
  }
  const m = raw as Partial<MovePayload>;
  if (typeof m.seat !== 'number' || (m.action !== 'FIRE' && m.action !== 'USE_ITEM')) {
    return { ok: false, reason: 'malformed', detail: 'missing or invalid seat/action' };
  }
  if (state.phase !== 'turn') {
    return { ok: false, reason: 'not-agent-turn', detail: `phase is ${state.phase}` };
  }
  if (!agentSeats.some((s) => s.seat === m.seat)) {
    return { ok: false, reason: 'wrong-seat', detail: `seat ${m.seat} is not an agent seat` };
  }
  if (state.activePlayerId !== m.seat) {
    return {
      ok: false,
      reason: 'wrong-seat',
      detail: `seat ${m.seat} moved, but it is seat ${state.activePlayerId}'s turn`,
    };
  }
  if (typeof m.turn === 'number' && m.turn !== expectedTurn) {
    return {
      ok: false,
      reason: 'stale-turn',
      detail: `move is for turn ${m.turn}, current turn is ${expectedTurn}`,
    };
  }

  const action: Action =
    m.action === 'FIRE'
      ? { type: 'FIRE', targetId: m.target ?? m.seat, targetId2: m.target2 }
      : { type: 'USE_ITEM', item: m.item as Item, targetId: m.target };

  if (m.action === 'USE_ITEM' && !m.item) {
    return { ok: false, reason: 'malformed', detail: 'USE_ITEM without an item' };
  }
  // The reducer is the arbiter: a no-op means the move was illegal.
  if (applyReducer(state, action) === state) {
    return {
      ok: false,
      reason: 'illegal-action',
      detail: `the rules reject ${JSON.stringify(action)}`,
    };
  }
  return {
    ok: true,
    action,
    thoughts: Array.isArray(m.thoughts) ? m.thoughts.filter((t) => typeof t === 'string') : [],
    confidence: typeof m.confidence === 'number' ? m.confidence : 0.5,
  };
}
