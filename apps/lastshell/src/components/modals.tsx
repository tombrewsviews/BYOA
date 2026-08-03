import { useEffect } from 'react';
import type { GameState } from '../engine/types';
import { sfx } from '../audio/sfx';
import { Casing } from './ShellTray';

export function RoundIntro({ state, onBegin }: { state: GameState; onBegin: () => void }) {
  const { live, blank } = state.roundComposition;
  const active = state.players.find((p) => p.id === state.activePlayerId);
  const skipped = (state.lastShot?.cuffSkippedIds ?? [])
    .map((id) => state.players.find((p) => p.id === id)?.name)
    .filter(Boolean);

  useEffect(() => {
    const ids = Array.from({ length: live + blank }, (_, i) =>
      setTimeout(() => sfx.loadTick(), 200 + i * 110),
    );
    return () => ids.forEach(clearTimeout);
  }, [live, blank]);

  return (
    <div className="overlay">
      <div className="modal intro">
        <p className="modal-kicker">ROUND {state.round}</p>
        <h2 className="modal-title">LOADING</h2>
        <p className="intro-comp">
          {live} LIVE / {blank} BLANK
        </p>
        <div className="intro-pips">
          <div className="pip-group">
            {Array.from({ length: live }, (_, i) => (
              <Casing key={i} shell="live" />
            ))}
          </div>
          <div className="pip-group">
            {Array.from({ length: blank }, (_, i) => (
              <Casing key={i} shell="blank" />
            ))}
          </div>
        </div>
        <p className="modal-hint">Shuffled and loaded — order unknown.</p>
        {skipped.length > 0 && (
          <p className="modal-hint">⛓️ {skipped.join(' & ')} cuffed — turn bounced back.</p>
        )}
        <button
          className="btn-big"
          onClick={() => {
            sfx.pump();
            onBegin();
          }}
        >
          RACK IT
        </button>
        {active && <p className="modal-hint">{active.name} holds the gun.</p>}
      </div>
    </div>
  );
}

export function PeekModal({ state, onHide }: { state: GameState; onHide: () => void }) {
  if (!state.peekedShell) return null;
  const isLive = state.peekedShell === 'live';
  return (
    <div className="overlay peek-overlay">
      <div className="modal peek">
        <p className="modal-kicker">🔍 FOR YOUR EYES ONLY</p>
        <h2 className="modal-title">NEXT CHAMBER</h2>
        <div className="peek-shell">
          <Casing shell={state.peekedShell} flip />
        </div>
        <p className={`peek-verdict ${isLive ? 'live' : 'blank'}`}>{isLive ? 'LIVE' : 'BLANK'}</p>
        <button className="btn-big subtle" onClick={onHide}>
          HIDE
        </button>
      </div>
    </div>
  );
}

export function VictoryOverlay({ state, onRestart }: { state: GameState; onRestart: () => void }) {
  const winner = state.players.find((p) => p.id === state.winnerId);
  return (
    <div className="overlay">
      <div className="modal victory">
        <p className="modal-kicker">LAST SHELL</p>
        <h2 className="modal-title winner-name">{winner ? winner.name : 'NOBODY'}</h2>
        <p className="victory-sub">walks away from the table</p>
        <button className="btn-big" onClick={onRestart}>
          PLAY AGAIN
        </button>
      </div>
    </div>
  );
}
