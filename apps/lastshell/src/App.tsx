/**
 * LAST SHELL — DreamStore app shell.
 *
 * Layout follows the DreamStore pattern: the app on the left, the agent's
 * terminal pinned on the right. The game is the document; the agent plays it by
 * editing files (see agent/protocol.ts), and you watch it reason in the panel.
 */
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { initialState, reducer, MAX_AGENTS } from './engine/reducer';
import type { SeatConfig, Tier } from './engine/types';
import { initAudio, isAudioRunning, isMuted, setMuted } from './audio/sfx';
import { GameScreen } from './components/GameScreen';
import { TableSetup } from './components/TableSetup';
import { Terminal } from './terminal';
import { AgentDock } from './components/AgentDock';
import { TitleBar } from './components/TitleBar';
import { useAgentBridge } from './agent/useAgentBridge';
import { kickoffPrompt } from './agent/kickoff';
import type { AgentSeat } from './agent/protocol';
import { isTauri } from './runtime';

const AGENT_NAMES = ['UNIT-7', 'DEALER', 'GHOST'];

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [muted, setMutedState] = useState(isMuted);
  const [agentSeats, setAgentSeats] = useState<AgentSeat[]>([]);
  /**
   * The terminal session's inputs, kept in ONE state object. The PTY effect keys
   * off this, so a spawn happens exactly once per table — two separate useStates
   * could tear across renders and respawn the agent process.
   */
  const [session, setSession] = useState<{
    project: string | null;
    cli: string;
    kickoff: string | null;
  }>({ project: null, cli: 'claude', kickoff: null });
  const project = session.project;
  const [termOpen, setTermOpen] = useState(true);

  // Mobile/desktop autoplay policy: unlock audio on the first real gesture.
  useEffect(() => {
    const remove = () => {
      window.removeEventListener('pointerup', unlock);
      window.removeEventListener('keydown', unlock);
    };
    const unlock = () => {
      initAudio();
      if (isAudioRunning()) remove();
    };
    window.addEventListener('pointerup', unlock);
    window.addEventListener('keydown', unlock);
    return remove;
  }, []);

  const { activity, log, forcePlay, isAgentTurn } = useAgentBridge({
    state,
    dispatch,
    project,
    agentSeats,
    enabled: agentSeats.length > 0,
  });

  const start = useCallback(async (seats: SeatConfig[], cli: string) => {
    const agents: AgentSeat[] = seats
      .map((s, i) => ({ seat: i + 1, cfg: s }))
      .filter(({ cfg }) => cfg.kind === 'agent')
      .slice(0, MAX_AGENTS)
      .map(({ seat, cfg }, i) => ({
        seat,
        name: cfg.name || AGENT_NAMES[i] || `AGENT ${i + 1}`,
        tier: (cfg.tier ?? 'steady') as Tier,
      }));
    setAgentSeats(agents);

    // Provision the project so the agent has somewhere to read/write and a
    // skill to read. Desktop only — in the browser the heuristic plays instead.
    if (isTauri() && agents.length > 0) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const path = await invoke<string>('game_ensure_project', {
          name: `table-${new Date().toISOString().slice(0, 10)}`,
        });
        await invoke('skill_install', { project: path });
        await invoke('game_watch', { project: path });
        // One atomic update: project + cli + the opening instruction that makes
        // the table start playing itself.
        setSession({ project: path, cli, kickoff: kickoffPrompt(agents) });
      } catch {
        // Fall through: without a project the bridge uses the heuristic.
        setSession({ project: null, cli, kickoff: null });
      }
    }
    dispatch({ type: 'START_GAME', seats });
  }, []);

  /**
   * Back to the setup screen, names kept. Agent seats are cleared with it —
   * leaving them would keep the file bridge publishing turns for a table that no
   * longer exists. The PTY stays up so the agent CLI survives into the next game.
   */
  const restart = useCallback(() => {
    setAgentSeats([]);
    dispatch({ type: 'RESTART' });
  }, []);

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    setMutedState(m);
  };

  const seatedAgents = useMemo(
    () => state.players.filter((p) => p.kind === 'agent').length,
    [state.players],
  );

  return (
    <div className={`app-frame${termOpen ? '' : ' term-collapsed'}`}>
      <TitleBar
        round={state.phase === 'setup' ? null : state.round}
        muted={muted}
        onToggleMute={toggleMute}
        onRestart={state.phase === 'setup' ? undefined : restart}
      />
      <div className="shell">
      <main className="shell-main">
        {state.phase === 'setup' ? (
          <TableSetup prevNames={state.players.map((p) => p.name)} onStart={start} />
        ) : (
          <GameScreen state={state} dispatch={dispatch} agentActivity={activity} />
        )}
      </main>

      <aside className="shell-side" aria-label="Agent terminal">
        <header className="side-head">
          <span className="side-title">AGENT</span>
          <span className="side-sub">
            {seatedAgents > 0 ? `${seatedAgents} seat${seatedAgents > 1 ? 's' : ''}` : 'none seated'}
          </span>
          <button
            className="side-toggle"
            onClick={() => setTermOpen((v) => !v)}
            aria-label={termOpen ? 'Collapse terminal' : 'Expand terminal'}
          >
            {termOpen ? '▸' : '◂'}
          </button>
        </header>
        <AgentDock
          seats={agentSeats}
          activity={activity}
          project={project}
          log={log}
          activeSeat={isAgentTurn ? state.activePlayerId : null}
          onForcePlay={forcePlay}
        />
        <div className="side-term">
          <Terminal project={session.project} agent={session.cli} kickoff={session.kickoff} />
        </div>
      </aside>
      </div>
    </div>
  );
}
