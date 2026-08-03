# LAST SHELL

Agent-native shell roulette for DreamStore. A shotgun holds a hidden sequence of
blank and live shells, passed around a table of up to 11 seats. Play hotseat with
people, or seat up to 3 local agents and watch them reason in the terminal beside
the table.

## Run

```bash
npm install
npm run dev          # browser — game works, no agent (heuristic plays instead)
npm run tauri:dev    # desktop — real PTY, real agent
npm test             # engine + protocol tests
npm run tauri:build  # LAST SHELL.app + dmg
```

Installed builds live in `/Applications/DreamStore/`, registered in
`~/.dreamstore/installed.json`.

## Architecture

- **`src/engine/`** — the rules. Pure, framework-free reducer `(state, action) => state`,
  ported unchanged from the standalone game. No DOM, fully unit-tested.
- **`src/agent/protocol.ts`** — the file contract the agent plays through, plus
  `validateMove`: the app is the referee, not the agent.
- **`src/agent/useAgentBridge.ts`** — publishes state, watches for moves, applies
  them; falls back to the local heuristic if no agent answers in 45s.
- **`src/terminal.tsx`** — xterm.js against the Rust PTY. Spawns the agent CLI in
  the table's project dir so it picks up CLAUDE.md and the skill automatically.
- **`src-tauri/`** — `pty.rs` (portable-pty), `watch.rs` (notify), `game.rs`
  (atomic file I/O), `skill.rs` (installs the operating manual).
- **`skills/lastshell/SKILL.md`** — how the agent plays, and the three personas.

## How an agent plays

The DreamStore agent-native pattern: the app owns the document, the agent edits a
file, the app reacts.

```
app   → .lastshell/game-state.json   what the agent may know
agent → .lastshell/moves.json        the move + the reasoning behind it
```

Each turn the app publishes `game-state.json` with `awaitingSeat`, the persona to
play, pre-computed public odds, and an exhaustive `legalActions` list. The agent
writes one move. The app validates it against the pure reducer and applies it.
The `thoughts` array is rendered on screen so the humans can argue with it.

Three tiers, each a distinct style: `reckless` (instinct), `steady` (plays the
odds), `sharp` (reads the table — threat targeting, item timing, protects its
last life).

## Fairness

`game-state.json` is built by `toAgentView()` and **never contains the hidden
shell order**. The agent sees the remaining shell *count*, the round's public
live/blank composition, the revealed spent tray, and its own magnifying-glass
peek — exactly what a human at the table sees. Tests assert the queue cannot
reach disk, and that a move for a seat the agent doesn't control is rejected.
