---
name: lastshell
description: Operating manual for LAST SHELL — play seats at a shotgun-roulette table by reading .lastshell/game-state.json and writing .lastshell/moves.json. Impersonate up to 3 agent seats, each with its own style.
---

# LAST SHELL — how you play

You are seated at a **LAST SHELL** table alongside human players. The gun holds a
hidden sequence of blank and live shells. Players fire at themselves or at each
other until one is left alive.

You play by **editing a file**. The app is the referee and the renderer.

```
app   → .lastshell/game-state.json   what you may know   (READ)
you   → .lastshell/moves.json        the move you make   (WRITE)
```

## The loop — run it yourself, do not wait to be asked

**You are responsible for driving your own turns.** Nobody is going to tell you
that a new turn started. The app publishes a tick file every time it republishes
state; you block on it.

Once seated, keep repeating this until the game ends.

**Wait for your turn with ONE short command, then return.** Never run a long
blocking loop — a 100-iteration `sleep` makes you unresponsive and you will miss
your own turn. Use a bounded wait of a few seconds that exits the moment the
tick changes:

```bash
# Bounded wait: exits as soon as turn.txt differs, gives up after ~8s.
# turn.txt is written LAST, after game-state.json is fully on disk.
cd "$LASTSHELL_PROJECT" && last='turn 2 seat 2 UNIT-7' && \
for i in $(seq 1 8); do
  new=$(cat .lastshell/turn.txt 2>/dev/null)
  [ "$new" != "$last" ] && { echo "TICK: $new"; exit 0; }
  sleep 1
done; echo "still: $(cat .lastshell/turn.txt)"
```

If it prints `still:`, just run the same command again. Several short waits are
correct; one long one is not. `$LASTSHELL_PROJECT` is already set in your shell.

When the tick changes:

1. Read `.lastshell/game-state.json`.
2. If `awaitingSeat` is `null`, it is a human's turn — **do nothing but go back
   to waiting**. Do not write a move. Do not nudge the human.
3. If `awaitingSeat` is a number, that is **your** seat this turn. Pick one of
   the `legalActions` in the style of `awaitingPersona.tier`.
4. Write `moves.json`, then **immediately go back to step 1**. Do not stop to
   report. Do not ask whether to continue. Do not say "tell me when the state
   updates" — watching `turn.txt` is how you find out.

### How a game ends — and how the next one starts

**Never infer an ending from silence.** A tick that stops changing means the table
is thinking, not finished. The app *always* tells you, in the tick and in the
state file. Judge only by `phase`:

| `phase` | `awaitingSeat` | What it means | What you do |
|---|---|---|---|
| `"turn"` | your seat | your move | write `moves.json` |
| `"turn"` | `null` | a human's move | wait for the next tick |
| `"gameOver"` | `null` | the game is finished | name the winner in one line, then wait for a rematch |

The tick line names it too, so a single `cat` is enough to tell them apart:

```
turn 8 seat 4 GHOST          ← your move
turn 9 seat 2 human          ← someone else's move, keep waiting
turn 10 gameOver winner 2 UNIT-7   ← finished
```

When `phase` is `"gameOver"`, read `outcome` for the result — `winnerSeat`,
`winnerName`, `agentWon`, and the full `standings`. State the winner in one short
line. No post-game analysis.

**Then keep watching.** Finishing a game is not finishing your session — the
humans may start another table straight away. Go back to the bounded wait. When a
new game begins you will see `phase` back to `"turn"` with a fresh roster; adopt
your new seat and play on. Only stop watching when the human tells you to.

**If `moves.json` disappears and the tick has not changed**, the app consumed your
move and is animating the shot. That is normal — keep waiting. It does *not* mean
the game ended.

**Using an item does not end your turn.** After a `USE_ITEM` move the app
republishes with `awaitingSeat` still you — often with new information (a glass
reveal shows up as `view.peekedShell`). Wait for the tick, re-read, and act
again.

**If the app plays your seat for you**, you waited too long: the local fallback
takes a seat that has gone quiet for 5 minutes. You will see it in the log as
`local fallback`. Tighten your loop — that is a bug in your pacing, not the
app's.

### Writing a move

```json
{
  "turn": 12,
  "seat": 9,
  "action": "FIRE",
  "target": 1,
  "confidence": 0.75
}
```

**Play FAST. Do not explain yourself.** Speed is the point: the table is waiting
on you every turn. Read the state, pick a move, write the file, go back to
waiting. Specifically:

- **Do not write `thoughts`.** Nothing renders them any more, so composing them
  costs the table time for no benefit.
- **Do not narrate in the terminal.** No "let me check the odds", no summary of
  what you did, no commentary between turns. Write the file and move on.
- **Do not deliberate.** `legalActions` is exhaustive and `odds.pLive` is already
  computed — you do not need to re-derive anything. One glance, one choice.
- **Do not read other files** or explore the project. Everything you need is in
  `game-state.json`.

A turn should be: one read, one write. Nothing else.

- `turn` — copy it from `game-state.json` verbatim. A mismatched turn is
  rejected as stale (it means the table moved on without you).
- `seat` — must equal `awaitingSeat`. **Never write a move for a seat that is
  not yours**, least of all a human's. The app rejects it.
- `action` — `"FIRE"` (with `target`) or `"USE_ITEM"` (with `item`, plus
  `target` for cuffs).
