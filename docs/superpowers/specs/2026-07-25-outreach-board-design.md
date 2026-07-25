# Outreach — Design

**Date:** 2026-07-25
**Status:** Approved (design); ready for implementation plan.

## Summary

**Outreach** is a new DreamStore app (`apps/outreach/`) that ingests research
documents and turns them into **lead cards** on a kanban board, driven by a
local coding agent in the terminal panel. It follows the standard DreamStore
three-panel shell — **Agent** (left) · **Runtime** (kanban board) ·
**Properties** (lead inspector / settings) — built on the same Tauri shell as
`brainstorm` and `remit`.

The board's data model **is** the editable-stages pipeline model specified in
§15 (see [Pipeline model](#pipeline-model-§15) below), implemented locally in
SQLite. The agent operates the board **as a human would** — ingesting pasted
research, matching it to existing leads, enriching context without ever losing
information, drafting messages, summarizing call transcripts, and moving cards
through stages — via a local **Outreach MCP server** whose verbs all go through
an append-only, fully reversible event log.

### Why this shape

- **§15 is the data model, not a separate system.** There is no pre-existing
  pipeline app; `PIPELINE-SPEC-v3.md` does not exist in the repo. §15 is written
  as a delta against that document, so we treat §15 as the authoritative spec
  for Outreach's board and reconstruct the model it implies (below).
- **Structured board, stored locally.** Leads move through stages; a stage is
  *data* (`text`), not schema. Editing a column is a config edit, moving cards is
  a bulk update through `commit()`, and everything is reversible via `revert()`.
  No DDL, no migration, no admin role.
- **Agent-operated via MCP.** Every write goes through `commit()` (one SQL
  transaction, one event per lead). The §15.6 safety gates (dryRun,
  blast-radius confirm, rule-check block) are **enforced in the MCP server**, not
  merely documented in the skill.

## The three panels

Per the DreamStore convention (`CLAUDE.md` → "App layout convention"), left →
right:

1. **Agent** (leftmost, always) — the terminal / Chat panel. Copied as-is from
   `brainstorm`: `src/agent-chat/`, `src/terminal.tsx`, and the Rust `pty.rs` /
   `agent_chat.rs` / `agents.rs` / `settings.rs`. Bring-your-own-agent
   (Claude / Codex / Gemini). No changes to this infrastructure. The Terminal is
   the source of truth; Chat is a convenience layer over the same shell.
2. **Runtime** — the **kanban board**, served locally and opened in its own
   tiled window (exactly like brainstorm opens the Excalidraw window). Columns =
   stages, cards = leads. Reflects SQLite live; when the agent moves a card you
   watch it move.
3. **Properties** — a **lead inspector / board settings** panel in the main
   window: the selected card's context, messages, and transcript summaries; and
   Settings (stages list with stable ids in small type per §15.7, `created_by`
   provenance per §15.6).

```
┌─ Outreach app (Tauri main window) ────────────────────────────────┐
│  ┌─ Agent (left) ─────────┐   ┌─ Properties (right) ────────────┐ │
│  │ Terminal / Chat         │  │ Lead inspector: context,         │ │
│  │ (BYO agent)             │  │   messages, transcript summaries │ │
│  │                         │  │ Settings: stages (+ stable ids), │ │
│  │                         │  │   provenance, rules              │ │
│  └──────────┬──────────────┘  └──────────────────────────────────┘ │
└─────────────┼──────────────────────────────────────────────────────┘
              │ spawn agent (cwd=project) + Outreach MCP (stdio)
              ▼
   ┌─ agent turn ─┐   MCP verbs    ┌─ board.db (SQLite) ───────────┐
   │ + Outreach   │◄──────────────►│ stages · leads · events ·     │
   │ MCP (stdio)  │  commit()/read │ actors · board_config · rules │
   └──────────────┘                └───────────────┬───────────────┘
                                                    │ Tauri cmds / poll
                                                    ▼
                              ┌─ Runtime: kanban window (React) ──┐
                              │ columns = stages, cards = leads    │
                              │ drag-to-move → moveLead()          │
                              └────────────────────────────────────┘
```

## Storage engine — SQLite in the Rust backend

One DB per project: `board.db` in the project folder. Chosen over JSON files so
§15's guarantees (foreign keys, single-transaction remaps, optimistic
concurrency, one-event-per-lead) come from the engine rather than being
hand-rolled. Six tables:

### `stages` (§15.1 verbatim)

```sql
create table stages (
  id         text primary key,   -- STABLE, immutable: 'ready_to_contact'
  label      text not null,      -- mutable: "Ready to contact" → "Warm"
  position   int  not null,
  color      text,
  retired_at text,               -- retirement, never deletion (ISO-8601)
  created_at text not null,
  created_by text not null references actors(id),
  version    int  not null default 1
);
```

Cards store the **id**. The UI renders the **label**. Rules reference the **id**.
Renaming a column is a one-row `UPDATE stages SET label = …` — zero cards
touched, instantly reversible. **Retired ids are never reused** (the primary key
enforces it; retirement keeps the row), so historical events never silently
change meaning.

### `leads` (the card)

```sql
create table leads (
  id          text primary key,
  stage       text not null references stages(id),
  name        text not null,
  org         text,
  context     text not null default '{}',  -- JSON: accumulated research
  messages    text not null default '[]',  -- JSON: drafted/sent messages
  transcripts text not null default '[]',  -- JSON: call summaries + raw
  created_at  text not null,
  updated_at  text not null,
  version     int  not null default 1      -- optimistic concurrency (§15.5)
);
```

`context` is structured so nothing is lost on ingest: facts accumulate with
provenance; contradictions are surfaced, not overwritten (see
[Ingestion](#research-ingestion)).

### `events` (the append-only log — source of truth for reversibility)

```sql
create table events (
  seq        integer primary key autoincrement,
  type       text not null,   -- 'lead.stage','lead.context','stage.created',…
  entity_id  text not null,
  before     text,            -- JSON
  after      text,            -- JSON
  verb       text not null,   -- 'remapStage','moveLead','appendContext',…
  actor      text not null references actors(id),
  created_at text not null
);
```

**One event per lead**, never one per batch (§15.3). This is what makes
`revert(seq)` restore every card to exactly where it was, and it keeps reporting
honest — a stage remap reads as one administrative move per card, not as N
people advancing the pipeline.

### `actors` (§15.6 — self-registered, no roles)

```sql
create table actors (
  id         text primary key,
  label      text not null,
  created_at text not null
);
```

### `board_config` (singleton, versioned)

Board name, `created_by` provenance (shown in Settings, **enforces nothing** —
§15.6), `version` for optimistic concurrency.

### `rules` (§15.4 — the failure mode that actually bites)

```sql
create table rules (
  id         text primary key,
  name       text not null,
  enabled    int  not null default 1,
  conditions text not null,  -- JSON referencing stage IDS
  action     text not null
);
```

Retiring or merging a stage that any **enabled** rule references is **blocked**
until the rule is remapped or explicitly disabled. Card data is safe by
construction; rules are the thing that breaks silently, so this check matters
more than any permission model would.

## Core primitives

Everything is built on two functions; the verbs are thin wrappers.

- **`commit(event)`** — opens a transaction, applies the `after` state to the
  target row, appends the event to `events`, bumps the row's `version`. All
  writes go through it. On a version mismatch it fails loudly (§15.5:
  *"someone changed this — reload?"*), never silently clobbers.
- **`revert(seq)`** — walks events with `seq' > seq` in reverse, applies each
  `before`. Inherited undo for every operation, including stage remaps. Nothing
  new is needed for safety — the guarantee is inherited by every verb.

### `remapStage` — the only destructive-*looking* verb, and it isn't

```
remapStage(from, to, { filter?, dryRun?, retireSource? })
  -> { affected, leadIds }
```

- **One event per lead**, one transaction — all leads move or none do.
- **Never deletes a stage** — `retireSource` sets `retired_at`. Retired stages
  don't render as columns but still resolve for every historical event and every
  lead that ever sat in one.
- **`dryRun: true`** returns the count without writing. The agent calls this
  first, reports *"this will move 23 cards from Contacted to Warm"*, and waits.
- Ops 5–7 from §15.2 (retire-with-cards, merge, split) are all the **same**
  remap primitive; a split just passes a `filter`.

## Agent interface — the Outreach MCP server

A local MCP server (stdio, spawned with the agent like brainstorm's excalidraw
MCP, enabled by default in the project) exposes the board as typed tools. Every
write goes through `commit()`.

**Stage verbs (§15.7):** `renameStage`, `reorderStages`, `addStage`,
`retireStage`, `remapStage`, `unretireStage`.

**Lead verbs:** `listLeads` / `getLead` (read), `addLead`, `moveLead(id, toStage)`,
`appendContext(id, research)` (merge, never overwrite), `draftMessage(id, msg)`,
`attachTranscript(id, raw, summary)`.

**Rule verbs:** `listRules` — so the agent can run the §15.4 check itself before
any retire/merge.

### Gates — enforced server-side (§15.6)

Gate on **blast radius and reversibility**, not on roles. No admin role, no
`board_owner`, no per-stage access control (see [Cut list](#cut-list)).

| Condition | Behaviour |
|---|---|
| No card data affected (rename / reorder / add / retire-empty) | just do it |
| Cards affected, N ≤ 5 | do it; return the `seq` for an undo toast |
| Cards affected, N > 5 | MCP returns `needsConfirm` with the count; agent must re-call with `confirmed: true` |
| Any **enabled** rule references the stage | **block** — return the rule names; require remap-or-disable first |
| Agent-initiated, any card impact | `dryRun` first, report the count in the terminal, require an explicit human "yes" |

The agent path gets the **same** gate as a UI action, not a stricter one — the
difference is only that a human should see the number before it happens.

## Research ingestion

Agent-driven and dryRun-gated. The user pastes research (prospect notes, a call
transcript, a reply) into the terminal or Chat. The agent then, per the
`SKILL.md` operating manual:

1. **Read before acting** — `listLeads` / `getLead` first; never assume board
   state.
2. **Identify** which lead(s) the research is about (match on name / org against
   existing leads).
3. **Match or create** — existing lead → enrich; genuinely new → propose
   `addLead`.
4. **Merge, never clobber** — `appendContext` *adds* to structured context;
   existing facts are preserved, new facts appended with provenance.
   Contradictions are **surfaced, not silently resolved**.
5. **Classify the document** — prospect research → context; call transcript →
   `attachTranscript` (raw kept + a generated summary); a reply / note → may
   imply a stage move.
6. **Propose stage moves** the research implies (e.g. "they replied positively"
   → suggest Contacted → Warm), but only through the dryRun / confirm gate.
7. **Report and wait** — *"This adds context to 3 leads, creates 1 new lead, and
   would move 1 card. Proceed?"* — an explicit human "yes" before any card
   change is committed.

**Losing nothing is non-negotiable.** Every ingest is additive. When the agent
is unsure whether something is new, it keeps both and flags the ambiguity; it
never deletes a lead's history to reconcile an update. Drafted messages are
stored on the lead and **never auto-sent**.

No watched inbox folder in v1 — paste-into-terminal is the only ingestion
entry point.

## Skill installation

Same mechanism as remit's `skill.rs`:

- `apps/outreach/src-tauri/skills/outreach/SKILL.md` — the operating manual,
  compiled in via `include_str!`.
- Materialized to `~/.outreach/skills-bundle/outreach/`, **symlinked** into the
  project's `.claude/skills/outreach/` (so an Outreach update propagates to every
  existing project on next open), plus a project-root `CLAUDE.md` pointing the
  agent at it.

`SKILL.md` teaches: read-before-acting, the ingestion reconciliation rules
above, drafting / summarizing, "maintain state, lose nothing", and the §15 stage
editing safety rules (stable id vs label; rule check before retire/merge; dryRun
on remaps).

## Board UI (Runtime)

A React kanban app served locally and opened in its **own tiled window** (like
brainstorm's canvas — avoids the WKWebView cross-origin storage partitioning
that made an embedded second surface blank). Columns = stages (ordered by
`position`, retired stages hidden), cards = leads. It reads SQLite via Tauri
commands and polls / subscribes for live updates.

Per §15.5, config changes emit events too (`stage.created`, `stage.renamed`,
`stage.retired`, `stage.remapped`), so the board picks them up like anything
else — no separate config sync. **A card whose `stage` id is unknown to the
current client (stale config) renders in an `Unsorted` holding column** — never
dropped, never coerced to a default stage. Drag-to-move calls `moveLead`.

## Note on §6.2 (task state machine)

§15.6 warns to keep user-editable *lead stages* separate from a fixed *task
state machine* (the seven states in §6.2/§6.3). Outreach uses **one entity — a
lead IS the card** — so there is **no separate fixed task-state machine**; the
only states are user-editable stages. §15.6's warning is satisfied trivially:
there is nothing to keep the stages apart *from*. This is a deliberate
simplification and is recorded here so a future reader doesn't reintroduce a
second state model by accident.

## Phased build plan

Six phases, each independently verifiable. The board is usable after Phase 3;
the agent operates it from Phase 5.

**Phase 0 — Scaffold.** Copy the brainstorm app skeleton to `apps/outreach/`
(Tauri config, `package.json`, `vite.config.ts`, the agent infra:
`src/agent-chat/`, `src/terminal.tsx`, Rust `pty.rs` / `agent_chat.rs` /
`agents.rs` / `settings.rs`, `projects_*` commands). Rename identifiers
brainstorm → outreach.
*Verify:* app launches, boards-list entry screen shows, terminal panel runs a
login shell scoped to the project folder.

**Phase 1 — SQLite data layer (Rust).** Add `rusqlite`. Schema for all six
tables. `commit(event)` and `revert(seq)` as transactions. Bootstrap seeds
default stages as rows (§3.1 delta) and self-registers an actor.
*Verify (Rust unit tests):* commit writes exactly one event and bumps version;
revert restores `before`; a retired id cannot be reused; an optimistic-
concurrency conflict is detected and fails loudly.

**Phase 2 — Board verbs + gates (Rust).** All §15.7 stage verbs, the lead verbs,
`remapStage` with `dryRun` / `retireSource`, and the §15.4 rule check + §15.6
blast-radius gates.
*Verify (integration test — the §15.8 acceptance test):* create a stage, move
four cards into it, rename it twice, reorder it, then merge it into another
stage. Confirm every card lands in the right place; `revert(seq)` on the merge
returns all four to the original stage; a rule referencing the merged stage
blocked the merge until it was remapped.

**Phase 3 — Kanban runtime (React) + live window.** The board React app served
locally, opened in its own tiled window. Reads SQLite via Tauri commands;
polls / subscribes for live updates (unknown stage id → `Unsorted`; never drop a
card). Drag-to-move calls `moveLead`.
*Verify:* run the app, create leads, drag between columns, confirm persistence
across reopen and the `Unsorted` fallback for a stale stage id.

**Phase 4 — Properties panel.** Lead inspector (context / messages / transcripts
of the selected card) + Settings (stages with stable ids in small type,
`created_by` provenance, rule list).
*Verify:* select a card and see its full context; rename a stage in Settings and
watch the board window reflect it within one poll interval.

**Phase 5 — Outreach MCP server + skill.** MCP server exposing the verbs as
tools (enforcing the same gates). `SKILL.md` operating manual + `skill.rs`
installer + project `CLAUDE.md`. Registered so it is enabled by default like
brainstorm's excalidraw MCP.
*Verify:* from the terminal, the agent lists leads, adds one, ingests a pasted
research blob (matches / merges / dryRun / reports / waits), and attaches a
transcript summary — nothing lost, gates fire, human "yes" required before card
changes commit.

**Phase 6 — Catalog + docs.** `store-catalog/outreach.json` entry.
*Verify:* the app appears in the store catalog; spec docs committed.

## Pipeline model (§15)

For traceability, the §15 delta is folded into Outreach as follows. Because
`PIPELINE-SPEC-v3.md` does not exist, these deltas are realized *as* the Outreach
data model rather than as edits to an external document:

- **§4 delta** (remove `stages` from `board_config`; add the `stages` table and
  the `leads.stage` FK) → realized in [Storage engine](#storage-engine--sqlite-in-the-rust-backend).
- **§3.1 delta** (board bootstrap seeds default stages as rows, not jsonb) →
  Phase 1 bootstrap.
- **§6.2 delta** (no change; task states are app-level and fixed) → moot for
  Outreach; see [Note on §6.2](#note-on-§62-task-state-machine).
- **§10 delta** (add the six §15.7 verbs to the manifest) → the MCP verb set.
- **§13 / cut list** — see below.

### Cut list

Explicitly **not** built (§13 + §15.6):

- Role-based permissions / admin roles / a `board_owner` column.
- Per-stage access control.
- DDL migrations triggered from the UI.
- A watched inbox folder for ingestion (v1 is paste-only).

## Open questions

None blocking. Deferred to implementation:

- Exact `context` JSON shape (fact list with provenance vs. free-form sections)
  — decided in Phase 1 against the first real ingestion example.
- Poll interval vs. a SQLite change-notification channel for board liveness —
  start with polling (Phase 3), revisit if it feels laggy.
```