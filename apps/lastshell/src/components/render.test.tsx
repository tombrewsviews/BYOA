/**
 * Renders the real components to markup and asserts what a player would see.
 *
 * These cover the wiring that pure reducer tests cannot: whether the new items
 * actually reach the DOM as usable buttons, whether the split's second target
 * gets damage feedback, and whether agent reasoning stays off screen.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerCard } from './PlayerCard';
import { AgentDock } from './AgentDock';
import { TitleBar } from './TitleBar';
import { START_LIVES } from '../engine/reducer';
import type { Item, Player, ShotResult } from '../engine/types';

function p(over: Partial<Player> = {}): Player {
  return {
    id: 1,
    name: 'Mara',
    lives: START_LIVES,
    items: [],
    alive: true,
    cuffedBy: null,
    blankSelfShots: 0,
    kind: 'human',
    ...over,
  };
}

/** PlayerCard with sensible defaults; `over` tweaks the interesting props. */
function card(over: Partial<Parameters<typeof PlayerCard>[0]> = {}) {
  return renderToStaticMarkup(
    <PlayerCard
      player={p()}
      isActive
      isTarget={false}
      canTarget
      cuffMode={false}
      cuffTargetAvailable
      splitActive={false}
      liveOpponents={3}
      goldenHit={null}
      canUseItems
      sawActive={false}
      lastShot={null}
      shotKey={1}
      healFx={null}
      cuffFx={null}
      onSelect={() => {}}
      onUseItem={() => {}}
      {...over}
    />,
  );
}

const shot = (over: Partial<ShotResult> = {}): ShotResult => ({
  shooterId: 9,
  targetId: 1,
  shell: 'live',
  damage: 1,
  sawed: false,
  split: false,
  itemGained: null,
  itemDiscarded: false,
  itemSuppressed: false,
  eliminatedId: null,
  cuffSkippedIds: [],
  ...over,
});

describe('split shell in the player card', () => {
  it('renders as an enabled button with two other players alive', () => {
    const html = card({ player: p({ items: ['split'] }), liveOpponents: 3 });
    expect(html).toContain('🔀');
    expect(html).toContain('Use split shell');
    expect(html).not.toContain('disabled=""');
  });

  it('is disabled with fewer than two other live players', () => {
    const html = card({ player: p({ items: ['split'] }), liveOpponents: 1 });
    expect(html).toContain('Needs two other players');
    expect(html).toContain('disabled=""');
  });

  it('is disabled when one is already loaded', () => {
    const html = card({ player: p({ items: ['split'] }), splitActive: true });
    expect(html).toContain('Split shell already loaded');
    expect(html).toContain('disabled=""');
  });

  it('shows damage on the SECOND target of a split shot', () => {
    // regression: the float keyed only on targetId, so the second victim lost a
    // life with no feedback at all
    const html = card({
      player: p({ id: 5, lives: 2 }),
      lastShot: shot({ targetId: 2, targetId2: 5, split: true, damage: 1 }),
    });
    expect(html).toContain('dmg-float');
    expect(html).toContain('−1');
  });

  it('still shows damage on the first target', () => {
    const html = card({
      player: p({ id: 2 }),
      lastShot: shot({ targetId: 2, targetId2: 5, split: true, damage: 1 }),
    });
    expect(html).toContain('dmg-float');
  });

  it('shows nothing on an untargeted seat', () => {
    const html = card({
      player: p({ id: 7 }),
      lastShot: shot({ targetId: 2, targetId2: 5, split: true, damage: 1 }),
    });
    expect(html).not.toContain('dmg-float');
  });
});

describe('golden bullet in the player card', () => {
  it('renders as a usable button that explains its effect', () => {
    const html = card({ player: p({ items: ['golden'] }) });
    expect(html).toContain('🥇');
    expect(html).toContain('2 lives off everyone else');
  });

  it('is never disabled — it works whenever held', () => {
    const html = card({ player: p({ items: ['golden'] }), liveOpponents: 1, splitActive: true });
    expect(html).not.toContain('disabled=""');
  });

  it('shows its own gold damage float on a victim', () => {
    const html = card({ player: p({ id: 3 }), goldenHit: { livesLost: 2, k: 1 } });
    expect(html).toContain('dmg-float golden');
    expect(html).toContain('−2');
  });

  it('announces the moment it is earned', () => {
    const html = card({
      player: p({ id: 4 }),
      lastShot: shot({ shooterId: 4, targetId: 4, shell: 'blank', damage: 0, goldenEarned: true }),
    });
    expect(html).toContain('GOLDEN BULLET');
  });

  it('does not announce it on other players cards', () => {
    const html = card({
      player: p({ id: 9 }),
      lastShot: shot({ shooterId: 4, targetId: 4, shell: 'blank', damage: 0, goldenEarned: true }),
    });
    expect(html).not.toContain('GOLDEN BULLET');
  });
});