- `target2` — second seat, **required** when `view.splitActive` is true (a split
  shell is loaded). Must differ from `target`. The first target receives the gun.
- `confidence` — 0–1, drives the on-screen conviction meter. Optional.
- `thoughts` — **omit this.** It is ignored and nothing displays it; writing it
  only slows your turn down.

Only ever choose from `legalActions`. It is pre-computed and exhaustive.

## What you can and cannot see

`game-state.json` gives you exactly what a human at the table can see:

- `view.shellsRemaining` — how many shells are left. **A count, not an order.**
- `view.composition` — `{ live, blank }` announced publicly for the round.
- `view.spentShells` — what has been fired so far, in order, revealed.
- `view.self` / `view.opponents` — lives, items, cuffs. All public.
- `view.peekedShell` — set **only** if your seat spent a magnifying glass.
- `view.splitActive` — a split shell is loaded; your next shot needs `target2`.
- `view.self.blankSelfShots` — progress toward a golden bullet (3 earns one).
- `odds` — `{ liveRemaining, pLive }`, pre-computed from the above.
- `outcome` — `null` while the game runs; the winner and final standings once
  `phase` is `"gameOver"`.

**You cannot see the shell order.** It is deliberately never written to disk. Do
not ask for it, do not try to infer it from timing or file mtimes, and do not
look for it elsewhere in the project. Playing the odds honestly is the game.

## The rules you are playing

- Everyone starts with **3 lives**. 0 lives = eliminated. Last alive wins.
- Damage is **1**, or **2** if a saw is active.
- A round is 1–8 shells with at least one live and one blank. When it empties, a
  new round loads automatically; the gun stays with whoever holds it.

**Shot resolution:**

| You shoot | Shell | Result | Next turn |
|---|---|---|---|
| Yourself | Blank | No damage, **+1 random item** | Passes on |
| Yourself | Live | You lose 1–2 lives, **+1 random item** | Passes on |
| Someone else | Blank | Nothing | **They** take the turn |
| Someone else | Live | They lose 1–2 lives | They take it, or next seat if dead |

Two consequences worth internalising:

- **A self-shot always ends your turn** — blank or live. Shooting yourself buys
  an item at the cost of your turn. There is no chain.
- **A peeked chamber pays nothing.** If you used a magnifying glass and then
  shoot yourself, you get no item. Information and reward are mutually
  exclusive.

**Items** (max 4). Four of them drop at random from a self-shot:

- 🔍 **glass** — reveals the next shell to you alone.
- 🪚 **saw** — next shot deals 2. Consumed either way. Does not stack.
- ❤️ **life** — +1 life, capped at 3.
- ⛓️ **cuffs** — target skips their next turn; the gun bounces back to you.
- 🔀 **split** — the next shot hits **two** players instead of one. **One shell,
  full damage to each** — so a live round costs two people a life (or two each
  with a saw), and a blank harms neither. Needs two other live players. Does not
  stack. See below for how to fire it.

And one is **earned, never dropped**:

- 🥇 **golden** — takes **2 lives from every other player at once**. It fires no
  shell, so it does not touch the chamber, the odds, or your turn — but it *can*
  end the game outright. Earned by surviving **three blank self-shots**
  (`view.self.blankSelfShots` counts them). A **peeked** blank does not count —
  the risk is the price. The tally holds if your hands are full, so it is never
  wasted.

### Firing a split shell

When `view.splitActive` is true, add `target2` to your move:

```json
{ "turn": 14, "seat": 3, "action": "FIRE", "target": 1, "target2": 4 }
```

- `target` and `target2` must be **different live seats**.
- **`target` receives the gun** afterwards; `target2` is collateral and does not.
- A single-target shot is still legal while a split is armed — it just **wastes**
  the split. `legalActions` lists both, so pick a `SPLIT FIRE` entry unless you
  genuinely want to throw the item away.

## The three personas

`awaitingPersona.tier` tells you who to be. It shapes **which move you pick** —
not how you describe it, since you no longer describe anything. Play them as
genuinely different players, not three flavours of the same strategy.

### `reckless` — plays on instinct
Ignores `pLive`. Picks a target more or less at random and self-shoots on bad
odds because it wants the item now. Burns items early for no strong reason.

### `steady` — plays the odds
`pLive < 0.5` → shoot yourself for the item; otherwise shoot the biggest threat
(fewest lives, then most items). Heal when hurt. Saw a certain-live chamber.

### `sharp` — plays the table
Everything `steady` does, plus:
- take a **certain kill** over any other line
- spend the **glass at maximum uncertainty** (`pLive` near 0.5), never when the
  odds are already lopsided
- **split a certain-live chamber** when two opponents are alive — two hits, one shell
- **golden bullet** when two or more opponents would drop to 0
- **cuff the biggest threat** before handing the gun on
- on your **last life, never gamble** a self-shot

## Etiquette at a shared table

- **One move per turn.** Write the file once, then wait for new state.
- **Never move for a human.** Their seats are theirs.
- **Do not stall.** If it is your turn, move. The table is waiting on you.
- **Stay in character** — the tier decides *which* move you favour. It never
  licenses cheating or writing a move for a seat that isn't yours.
- If the app reports your move was rejected, read the reason in `log`, fix it,
  and write again. Common causes: stale `turn`, wrong `seat`, an action absent
  from `legalActions`.
