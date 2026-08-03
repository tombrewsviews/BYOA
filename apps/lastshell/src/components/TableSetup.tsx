import { useState } from 'react';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  MAX_HUMANS,
  MAX_AGENTS,
  MIN_HUMANS,
} from '../engine/reducer';
import type { SeatConfig, Tier } from '../engine/types';
import { TIER_LABEL } from './AgentThoughts';

const DEFAULT_NAMES = Array.from({ length: MAX_HUMANS }, (_, i) => `Player ${i + 1}`);
const AGENT_NAMES = ['UNIT-7', 'DEALER', 'GHOST'];
const TIERS: Tier[] = ['reckless', 'steady', 'sharp'];

const TIER_BLURB: Record<Tier, string> = {
  reckless: 'Barely counts. Acts on instinct.',
  steady: 'Counts shells. Plays the odds.',
  sharp: 'Counts, reads the table, times its items.',
};

export function TableSetup({
  prevNames,
  onStart,
}: {
  prevNames: string[];
  onStart: (seats: SeatConfig[]) => void;
}) {
  const [withAgents, setWithAgents] = useState(false);
  const [humans, setHumans] = useState(() =>
    Math.min(Math.max(prevNames.length || 2, MIN_PLAYERS), MAX_HUMANS),
  );
  const [agentCount, setAgentCount] = useState(1);
  const [tiers, setTiers] = useState<Tier[]>(['steady', 'steady', 'sharp']);
  const [names, setNames] = useState<string[]>(() =>
    DEFAULT_NAMES.map((d, i) => prevNames[i] ?? d),
  );

  const setName = (i: number, v: string) => setNames((ns) => ns.map((n, j) => (j === i ? v : n)));
  const setTier = (i: number, t: Tier) => setTiers((ts) => ts.map((x, j) => (j === i ? t : x)));

  const agents = withAgents ? agentCount : 0;
  // one human is enough only when agents fill the table to two seats
  const minHumans = agents > 0 ? MIN_HUMANS : MIN_PLAYERS;
  const humanCount = Math.max(humans, minHumans);
  const maxHumansNow = Math.min(MAX_HUMANS, MAX_PLAYERS - agents);
  const effectiveHumans = Math.min(humanCount, maxHumansNow);
  const total = effectiveHumans + agents;

  const humanOptions = Array.from(
    { length: maxHumansNow - minHumans + 1 },
    (_, i) => minHumans + i,
  );

  const start = () => {
    const seats: SeatConfig[] = [
      ...Array.from({ length: effectiveHumans }, (_, i) => ({
        name: names[i] ?? DEFAULT_NAMES[i],
        kind: 'human' as const,
      })),
      ...Array.from({ length: agents }, (_, i) => ({
        name: AGENT_NAMES[i] ?? `AGENT ${i + 1}`,
        kind: 'agent' as const,
        tier: tiers[i],
      })),
    ];
    onStart(seats);
  };

  return (
    <div className="setup">
      <h1 className="game-title">
        LAST<span className="title-shell">SHELL</span>
      </h1>
      <p className="tagline">One gun. Hidden shells. Nerve wins.</p>

      <div className="setup-panel">
        <p className="setup-lbl">WHO'S PLAYING</p>
        <div className="mode-row" role="radiogroup" aria-label="Game mode">
          <button
            role="radio"
            aria-checked={!withAgents}
            className={`mode-btn${!withAgents ? ' on' : ''}`}
            onClick={() => setWithAgents(false)}
          >
            PEOPLE ONLY
          </button>
          <button
            role="radio"
            aria-checked={withAgents}
            className={`mode-btn${withAgents ? ' on' : ''}`}
            onClick={() => setWithAgents(true)}
          >
            PEOPLE + AGENTS
          </button>
        </div>

        <p className="setup-lbl">
          PEOPLE AT THE TABLE
          <span className="lbl-note">{`max ${maxHumansNow}`}</span>
        </p>
        <div className="count-row wrap" role="radiogroup" aria-label="Number of people">
          {humanOptions.map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={effectiveHumans === n}
              className={`count-btn sm${effectiveHumans === n ? ' on' : ''}`}
              onClick={() => setHumans(n)}
            >
              {n}
            </button>
          ))}
        </div>

        {withAgents && (
          <>
            <p className="setup-lbl">
              AGENTS
              <span className="lbl-note">{`max ${MAX_AGENTS}`}</span>
            </p>
            <div className="count-row" role="radiogroup" aria-label="Number of agents">
              {Array.from({ length: MAX_AGENTS }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  role="radio"
                  aria-checked={agents === n}
                  className={`count-btn sm${agents === n ? ' on' : ''}`}
                  disabled={effectiveHumans + n > MAX_PLAYERS}
                  onClick={() => setAgentCount(n)}
                >
                  {n}
                </button>
              ))}
            </div>

            <div className="agent-list">
              {Array.from({ length: agents }, (_, i) => (
                <div key={i} className="agent-row">
                  <span className="agent-name">
                    <span className="agent-dot" aria-hidden="true" />
                    {AGENT_NAMES[i] ?? `AGENT ${i + 1}`}
                  </span>
                  <div className="tier-row" role="radiogroup" aria-label={`Difficulty for agent ${i + 1}`}>
                    {TIERS.map((t) => (
                      <button
                        key={t}
                        role="radio"
                        aria-checked={tiers[i] === t}
                        title={TIER_BLURB[t]}
                        className={`tier-btn t-${t}${tiers[i] === t ? ' on' : ''}`}
                        onClick={() => setTier(i, t)}
                      >
                        {TIER_LABEL[t]}
                      </button>
                    ))}
                  </div>
                  <p className="tier-blurb">{TIER_BLURB[tiers[i]]}</p>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="setup-lbl">NAMES</p>
        <div className="name-list">
          {Array.from({ length: effectiveHumans }, (_, i) => (
            <label key={i} className="name-row">
              <span className="seat-badge">{i + 1}</span>
              <input
                type="text"
                maxLength={14}
                value={names[i] ?? ''}
                placeholder={DEFAULT_NAMES[i]}
                onChange={(e) => setName(i, e.target.value)}
                aria-label={`Player ${i + 1} name`}
              />
            </label>
          ))}
        </div>

        <button className="btn-big" onClick={start}>
          TAKE YOUR SEATS
          <span className="seat-total">{total} AT THE TABLE</span>
        </button>
      </div>

      <p className="setup-rules">
        3 lives each · shooting yourself always passes the gun on · self-shots earn items — unless
        you peeked · last one alive wins
      </p>
      <p className="setup-rules dim">
        Agents play through the terminal on the right — they read the table, not the shells.
      </p>
    </div>
  );
}
