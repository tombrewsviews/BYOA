/**
 * Sidebar panel above the terminal: who is seated, what the agent is thinking
 * right now, and a short protocol log so a rejected move is visible rather than
 * silent.
 */
import type { AgentSeat } from '../agent/protocol';
import type { AgentActivity } from '../agent/useAgentBridge';
import { TIER_LABEL } from './AgentThoughts';

export function AgentDock({
  seats,
  activity,
  project,
  log,
}: {
  seats: AgentSeat[];
  activity: AgentActivity | null;
  project: string | null;
  log: string[];
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
          </li>
        ))}
      </ul>

      {activity && (
        <div className="dock-think">
          <p className="dock-think-head">
            {activity.name} · {activity.source === 'fallback' ? 'LOCAL' : 'THINKING'}
          </p>
          {activity.thoughts.length === 0 ? (
            <p className="dock-wait">waiting for the agent…</p>
          ) : (
            <ul className="thoughts-list">
              {activity.thoughts.map((t, i) => (
                <li key={i} style={{ animationDelay: `${i * 160}ms` }}>
                  {t}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {project && (
        <p className="dock-path" title={project}>
          {project.replace(/^.*\//, '')}/.lastshell
        </p>
      )}

      {log.length > 0 && (
        <ul className="dock-log">
          {log.slice(-5).map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
