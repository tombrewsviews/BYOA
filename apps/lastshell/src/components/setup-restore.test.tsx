/**
 * Restarting must come back to the SAME table.
 *
 * The bug: TableSetup took only `prevNames`, so the human/agent split and the
 * tiers were lost. A 1-human + 3-agent table restarted as 4 humans with the agent
 * names typed into the human name fields — "PEOPLE ONLY" selected, agents gone.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TableSetup } from './TableSetup';
import { initialState, reducer } from '../engine/reducer';
import type { SeatConfig } from '../engine/types';

/** The seats App.tsx derives from state.players and hands to TableSetup. */
function seatsFromPlayers(s: ReturnType<typeof initialState>): SeatConfig[] {
  return s.players.map((p) => ({ name: p.name, kind: p.kind, tier: p.tier }));
}

const MIXED: SeatConfig[] = [
  { name: 'Ana', kind: 'human' },
  { name: 'UNIT-7', kind: 'agent', tier: 'reckless' },
  { name: 'DEALER', kind: 'agent', tier: 'sharp' },
  { name: 'GHOST', kind: 'agent', tier: 'steady' },
];

const html = (prevSeats: SeatConfig[]) =>
  renderToStaticMarkup(<TableSetup prevSeats={prevSeats} onStart={() => {}} />);

describe('RESTART keeps the seat configuration on the players', () => {
  it('preserves kind and tier through a full game and restart', () => {
    let s = reducer(initialState(), { type: 'START_GAME', seats: MIXED });
    s = reducer(s, { type: 'BEGIN_ROUND' });
    s = reducer(s, { type: 'RESTART' });

    expect(s.phase).toBe('setup');
    expect(seatsFromPlayers(s)).toEqual(MIXED);
  });

  it('resets lives and items but not the roster', () => {
    let s = reducer(initialState(), { type: 'START_GAME', seats: MIXED });
    s = reducer(s, { type: 'BEGIN_ROUND' });
    // bang up the table a bit
    s = {
      ...s,
      players: s.players.map((p) => ({ ...p, lives: 1, items: ['saw'], blankSelfShots: 2 })),
    };
    s = reducer(s, { type: 'RESTART' });
    expect(s.players.every((p) => p.lives === 3 && p.items.length === 0)).toBe(true);
    expect(s.players.every((p) => p.blankSelfShots === 0)).toBe(true);
    expect(s.players.map((p) => p.kind)).toEqual(['human', 'agent', 'agent', 'agent']);
  });
});

describe('the setup screen restores the previous table', () => {
  it('selects PEOPLE + AGENTS when the last table had agents', () => {
    const out = html(MIXED);
    // the agents-mode button carries the selected class
    expect(out).toMatch(/class="[^"]*mode-btn[^"]*on[^"]*"[^>]*>PEOPLE \+ AGENTS/);
  });

  it('selects PEOPLE ONLY when the last table was all human', () => {
    const out = html([
      { name: 'Ana', kind: 'human' },
      { name: 'Bo', kind: 'human' },
    ]);
    expect(out).toMatch(/class="[^"]*mode-btn[^"]*on[^"]*"[^>]*>PEOPLE ONLY/);
  });

  it('restores the human count, counting ONLY the humans', () => {
    // regression: 1 human + 3 agents used to come back as 4 humans
    const out = html(MIXED);
    // the human count radiogroup marks its selection with aria-checked
    // scope to the humans radiogroup so the agents one can't satisfy it
    const group = (out.match(/aria-label="Number of people"[\s\S]*?<\/div>/) ?? [''])[0];
    expect(group).toMatch(/aria-checked="true"[^>]*>1</);
  });

  it('restores the agent count', () => {
    const group = (html(MIXED).match(/aria-label="Number of agents"[\s\S]*?<\/div>/) ?? [''])[0];
    expect(group).toMatch(/aria-checked="true"[^>]*>3</);
  });

  it('puts only HUMAN names in the name fields', () => {
    const out = html(MIXED);
    expect(out).toContain('value="Ana"');
    // agent names must not land in a human name input
    expect(out).not.toContain('value="UNIT-7"');
    expect(out).not.toContain('value="DEALER"');
    expect(out).not.toContain('value="GHOST"');
  });

  it('keeps custom human names across a restart', () => {
    const out = html([
      { name: 'Mara', kind: 'human' },
      { name: 'Kade', kind: 'human' },
      { name: 'UNIT-7', kind: 'agent', tier: 'steady' },
    ]);
    expect(out).toContain('value="Mara"');
    expect(out).toContain('value="Kade"');
  });

  it('restores each agent tier, not the defaults', () => {
    // MIXED is reckless/sharp/steady — the default is steady/steady/sharp, so a
    // dropped tier would show up as a different selection set
    const out = html(MIXED);
    const selected = [...out.matchAll(/aria-checked="true"[^>]*>(RECKLESS|STEADY|SHARP)</g)].map((m) => m[1]);
    expect(selected).toEqual(['RECKLESS', 'SHARP', 'STEADY']);
  });

  it('falls back to sane defaults on a first run (no previous table)', () => {
    const out = html([]);
    expect(out).toMatch(/class="[^"]*mode-btn[^"]*on[^"]*"[^>]*>PEOPLE ONLY/);
    expect(out).toContain('value="Player 1"');
  });

  it('shows the total seat count including agents', () => {
    // regression: a restored 1-human + 3-agent table reported 5 seats, because
    // the human count was floored at MIN_PLAYERS before the agent rule applied
    expect(html(MIXED)).toContain('4 AT THE TABLE');
    expect(html(MIXED)).not.toContain('5 AT THE TABLE');
  });
});
