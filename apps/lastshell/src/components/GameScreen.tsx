import { useEffect, useState, type Dispatch } from 'react';
import type { Action, GameState, Item } from '../engine/types';
import { sfx } from '../audio/sfx';
import type { AgentDecision } from '../engine/agent/brain';
import { PlayerCard } from './PlayerCard';
import { ShellTray } from './ShellTray';
import { AgentThoughts } from './AgentThoughts';
import { PeekModal, RoundIntro, VictoryOverlay } from './modals';
import { ShotgunIcon } from './icons';

const RESOLVE_MS = { live: 1150, blank: 750 };

/** Agent reasoning surfaced by the file-protocol bridge (see agent/protocol). */
export interface AgentActivityView {
  seat: number;
  name: string;
  tier: 'reckless' | 'steady' | 'sharp';
  thoughts: string[];
  confidence: number;
  source: 'agent' | 'fallback';
}

interface Fx {
  id: number;
  k: number;
}

interface Stamp {
  icon: string;
  text: string;
  k: number;
}

export function GameScreen({
  state,
  dispatch,
  agentActivity,
}: {
  state: GameState;
  dispatch: Dispatch<Action>;
  agentActivity?: AgentActivityView | null;
}) {
  const [targetId, setTargetId] = useState<number | null>(null);
  const [peekOpen, setPeekOpen] = useState(false);
  const [cuffMode, setCuffMode] = useState(false);
  const [healFx, setHealFx] = useState<Fx | null>(null);
  const [cuffFx, setCuffFx] = useState<Fx | null>(null);
  const [stamp, setStamp] = useState<Stamp | null>(null);
  const [introVisible, setIntroVisible] = useState(true);

  const active = state.players.find((p) => p.id === state.activePlayerId);
  const isTurn = state.phase === 'turn';
  const resolvingShell = state.phase === 'resolving' ? state.pendingShot?.shell : undefined;
  // On an agent's turn the table watches: input is inert and the reasoning
  // panel (fed by the file-protocol bridge) replaces the fire dock.
  const activeIsAgent = isTurn && active?.kind === 'agent';

  const pushStamp = (icon: string, text: string) =>
    setStamp((s) => ({ icon, text, k: (s?.k ?? 0) + 1 }));

  // Clear local selection whenever the turn moves on or a shot starts
  useEffect(() => {
    setTargetId(null);
    setPeekOpen(false);
    setCuffMode(false);
  }, [state.activePlayerId, state.phase === 'turn']);

  // §10.9: the shot animation drives resolution; input is locked while resolving
  useEffect(() => {
    if (state.phase !== 'resolving' || !state.pendingShot) return;
    const live = state.pendingShot.shell === 'live';
    if (live) sfx.shot();
    else sfx.click();
    const t = setTimeout(
      () => dispatch({ type: 'RESOLVE_SHOT' }),
      RESOLVE_MS[live ? 'live' : 'blank'],
    );
    return () => clearTimeout(t);
  }, [state.phase, state.pendingShot, dispatch]);

  // Post-resolution stings
  useEffect(() => {
    if (!state.lastShot) return;
    if (state.lastShot.eliminatedId != null) sfx.elimination();
    else if (state.lastShot.itemGained) sfx.pickup();
    if (state.lastShot.cuffSkippedIds.length > 0) {
      sfx.cuff();
      pushStamp('⛓️', 'CUFFED — TURN SKIPPED');
    }
  }, [state.lastShot]);

  useEffect(() => {
    if (state.phase === 'gameOver') sfx.victory();
  }, [state.phase]);

  // A round that ends on a shot carries its feedback (final tray reveal, floats,
  // chips, death pulse) into the roundIntro phase — hold the overlay back so
  // those beats play before the intro covers the table.
  useEffect(() => {
    if (state.phase !== 'roundIntro') return;
    if (!state.lastShot) {
      setIntroVisible(true);
      return;
    }
    setIntroVisible(false);
    const t = setTimeout(() => setIntroVisible(true), 1400);
    return () => clearTimeout(t);
  }, [state.phase, state.round]);

  const selectTarget = (id: number) => {
    if (!isTurn) return;
    if (cuffMode) {
      const t = state.players.find((p) => p.id === id);
      if (!t || !t.alive || t.id === state.activePlayerId || t.cuffedBy !== null) return;
      sfx.cuff();
      setCuffFx((f) => ({ id, k: (f?.k ?? 0) + 1 }));
      pushStamp('⛓️', `${t.name.toUpperCase()} CUFFED`);
      dispatch({ type: 'USE_ITEM', item: 'cuffs', targetId: id });
      setCuffMode(false);
      return;
    }
    setTargetId((cur) => (cur === id ? null : id));
  };

  const fire = () => {
    if (targetId == null || !isTurn) return;
    dispatch({ type: 'FIRE', targetId });
    setTargetId(null);
  };

  const useItem = (item: Item) => {
    if (!isTurn) return;
    if (item === 'cuffs') {
      setCuffMode(true);
      setTargetId(null);
      return;
    }
    if (item === 'glass') {
      sfx.peek();
      setPeekOpen(true);
    } else if (item === 'saw') {
      sfx.saw();
      pushStamp('🪚', 'SAWED OFF — 2 DMG');
    } else {
      sfx.heal();
      pushStamp('❤️', '+1 LIFE');
      setHealFx((f) => ({ id: state.activePlayerId, k: (f?.k ?? 0) + 1 }));
    }
    dispatch({ type: 'USE_ITEM', item });
  };

  // Seat 1 anchors the bottom row (the local player's side of the table); the
  // opposite seats face them across the top, and any remainder fills in beside
  // seat 1. Up to 6 seats that's two rows — 2→1/1, 3→2/1, 4→2/2, 5→3/2, 6→3/3.
  // Past 6 a third band splits the middle so no row exceeds 4 cards, which is
  // the most that stays legible on a phone.
  const n = state.players.length;
  const twoRow = n <= 6;
  const rest = state.players.slice(1); // everyone but seat 1, clockwise
  const cut1 = twoRow ? Math.min(n - 1, Math.ceil(n / 2)) : Math.ceil(rest.length / 3);
  const cut2 = twoRow ? cut1 : Math.ceil((rest.length * 2) / 3);
  const top = rest.slice(0, cut1);
  const mid = rest.slice(cut1, cut2);
  const bottom = [state.players[0], ...rest.slice(cut2)];

  const targetName =
    targetId != null ? state.players.find((p) => p.id === targetId)?.name : undefined;

  const cuffTargetAvailable = state.players.some(
    (p) => p.alive && p.id !== state.activePlayerId && p.cuffedBy === null,
  );

  const renderCard = (p: (typeof state.players)[number]) => (
    <PlayerCard
      key={p.id}
      player={p}
      isActive={p.id === state.activePlayerId && state.phase !== 'gameOver'}
      isTarget={targetId === p.id}
      // an agent's turn is not interactive — the table watches it play
      canTarget={isTurn && !activeIsAgent && p.alive}
      cuffMode={cuffMode}
      cuffTargetAvailable={cuffTargetAvailable}
      canUseItems={isTurn && !activeIsAgent && p.id === state.activePlayerId}
      sawActive={state.sawActive}
      lastShot={state.lastShot}
      shotKey={state.spentShells.length}
      healFx={healFx}
      cuffFx={cuffFx}
      onSelect={selectTarget}
      onUseItem={useItem}
    />
  );

  return (
    <div className={`game${resolvingShell === 'live' ? ' shake' : ''}`}>
      {resolvingShell === 'live' && (
        <>
          <div className="blood-flash" aria-hidden="true" />
          <div className="muzzle-flash" aria-hidden="true" />
          <div className="shockwave" aria-hidden="true" />
          <div className="hit-vignette" aria-hidden="true" />
        </>
      )}
      {resolvingShell === 'blank' && (
        <div className="click-puff" aria-hidden="true">
          <span className="click-ring" />
          click
        </div>
      )}
      {state.lastShot?.eliminatedId != null && (
        <div key={`d${state.spentShells.length}`} className="death-pulse" aria-hidden="true" />
      )}
      {stamp && (
        <div key={stamp.k} className="stamp" aria-hidden="true">
          <span className="stamp-icon">{stamp.icon}</span>
          {stamp.text}
        </div>
      )}

      <header className="hud">
        <span className="hud-title">LAST SHELL</span>
        <span className="hud-round">ROUND {state.round}</span>
      </header>

      <div className={`table${twoRow ? '' : ' crowded'}`}>
        <div className={`prow top n${top.length}`}>{top.map(renderCard)}</div>

        {mid.length > 0 && <div className={`prow mid n${mid.length}`}>{mid.map(renderCard)}</div>}

        <div className="center">
          <div className="status">
            {active && state.phase !== 'gameOver' && (
              <span className="status-turn">
                <span className="status-gun">
                  <ShotgunIcon />
                </span>
                {active.name}
                {state.sawActive && <span className="saw-chip">🪚 SAWED-OFF · 2 DMG</span>}
              </span>
            )}
          </div>

          <ShellTray remaining={state.shellQueue.length} spent={state.spentShells} />

          <div className="fire-dock">
            {activeIsAgent && agentActivity ? (
              <AgentThoughts
                name={agentActivity.name}
                tier={agentActivity.tier}
                decision={
                  {
                    thoughts: agentActivity.thoughts,
                    confidence: agentActivity.confidence,
                  } as AgentDecision
                }
                k={agentActivity.thoughts.length}
              />
            ) : cuffMode ? (
              <div className="cuff-dock">
                <p className="fire-hint">⛓️ Tap a player to cuff — their next turn bounces back to you</p>
                <button className="btn-big subtle small" onClick={() => setCuffMode(false)}>
                  CANCEL
                </button>
              </div>
            ) : isTurn && targetId != null ? (
              <button className="fire-btn" onClick={fire}>
                FIRE AT {targetId === state.activePlayerId ? 'YOURSELF' : targetName?.toUpperCase()}
              </button>
            ) : (
              <p className="fire-hint">
                {isTurn
                  ? `${active?.name}: tap a player to aim — including yourself`
                  : state.phase === 'resolving'
                    ? '…'
                    : ''}
              </p>
            )}
          </div>
        </div>

        <div className={`prow bottom n${bottom.length}`}>{bottom.map(renderCard)}</div>
      </div>

      {state.phase === 'roundIntro' && introVisible && (
        <RoundIntro state={state} onBegin={() => dispatch({ type: 'BEGIN_ROUND' })} />
      )}
      {peekOpen && state.peekedShell && (
        <PeekModal state={state} onHide={() => setPeekOpen(false)} />
      )}
      {state.phase === 'gameOver' && (
        <VictoryOverlay state={state} onRestart={() => dispatch({ type: 'RESTART' })} />
      )}
    </div>
  );
}
