import type { AgentDecision } from '../engine/agent/brain';
import type { Tier } from '../engine/types';

export const TIER_LABEL: Record<Tier, string> = {
  reckless: 'RECKLESS',
  steady: 'STEADY',
  sharp: 'SHARP',
};

/**
 * Shows an agent's reasoning while it "thinks", so the humans at the table can
 * follow — and disagree with — why it played the way it did.
 */
export function AgentThoughts({
  name,
  tier,
  decision,
  k,
}: {
  name: string;
  tier: Tier;
  decision: AgentDecision;
  k: number;
}) {
  return (
    <div className="thoughts" key={k} aria-live="polite">
      <div className="thoughts-head">
        <span className="thoughts-who">
          <span className="agent-dot" aria-hidden="true" />
          {name}
        </span>
        <span className={`tier-chip t-${tier}`}>{TIER_LABEL[tier]}</span>
      </div>

      <ul className="thoughts-list">
        {decision.thoughts.map((t, i) => (
          <li key={i} style={{ animationDelay: `${i * 190}ms` }}>
            {t}
          </li>
        ))}
      </ul>

      <div className="thoughts-foot">
        <span className="conf-label">CONVICTION</span>
        <span className="conf-bar" aria-hidden="true">
          <span className="conf-fill" style={{ width: `${Math.round(decision.confidence * 100)}%` }} />
        </span>
        <span className="conf-val">{Math.round(decision.confidence * 100)}%</span>
      </div>
    </div>
  );
}