describe('the agent dock no longer shows reasoning', () => {
  const seats = [{ seat: 2, name: 'UNIT-7', tier: 'steady' as const }];

  it('renders no thoughts list even when thoughts are supplied', () => {
    const html = renderToStaticMarkup(
      <AgentDock
        seats={seats}
        activity={{
          seat: 2,
          name: 'UNIT-7',
          tier: 'steady',
          thoughts: ['I should not be rendered', 'nor should I'],
          confidence: 0.8,
          source: 'agent',
        }}
        project={null}
        log={[]}
        activeSeat={2}
        onForcePlay={() => {}}
      />,
    );
    expect(html).not.toContain('thoughts-list');
    expect(html).not.toContain('I should not be rendered');
    // a terse status line replaces it
    expect(html).toContain('PLAYING');
  });

  it('marks a local fallback turn distinctly', () => {
    const html = renderToStaticMarkup(
      <AgentDock
        seats={seats}
        activity={{ seat: 2, name: 'UNIT-7', tier: 'steady', thoughts: [], confidence: 0, source: 'fallback' }}
        project={null}
        log={[]}
        activeSeat={2}
        onForcePlay={() => {}}
      />,
    );
    expect(html).toContain('LOCAL');
  });
});

describe('the agent dock PLAY button', () => {
  const seats = [
    { seat: 2, name: 'UNIT-7', tier: 'steady' as const },
    { seat: 3, name: 'DEALER', tier: 'sharp' as const },
  ];
  const dock = (activeSeat: number | null) =>
    renderToStaticMarkup(
      <AgentDock seats={seats} activity={null} project={null} log={[]} activeSeat={activeSeat} onForcePlay={() => {}} />,
    );

  it('renders one PLAY button per agent seat', () => {
    expect(dock(null).match(/PLAY/g)?.length).toBe(2);
  });

  it('enables only the seat holding the gun', () => {
    const html = dock(2);
    // seat 2 is live, seat 3 disabled → exactly one disabled attribute
    expect(html.match(/disabled=""/g)?.length).toBe(1);
    // React escapes the apostrophe in the title attribute
    expect(html).toMatch(/Play UNIT-7(&#x27;|')s turn now/);
    expect(html).toContain('DEALER does not hold the gun');
  });

  it('disables every seat when no agent is up', () => {
    expect(dock(null).match(/disabled=""/g)?.length).toBe(2);
  });
});

describe('the title bar restart button', () => {
  it('is absent on the setup screen (nothing to restart)', () => {
    const html = renderToStaticMarkup(
      <TitleBar round={null} muted={false} onToggleMute={() => {}} />,
    );
    expect(html).not.toContain('Restart game');
  });

  it('appears mid-game and starts unarmed', () => {
    const html = renderToStaticMarkup(
      <TitleBar round={2} muted={false} onToggleMute={() => {}} onRestart={() => {}} />,
    );
    expect(html).toContain('Restart game');
    expect(html).toContain('↺');
    // not yet in the confirming state
    expect(html).not.toContain('SURE?');
    expect(html).not.toContain('titlebar-btn warn');
  });

  it('keeps its drag region so the window still moves', () => {
    const html = renderToStaticMarkup(
      <TitleBar round={1} muted={false} onToggleMute={() => {}} onRestart={() => {}} />,
    );
    expect(html).toContain('data-tauri-drag-region');
  });
});

describe('every item renders an icon and a name', () => {
  it('covers all five items, so none appears as a blank slot', () => {
    const all: Item[] = ['glass', 'saw', 'life', 'cuffs', 'split'];
    for (const item of all) {
      const html = card({ player: p({ items: [item], lives: 1 }) });
      expect(html, `${item} should render an icon`).toMatch(/item-btn/);
    }
    // golden too, though it is earned rather than dropped
    expect(card({ player: p({ items: ['golden'] }) })).toMatch(/item-btn/);
  });
});
