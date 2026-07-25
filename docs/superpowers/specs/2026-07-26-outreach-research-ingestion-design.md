# Outreach Research Ingestion (v1) — Design

**Date:** 2026-07-26
**Status:** Approved

## Goal

Let a user drop research files into a per-board folder and have the terminal
agent read them on command, enriching leads through the existing safe
paste-flow. Deliberately minimal: no watcher, no app-side PDF extraction, no
file-list UI.

## Context

- Each board is a folder: `~/Outreach Projects/<board>/` containing `board.db`,
  a `.claude/` skill bundle, `CLAUDE.md`, `.mcp.json`.
- The terminal agent runs with that board folder as its cwd.
- The app already has a research-ingestion *concept*: `SKILL.md` §"Ingesting
  pasted research" tells the agent to merge pasted text into leads additively
  via the `outreach` MCP verbs (`appendContext`, `attachTranscript`), never
  clobbering, always proposing stage moves through the safety gates and waiting
  for a human "yes". This feature extends that flow from pasted text to files
  on disk.

## Decisions (from brainstorming)

- **Trigger:** the human tells the agent (e.g. "ingest the new research"). No
  folder watcher, no auto-detection.
- **Add files:** a single "Open research folder" button reveals `research/` in
  Finder; the user drags files in. No picker, no file list.
- **File types:** text-like (`.txt`, `.md`, `.csv`, `.json`) read directly;
  `.pdf` handled by the agent's own tools (no app-side extraction). If the agent
  can't extract a PDF, it says so and skips it.
- **Skip-already-done:** the agent maintains a plain-text ledger
  `research/.ingested` (one filename per line). Not tracked in the DB.

## Architecture

Three small changes, no new subsystems:

### a) Rust — folder + reveal command
- Ensure `research/` exists alongside `board.db` when a board is created/opened
  (`fs::create_dir_all`).
- New Tauri command `research_folder_open`: resolve the active project's
  `research/` dir, create it if missing, reveal it in Finder via the opener
  plugin. Mirrors the existing `board_window_open` command pattern. Returns
  `Result<(), String>`.

### b) Frontend — the button
- `api.ts`: `openResearchFolder = () => call<void>("research_folder_open")`.
- `Settings.tsx`: a "Research" section with a one-line description and an
  "Open research folder" button that calls `openResearchFolder`.

### c) SKILL.md — "Ingesting research files" section
Prose added to `src-tauri/skills/outreach/SKILL.md`, sibling to the existing
"Ingesting pasted research" section. Tells the agent:
1. Research files live in `research/` (relative to cwd).
2. On "ingest research", list `research/`, skip filenames already in
   `research/.ingested`.
3. Read `.txt/.md/.csv/.json` directly; extract `.pdf` with own tools, skip if
   unable.
4. Feed contents into the existing paste-flow (match/create → `appendContext`
   merge-not-clobber → classify transcript vs note → propose stage moves →
   report and wait for "yes"). Safety gates unchanged.
5. After processing a file, append its name to `research/.ingested`.

## Data flow

```
User: drag files → ~/Outreach Projects/<board>/research/
User (to agent): "ingest the new research"
Agent: list research/ → skip names in research/.ingested → read each
       → existing paste-flow (appendContext / attachTranscript)
       → propose stage moves → report → wait for user "yes"
       → append processed filenames to research/.ingested
```

## Testing

- **Rust:** unit test that the active-project `research/` path resolves
  correctly and is created when missing. The Finder reveal (OS call) is not
  unit-tested, consistent with `board_window_open`.
- **Frontend:** Settings renders the Research section + button; clicking calls
  `openResearchFolder`. Also fix the 2 pre-existing prop errors in
  `Settings.test.tsx` (missing `onSaveActor`/`onSaveDbUrl`).
- **SKILL:** no automated test (prose); existing bundle test still asserts
  SKILL.md is first.

## Not in v1 (YAGNI)

- No folder watcher / auto-detection.
- No app-side PDF extraction.
- No file-list UI, add-files picker, or per-file status.
- No DB tracking of processed files.
