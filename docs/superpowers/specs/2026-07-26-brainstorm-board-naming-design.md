# Brainstorm board naming + Boards navigation — design

**Date:** 2026-07-26
**Status:** Approved

## Goal

Boards get real, editable names. The board view gets a `Boards` button to return
to the list, and the app name moves out of the collision zone under the
DreamStore title bar. The boards list gains per-item rename and delete via a
hover-revealed 3-dot menu, each backed by its own modal.

## Problem

1. **Boards have no name of their own.** `projects_list` derives `name` from the
   folder name, which is a slug of whatever was typed at creation
   (`brainstorm-session-6`). There is no way to rename a board.
2. **No way back to the list.** Once a board opens, the only exit is quitting the
   app; `BrainstormApp` sets `project` state and never clears it.
3. **The title collides.** `main.tsx` centers "Brainstorm Canvas" absolutely
   inside the title bar. The agent-panel window is narrow (~380px), so the
   centered label overlaps the `DreamStore` button — visible in the user's
   screenshot as "DBrainstorm Canvas".
4. **Delete has no confirmation.** A single click on the trash icon moves the
   board to the Trash immediately.

## Where the name is stored

The display name lives in a **sibling file, `board-name.txt`** — one line of
UTF-8 in the project directory, next to `board.json`.

Not in `board.json`. That file is rewritten wholesale by autosave: `saveBoard`
builds a fresh scene from `emptyScene()` plus the live elements and `save_doc`s
the whole thing, roughly once a second during activity. A `name` field there
would be erased by the next autosave after any rename.

The folder is never renamed. Moving it would change the board's path, which is
the identity key for the recents map, the active-project state, the watcher, and
the `.mcp.json` the canvas server rewrites per open. A rename is a metadata edit;
it must not be able to break an open board.

**Fallback:** a board with no `board-name.txt` shows its folder name, exactly as
today. Existing boards therefore need no migration and display unchanged until
renamed.

## Backend

`projects.rs`:

- `const NAME_FILENAME: &str = "board-name.txt"`
- `read_display_name(dir) -> Option<String>` — trimmed first line; `None` if
  missing, unreadable, or blank.
- `display_name(dir) -> String` — `read_display_name` or the folder name.
- `projects_list` and `project_open` use `display_name` for `ProjectMeta.name`.
- `projects_create` writes `board-name.txt` with the name as typed, so the
  display name preserves capitalization and spacing that the folder slug loses.
- **New command `project_rename(path, name)`** → `ProjectMeta`. Rejects a blank
  name. Rejects a path that is not an existing board (no `board.json`), so a
  bad path can't create a stray file. Writes the file, returns fresh meta.

Registered in `lib.rs` alongside the other project commands.

## Frontend

### Title bar (`main.tsx`)

The absolutely-centered label is removed. `TitleBar` takes an optional
`secondRow` slot rendered as a second row below the drag row. Row one stays the
drag region with the DreamStore button; row two holds board chrome.

`main.tsx` owns no board state, so the second row is composed where that state
lives — `BrainstormApp` renders it and `main.tsx` passes it through.

### Second row (board view only)

```
┌────────────────────────────────────┐
│ ⠿ DreamStore                       │  drag row
├────────────────────────────────────┤
│ [‹ Boards]  Brainstorm Canvas      │
├────────────────────────────────────┤
│  Mode  [Prompted] [Continuous]     │
└────────────────────────────────────┘
```

Left-aligned, so it cannot collide at any window width. The row renders only
when a board is open — on the boards list there is nowhere to go back to, and
that screen has its own "Brainstorm boards" heading.

`Boards` closes the board window, calls `project_close` (clearing the Rust-side
active project and its watcher) and clears `project` state, returning to the
list. The list refetches on mount, so a rename made in the menu is reflected on
return.

### Two bugs this navigation exposes

Board switching was previously impossible — a board could only be opened once, at
startup — so two pieces of code carried an "the canvas server is always empty"
assumption that had never been wrong before:

1. **The board window stayed open.** Nothing closed it, leaving the board you
   just left floating on screen next to the list. Fixed by calling the existing
   `brainstorm_canvas_close_window` in `backToBoards`.

2. **`restoreBoard` returned early for an empty board** ("no-op if there's
   nothing to restore"). Safe at startup; silent data corruption once you can
   switch boards — opening an empty board left the *previous* board's elements on
   screen, and autosave then wrote those foreign elements into the empty board's
   `board.json`. Fixed to always sync: `/api/elements/sync` clears before
   writing, so syncing `[]` is what actively clears the canvas. Two existing
   tests asserted the old no-op behaviour and were replaced.

### Boards list menu

Each row gets a 3-dot button, `opacity-0 group-hover:opacity-100` — the idiom
already used by the existing trash button, which this replaces. The dropdown has
`Rename…` and `Delete…`, each opening its own modal:

- **Rename modal** — text input prefilled with the current name, `Cancel` /
  `Save`. Save is disabled while blank. Enter submits.
- **Delete modal** — names the board, states it moves to the Trash (accurate:
  `project_delete` uses `trash::delete`, so it is recoverable), `Cancel` /
  destructive `Delete board`.

Both modals stay mounted with a nullable target so closing doesn't unmount
mid-transition.

### New components

`components/ui/dialog.tsx` and `components/ui/dropdown-menu.tsx` — standard
shadcn wrappers over `radix-ui`'s `Dialog` and `DropdownMenu`, matching the
existing `select.tsx` idiom (`data-slot`, `cn`, Portal + Overlay). `radix-ui` is
already a dependency; no new packages.

`BoardsList` moves out of `BrainstormApp.tsx` into its own file — the menu and
two modals roughly double its size, and `BrainstormApp.tsx` was already carrying
the editor.

### Test environment

Radix's dropdown and dialog open on `pointerdown` and guard on `event.button` /
`pointerType`, but jsdom implements no Pointer Events API at all (no
`PointerEvent`, no `hasPointerCapture`, no `scrollIntoView`), so a trigger click
is silently ignored and the menu never opens. `vitest.setup.ts` gains polyfills
for these, alongside the `ResizeObserver` polyfill already there for the same
reason.

## Testing

**Rust** (`projects.rs` tests): missing name file falls back to the folder name;
a written name is read back; blank/whitespace-only file falls back; rename
rejects a blank name; rename rejects a directory without `board.json`; create
writes the display name as typed.

**Frontend** (`__tests__/BrainstormApp.test.tsx`): the list renders the display
name; the 3-dot menu opens; rename invokes `project_rename` with the new name and
refreshes; delete confirms before invoking `project_delete`; cancel invokes
nothing; `Boards` invokes `project_close` and returns to the list.

## Out of scope

Renaming from inside the board view (the second row shows the app name, not an
editable board title). Sorting or searching the list. Duplicating boards.
