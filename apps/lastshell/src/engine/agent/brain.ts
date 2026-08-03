import { random, randInt, pick } from '../rng';
import { GOLDEN_DAMAGE, MAX_ITEMS, START_LIVES } from '../reducer';
import type { Action, Item } from '../types';
import { liveRemaining, pLive, type AgentOpponent, type AgentView } from './view';

/**
 * A single decision, with the reasoning that produced it. `thoughts` is shown
 * in the UI so humans at the table can follow and argue with the agent — so
 * every line must be the ACTUAL reason a rule fired, not decoration.
 */
export interface AgentDecision {
  action: Action;
  thoughts: string[];
  /** 0–1, how strongly the rule favoured this move; drives the UI meter. */
  confidence: number;
  /** Short name of the rule that fired, e.g. 'odds' or 'certain-live'. */
  rule: string;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Alive opponents, most dangerous first: fewest lives, then most items. */
function byThreat(view: AgentView): AgentOpponent[] {
  return view.opponents
    .filter((o) => o.alive)
    .slice()
    .sort((a, b) => a.lives - b.lives || b.items.length - a.items.length || a.id - b.id);
}

/** Weakest alive opponent — the best kill candidate. */
function easiestKill(view: AgentView, damage: number): AgentOpponent | undefined {
  return byThreat(view).find((o) => o.lives <= damage);
}

function has(view: AgentView, item: Item): boolean {
  return view.self.items.includes(item);
}

/**
 * Once a split shell is armed the ONLY legal move is a two-target shot, so this
 * runs ahead of the tiers — every tier branch below emits single-target shots,
 * which the reducer would reject outright.
 *
 * Target choice still respects tier: reckless picks at random, the others take
 * the two biggest threats (killing two at once is the whole point of the item).
 */
function decideSplit(view: AgentView): AgentDecision {
  const alive = view.opponents.filter((o) => o.alive);
  const ordered = view.self.tier === 'reckless' ? alive.slice() : byThreat(view);
  // Fewer than two opponents can't happen — USE_ITEM guards against arming it —
  // but if it somehow does, pair with self rather than emitting an illegal move.
  const a = ordered[0];
  const b = ordered[1];
  if (!a) {
    return {
      action: { type: 'FIRE', targetId: view.self.id },
      thoughts: ['Split shell armed with nobody to aim at.'],
      confidence: 0.3,
      rule: 'split-no-target',
    };
  }
  if (!b) {
    return {
      action: { type: 'FIRE', targetId: a.id, targetId2: view.self.id },
      thoughts: [`Only ${a.name} left — the split has to include me.`],
      confidence: 0.3,
      rule: 'split-one-target',
    };
  }
  const p = pLive(view);
  return {
    action: { type: 'FIRE', targetId: a.id, targetId2: b.id },
    thoughts:
      view.self.tier === 'reckless'
        ? [`Split shell. ${a.name} and ${b.name}, both of you.`]
        : [
            `Split shell armed — one shell, two hits.`,
            `Live chance: ${pct(p)}.`,
            `${a.name} (${a.lives}) and ${b.name} (${b.lives}) take it together.`,
          ],
    confidence: p,
    rule: 'split-fire',
  };
}

/**
 * Tier: reckless barely reads the table, steady plays the odds, sharp also
 * times its items and protects its last life.
 */
export function decide(view: AgentView): AgentDecision {
  // A split shell overrides tier play: nothing else is legal.
  if (view.splitActive) return decideSplit(view);
  switch (view.self.tier) {
    case 'reckless':
      return decideReckless(view);
    case 'sharp':
      return decideSharp(view);
    default:
      return decideSteady(view);
  }
}

/** Tier 1 — acts on gut feel; ignores the odds and mostly forgets its items. */
function decideReckless(view: AgentView): AgentDecision {
  const targets = byThreat(view);
  // occasionally burns an item for no particular reason
  if (view.self.items.length > 0 && random() < 0.15) {
    const item = pick(view.self.items);
    if (item !== 'cuffs' && !(item === 'saw' && view.sawActive) && !(item === 'life' && view.self.lives >= START_LIVES)) {
      return {
        action: { type: 'USE_ITEM', item },
        thoughts: [`Got a ${item}. Feels like the moment.`],
        confidence: 0.2,
        rule: 'whim',
      };
    }
  }
  const shootSelf = random() < 0.35;
  if (shootSelf || targets.length === 0) {
    return {
      action: { type: 'FIRE', targetId: view.self.id },
      thoughts: ['Not thinking too hard about this one.', 'Pulling on myself.'],
      confidence: 0.15,
      rule: 'coinflip-self',
    };
  }
  const t = targets[randInt(0, targets.length - 1)];
  return {
    action: { type: 'FIRE', targetId: t.id },
    thoughts: [`${t.name} looked at me funny.`, 'Good enough reason.'],
    confidence: 0.15,
    rule: 'coinflip-other',
  };
}

/** Tier 2 — counts shells and plays the probability. Simple item use. */
function decideSteady(view: AgentView): AgentDecision {
  const p = pLive(view);
  const live = liveRemaining(view);
  const counted = `${view.shellsRemaining} left — ${live} live, ${view.shellsRemaining - live} blank.`;
  const odds = `Chance the chamber is live: ${pct(p)}.`;

  // Golden bullet whenever it kills anyone — steady doesn't plan ahead, it just
  // takes the damage. Two lives off everyone is plainly the best value on offer.
  if (has(view, 'golden') && view.opponents.some((o) => o.alive && o.lives <= GOLDEN_DAMAGE)) {
    return {
      action: { type: 'USE_ITEM', item: 'golden' },
      thoughts: ['Golden bullet — 2 lives off everyone at the table.'],
      confidence: 1,
      rule: 'golden',
    };
  }

  if (p === 0) {
    return {
      action: { type: 'FIRE', targetId: view.self.id },
      thoughts: [counted, 'No live shells left at all.', 'Free item — shooting myself.'],
      confidence: 1,
      rule: 'certain-blank',
    };
  }
  if (p === 1) {
    const target = byThreat(view)[0];
    if (has(view, 'saw') && !view.sawActive) {
      return {
        action: { type: 'USE_ITEM', item: 'saw' },
        thoughts: [counted, 'Every shell left is live.', 'Sawing off first — double damage.'],
        confidence: 1,
        rule: 'certain-live-saw',
      };
    }
    if (target) {
      return {
        action: { type: 'FIRE', targetId: target.id },
        thoughts: [counted, 'Guaranteed live round.', `Putting it into ${target.name}.`],
        confidence: 1,
        rule: 'certain-live',
      };
    }
  }
  if (view.self.lives < START_LIVES && has(view, 'life')) {
    return {
      action: { type: 'USE_ITEM', item: 'life' },
      thoughts: [`Down to ${view.self.lives} lives.`, 'Topping up before anything else.'],
      confidence: 0.7,
      rule: 'heal',
    };
  }
  if (p < 0.5) {
    return {
      action: { type: 'FIRE', targetId: view.self.id },
      thoughts: [counted, odds, 'Odds favour a blank — taking the shot for the item.'],
      confidence: 1 - p,
      rule: 'odds-self',
    };
  }
  const target = byThreat(view)[0];
  if (!target) {
    return {
      action: { type: 'FIRE', targetId: view.self.id },
      thoughts: [counted, 'Nobody else to aim at.'],
      confidence: 0.5,
      rule: 'no-target',
    };
  }
  return {
    action: { type: 'FIRE', targetId: target.id },
    thoughts: [counted, odds, `Too risky for me — firing at ${target.name}.`],
    confidence: p,
    rule: 'odds-other',
  };
}

/** Tier 3 — odds plus threat reading, item timing and self-preservation. */
function decideSharp(view: AgentView): AgentDecision {
  const p = pLive(view);
  const live = liveRemaining(view);
  const damage = view.sawActive ? 2 : 1;
  const counted = `${view.shellsRemaining} left — ${live} live, ${view.shellsRemaining - live} blank.`;
  const odds = `Live chance: ${pct(p)}.`;
  const threats = byThreat(view);
  const target = threats[0];

  // 0. The golden bullet takes 2 lives from EVERYONE. Fire it as soon as it
  // kills anyone.
  //
  // Holding it for a bigger multi-kill measurably LOSES: tested against steady
  // (which fires on any kill), a hold-for-two rule dropped sharp to 199/400 from
  // 229/400. Waiting gives opponents turns to heal or to kill you first, and the
  // bullet's value does not grow faster than that risk.
  if (has(view, 'golden')) {
    const wouldKill = view.opponents.filter((o) => o.alive && o.lives <= GOLDEN_DAMAGE);
    // Sharp reads one thing steady cannot: the bullet hits everyone, so firing it
    // while ON a last life is how you lose a won position — the survivors all get
    // a turn on you. Heal first if you can; otherwise still take a guaranteed kill.
    const safeToSwing = view.self.lives > 1 || wouldKill.length >= view.opponents.filter((o) => o.alive).length;
    if (wouldKill.length > 0 && safeToSwing) {
      return {
        action: { type: 'USE_ITEM', item: 'golden' },
        thoughts: [`Golden bullet ends ${wouldKill.map((o) => o.name).join(' and ')}.`],
        confidence: 1,
        rule: 'golden-kill',
      };
    }
  }

  // 1. A certain kill is worth more than any other line of play.
  if (p === 1) {
    const kill = easiestKill(view, damage);
    if (kill && !(has(view, 'saw') && !view.sawActive && kill.lives > 1)) {
      return {
        action: { type: 'FIRE', targetId: kill.id },
        thoughts: [counted, 'Chamber is certainly live.', `${kill.name} is on ${kill.lives} — that ends them.`],
        confidence: 1,
        rule: 'certain-kill',
      };
    }
    if (has(view, 'saw') && !view.sawActive) {
      return {
        action: { type: 'USE_ITEM', item: 'saw' },
        thoughts: [counted, 'Certain live round.', 'Sawing first to make it count double.'],
        confidence: 1,
        rule: 'saw-certain',
      };
    }
  }

  // 2. Known blank → free item, no risk.
  if (p === 0) {
    return {
      action: { type: 'FIRE', targetId: view.self.id },
      thoughts: [counted, 'Nothing live left in there.', 'Shooting myself is pure profit.'],
      confidence: 1,
      rule: 'certain-blank',
    };
  }

  // 3. Heal before risking a last life.
  if (view.self.lives === 1 && has(view, 'life')) {
    return {
      action: { type: 'USE_ITEM', item: 'life' },
      thoughts: ['One life left — that is losing position.', 'Spending the extra life now.'],
      confidence: 0.9,
      rule: 'heal-critical',
    };
  }

  // 4. Glass is worth most at maximum uncertainty.
  if (has(view, 'glass') && !view.peekedShell && view.shellsRemaining > 1 && p > 0.34 && p < 0.66) {
    return {
      action: { type: 'USE_ITEM', item: 'glass' },
      thoughts: [counted, odds, 'Too close to call — checking the chamber first.'],
      confidence: 0.8,
      rule: 'glass-uncertain',
    };
  }

  // 5. A split shell on a certain-live chamber hits two people at once — the
  // strongest single play in the game. Only worth it with two live opponents.
  if (
    has(view, 'split') &&
    !view.splitActive &&
    p === 1 &&
    view.opponents.filter((o) => o.alive).length >= 2
  ) {
    return {
      action: { type: 'USE_ITEM', item: 'split' },
      thoughts: [counted, 'Chamber is certainly live.', 'Splitting it — one shell, two casualties.'],
      confidence: 1,
      rule: 'split-certain-live',
    };
  }

  // 6. Cuff the biggest threat before handing the gun over.
  if (has(view, 'cuffs') && target && target.cuffedBy === null && threats.length > 1) {
    return {
      action: { type: 'USE_ITEM', item: 'cuffs', targetId: target.id },
      thoughts: [
        `${target.name} is the danger here (${target.lives} lives, ${target.items.length} items).`,
        'Cuffing them so the gun bounces back to me.',
      ],
      confidence: 0.75,
      rule: 'cuff-threat',
    };
  }

  // 7. On a last life, never gamble on a self-shot.
  if (view.self.lives === 1 && p > 0.2) {
    if (target) {
      return {
        action: { type: 'FIRE', targetId: target.id },
        thoughts: [counted, odds, 'On my last life I do not gamble.', `Aiming at ${target.name}.`],
        confidence: 1 - p,
        rule: 'protect-last-life',
      };
    }
  }

  // 8. Otherwise play the odds; self-shot buys an item when blanks dominate.
  if (p < 0.5) {
    const room = view.self.items.length < MAX_ITEMS;
    return {
      action: { type: 'FIRE', targetId: view.self.id },
      thoughts: [
        counted,
        odds,
        room
          ? 'Blanks outnumber lives — taking it myself for the item.'
          : 'Blanks outnumber lives, and my item slots are full — still the safe shot.',
      ],
      confidence: 1 - p,
      rule: 'odds-self',
    };
  }
  if (!target) {
    return {
      action: { type: 'FIRE', targetId: view.self.id },
      thoughts: [counted, 'No one left to aim at.'],
      confidence: 0.5,
      rule: 'no-target',
    };
  }
  return {
    action: { type: 'FIRE', targetId: target.id },
    thoughts: [counted, odds, `Odds are against me — ${target.name} takes it.`],
    confidence: p,
    rule: 'odds-other',
  };
}
