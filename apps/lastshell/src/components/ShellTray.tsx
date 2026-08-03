import type { Shell } from '../engine/types';

export function Casing({
  shell,
  facedown,
  flip,
}: {
  shell?: Shell;
  facedown?: boolean;
  flip?: boolean;
}) {
  const cls = facedown ? 'casing down' : shell === 'live' ? 'casing spent-live' : 'casing spent-blank';
  return (
    <div className={`${cls}${flip ? ' flip' : ''}`}>
      <span className="casing-cap" />
      {!facedown && <span className="casing-lbl">{shell === 'live' ? 'LIVE' : 'BLANK'}</span>}
      <span className="casing-rim" />
    </div>
  );
}

export function ShellTray({ remaining, spent }: { remaining: number; spent: Shell[] }) {
  return (
    <div className="tray" aria-label={`${remaining} shells remaining, ${spent.length} spent`}>
      <div className="tray-row">
        <span className="tray-lbl">CHAMBER · {remaining}</span>
        <div className="tray-shells">
          {Array.from({ length: remaining }, (_, i) => (
            <Casing key={i} facedown />
          ))}
          {remaining === 0 && <span className="tray-empty">empty</span>}
        </div>
      </div>
      <div className="tray-row">
        <span className="tray-lbl">SPENT · {spent.length}</span>
        <div className="tray-shells">
          {spent.map((s, i) => (
            <Casing key={i} shell={s} flip={i === spent.length - 1} />
          ))}
          {spent.length === 0 && <span className="tray-empty">—</span>}
        </div>
      </div>
    </div>
  );
}
