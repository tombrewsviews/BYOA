import { useEffect, useState } from 'react';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  MAX_HUMANS,
  MAX_AGENTS,
  MIN_HUMANS,
} from '../engine/reducer';
import type { SeatConfig, Tier } from '../engine/types';
import { TIER_LABEL } from './AgentThoughts';
import type { AgentCli } from '../agent/kickoff';
import { isTauri } from '../runtime';

const DEFAULT_NAMES = Array.from({ length: MAX_HUMANS }, (_, i) => `Player ${i + 1}`);
const AGENT_NAMES = ['UNIT-7', 'DEALER', 'GHOST'];
const TIERS: Tier[] = ['reckless', 'steady', 'sharp'];

const TIER_BLURB: Record<Tier, string> = {
  reckless: 'Barely counts. Acts on instinct.',
  steady: 'Counts shells. Plays the odds.',
  sharp: 'Counts, reads the table, times its items.',
};

export function TableSetup({
  prevSeats,
  onStart,
}: {
  /**
   * The seats from the game just played, so a restart comes back to the same
   * table. Carries `kind` and `tier` — passing bare names would restore every
   * agent as a human, which is exactly the bug this replaced.
   */
  prevSeats: SeatConfig[];
  onStart: (seats: SeatConfig[], agentCli: string) => void;
}) {
  const prevHumans = prevSeats.filter((s) => s.kind === 'human');
  const prevAgents = prevSeats.filter((s) => s.kind === 'agent');

  const [clis, setClis] = useState<AgentCli[]>([]);
  const [cli, setCli] = useState('claude');
  const [withAgents, setWithAgents] = useState(prevAgents.length > 0);
  const [humans, setHumans] = useState(() => {
    // A single human is legal when agents fill the table, so don't floor at
    // MIN_PLAYERS here — that turned a restored 1-human/3-agent table into 5
    // seats. The `minHumans` clamp below applies the real rule.
    const floor = prevAgents.length > 0 ? MIN_HUMANS : MIN_PLAYERS;
    return Math.min(Math.max(prevHumans.length || floor, floor), MAX_HUMANS);
  });
  const [agentCount, setAgentCount] = useState(() =>
    Math.min(Math.max(prevAgents.length, 1), MAX_AGENTS),
  );
  const [tiers, setTiers] = useState<Tier[]>(() =>
    // keep each returning agent's tier; pad with the defaults beyond that
    ['steady', 'steady', 'sharp'].map((d, i) => prevAgents[i]?.tier ?? (d as Tier)),
  );
  // Only the HUMAN names go in these fields — agent names are fixed per seat.
  const [names, setNames] = useState<string[]>(() =>
    DEFAULT_NAMES.map((d, i) => prevHumans[i]?.name ?? d),
  );

  // Which agent CLIs are on $PATH — the picker greys out the rest.
  useEffect(() => {
    if (!isTauri()) return;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const found = await invoke<AgentCli[]>('detect_agents');
        setClis(found);
        // default to the first installed one, preferring Claude Code
        const best = found.find((c) => c.id === 'claude' && c.installed) ?? found.find((c) => c.installed);
        if (best) setCli(best.id);
      } catch {
        /* browser dev or detection failed — the picker just stays empty */
      }
    })();
  }, []);

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
        // a returning agent keeps the name it played under
        name: prevAgents[i]?.name ?? AGENT_NAMES[i] ?? `AGENT ${i + 1}`,
        kind: 'agent' as const,
        tier: tiers[i],
      })),
    ];
    onStart(seats, cli);
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

            <p className="setup-lbl">AGENT RUNTIME</p>
            <div className="cli-row" role="radiogroup" aria-label="Agent CLI">
              {(clis.length > 0
                ? clis
                : [
                    { id: 'claude', label: 'Claude Code', installed: true, binary: 'claude', installHint: '', path: null },
                  ]
              ).map((c) => (
                <button
                  key={c.id}
                  role="radio"
                  aria-checked={cli === c.id}
                  disabled={!c.installed}
                  title={c.installed ? `${c.binary} on $PATH` : `Not installed — ${c.installHint}`}
                  className={`cli-btn${cli === c.id ? ' on' : ''}`}
                  onClick={() => setCli(c.id)}
                >
                  {c.label}
                  {!c.installed && <span className="cli-missing">not installed</span>}
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
