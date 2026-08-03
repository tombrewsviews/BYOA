/**
 * Sidebar panel above the terminal: who is seated, and whose turn it is.
 *
 * Deliberately minimal — the terminal below shows what the agent is actually
 * doing, so a duplicate move log and project path here were just noise.
 */
import type { AgentSeat } from '../agent/protocol';
import type { AgentActivity } from '../agent/useAgentBridge';
import { TIER_LABEL } from './AgentThoughts';

export function AgentDock({
  seats,
  activity,
  activeSeat,
  onForcePlay,
}: {
  seats: AgentSeat[];
  activity: AgentActivity | null;
  /** seat holding the gun right now, or null when it isn't an agent's turn */
  activeSeat: number | null;
  /** take this seat's turn immediately with the local brain */
  onForcePlay: (seat: number) => void;
}) {
  if (seats.length === 0) {
    return (
      <div className="dock">
        <p className="dock-empty">
          No agents seated. Start a table with agents to have one play alongside you.
        </p>
      </div>
    );
  }

  return (
    <div className="dock">
      <ul className="dock-seats">
        {seats.map((s) => (
          <li key={s.seat} className={`dock-seat${activity?.seat === s.seat ? ' on' : ''}`}>
            <span className="agent-dot" aria-hidden="true" />
            <span className="dock-name">{s.name}</span>
            <span className={`tier-chip t-${s.tier}`}>{TIER_LABEL[s.tier]}</span>
            {/* Force the turn when the CLI is slow or wedged, instead of waiting
                out the timeout. Only live on the seat that holds the gun. */}
            <button
              className="dock-play"
              onClick={() => onForcePlay(s.seat)}
              disabled={activeSeat !== s.seat}
              title={
                activeSeat === s.seat
                  ? `Play ${s.name}'s turn now`
                  : `${s.name} does not hold the gun`
              }
            >
              PLAY
            </button>
          </li>
        ))}
      </ul>

      {/* Reasoning is deliberately not rendered — agents play fast and write no
          thoughts. A single status line is all the table needs. */}
      {activity && (
        <div className="dock-think">
          <p className="dock-think-head">
            {activity.name} · {activity.source === 'fallback' ? 'LOCAL' : 'PLAYING'}
          </p>
        </div>
      )}

      {/* The project path and the move log used to sit here. Both were debug
          output competing with the terminal directly below, which shows the same
          moves in context. */}
    </div>
  );
}
