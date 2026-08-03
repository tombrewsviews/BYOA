import type { Item, Player, ShotResult } from '../engine/types';
import { START_LIVES, MAX_ITEMS } from '../engine/reducer';
import { HeartIcon, ShotgunIcon, SkullIcon, ITEM_ICONS, ITEM_NAMES } from './icons';

interface Fx {
  id: number;
  k: number;
}

interface Props {
  player: Player;
  isActive: boolean;
  isTarget: boolean;
  canTarget: boolean;
  cuffMode: boolean;
  cuffTargetAvailable: boolean;
  /** a split shell is already loaded — it does not stack */
  splitActive: boolean;
  /** live players other than this one, for the split's minimum-target rule */
  liveOpponents: number;
  /** this player's share of the last golden bullet, if it hit them */
  goldenHit: { livesLost: number; k: number } | null;
  canUseItems: boolean;
  sawActive: boolean;
  lastShot: ShotResult | null;
  shotKey: number;
  healFx: Fx | null;
  cuffFx: Fx | null;
  onSelect: (id: number) => void;
  onUseItem: (item: Item) => void;
}

export function PlayerCard({
  player: p,
  isActive,
  isTarget,
  canTarget,
  cuffMode,
  cuffTargetAvailable,
  splitActive,
  liveOpponents,
  goldenHit,
  canUseItems,
  sawActive,
  lastShot,
  shotKey,
  healFx,
  cuffFx,
  onSelect,
  onUseItem,
}: Props) {
  const cuffable = cuffMode && canTarget && !isActive && p.cuffedBy === null;
  // in cuff mode only eligible targets stay interactive; otherwise normal targeting
  const selectable = cuffMode ? cuffable : canTarget;
  const classes = [
    'pcard',
    isActive && 'active',
    isTarget && 'targeted',
    canTarget && 'targetable',
    cuffMode && (cuffable ? 'cuffable' : 'cuff-dimmed'),
    !p.alive && 'eliminated',
  ]
    .filter(Boolean)
    .join(' ');

  const itemDisabled = (item: Item): boolean =>
    (item === 'saw' && sawActive) ||
    (item === 'life' && p.lives >= START_LIVES) ||
    (item === 'cuffs' && !cuffTargetAvailable) ||
    // mirrors the reducer: no stacking, and two other live players to split between
    (item === 'split' && (splitActive || liveOpponents < 2));

  const itemLabel = (item: Item): string => {
    if (!itemDisabled(item)) {
      if (item === 'golden') return `Use golden bullet — 2 lives off everyone else`;
      if (item === 'split') return 'Use split shell — next shot hits two players';
      return `Use ${ITEM_NAMES[item]}`;
    }
    if (item === 'saw') return 'Saw already active';
    if (item === 'life') return 'Lives already full';
    if (item === 'split') return splitActive ? 'Split shell already loaded' : 'Needs two other players';
    return 'No one to cuff';
  };

  return (
    <div
      className={classes}
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
      aria-label={selectable ? (cuffMode ? `Cuff ${p.name}` : `Target ${p.name}`) : p.name}
      onClick={selectable ? () => onSelect(p.id) : undefined}
      onKeyDown={
        selectable
          ? (e) => {
              if (e.target !== e.currentTarget) return; // don't hijack nested item buttons
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(p.id);
              }
            }
          : undefined
      }
    >
      {isActive && p.alive && (
        <div className="gun-badge" aria-label="Holding the shotgun">
          <ShotgunIcon />
        </div>
      )}

      <div className="pcard-head">
        <span className="seat-badge">{p.id}</span>
        <span className="pcard-name">
          {p.kind === 'agent' && <span className="agent-dot" aria-label="Agent" />}
          {p.name}
        </span>
        {p.alive && p.cuffedBy !== null && (
          <span className="cuff-chip" title="Cuffed — next turn bounces back">
            ⛓️
          </span>
        )}
        {!p.alive && (
          <span className="skull">
            <SkullIcon />
          </span>
        )}
      </div>

      <div className="hearts" aria-label={`${p.lives} of ${START_LIVES} lives`}>
        {Array.from({ length: START_LIVES }, (_, i) => (
          <HeartIcon key={i} filled={i < p.lives} />
        ))}
      </div>

      <div className="slots">
        {Array.from({ length: MAX_ITEMS }, (_, i) => {
          const item = p.items[i];
          if (!item) return <span key={i} className="slot empty" />;
          if (canUseItems) {
            const disabled = itemDisabled(item);
            return (
              <button
                key={i}
                className="slot item-btn"
                disabled={disabled}
                title={itemLabel(item)}
                aria-label={itemLabel(item)}
                onClick={(e) => {
                  e.stopPropagation();
                  onUseItem(item);
                }}
              >
                {ITEM_ICONS[item]}
              </button>
            );
          }
          return (
            <span key={i} className="slot filled" title={ITEM_NAMES[item]} aria-label={ITEM_NAMES[item]}>
              {ITEM_ICONS[item]}
            </span>
          );
        })}
      </div>

      {/* Both split targets take the hit, so check targetId2 too — otherwise the
          second victim loses a life with no feedback at all. */}
      {lastShot &&
        (lastShot.targetId === p.id || lastShot.targetId2 === p.id) &&
        lastShot.damage > 0 && (
          <span key={shotKey} className="dmg-float" aria-hidden="true">
            −{lastShot.damage}
          </span>
        )}
      {/* A golden bullet is not a shot, so it carries its own float. */}
      {goldenHit && goldenHit.livesLost > 0 && (
        <span key={`gb${goldenHit.k}`} className="dmg-float golden" aria-hidden="true">
          −{goldenHit.livesLost}
        </span>
      )}
      {lastShot?.goldenEarned && lastShot.shooterId === p.id && (
        <span key={`ge${shotKey}`} className="full-chip golden" aria-hidden="true">
          🥇 GOLDEN BULLET
        </span>
      )}
      {lastShot && lastShot.shooterId === p.id && lastShot.itemGained && (
        <span key={`g${shotKey}`} className="gain-float" aria-hidden="true">
          +{ITEM_ICONS[lastShot.itemGained]}
        </span>
      )}
      {lastShot && lastShot.shooterId === p.id && lastShot.itemDiscarded && (
        <span key={`f${shotKey}`} className="full-chip">
          ITEMS FULL
        </span>
      )}
      {lastShot && lastShot.shooterId === p.id && lastShot.itemSuppressed && (
        <span key={`s${shotKey}`} className="full-chip">
          PEEKED · NO PRIZE
        </span>
      )}
      {lastShot && lastShot.cuffSkippedIds.includes(p.id) && (
        <span key={`k${shotKey}`} className="full-chip">
          ⛓️ TURN SKIPPED
        </span>
      )}
      {healFx && healFx.id === p.id && (
        <span key={`h${healFx.k}`} className="heal-ring" aria-hidden="true" />
      )}
      {healFx && healFx.id === p.id && (
        <span key={`hf${healFx.k}`} className="gain-float heal" aria-hidden="true">
          +♥
        </span>
      )}
      {cuffFx && cuffFx.id === p.id && (
        <span key={`c${cuffFx.k}`} className="cuff-slam" aria-hidden="true">
          ⛓️
        </span>
      )}
    </div>
  );
}
