# KeepDiggin spike — design

A research-spike spec for turning KineticType's substrate into a
framework called **KeepDiggin**: a desktop runtime for apps where the
agent is a first-class user. This document is both the manifesto and
the audit. No production refactor follows from it — the deliverable
is the spec plus the file-by-file audit in Section 5.

**Vocabulary:**

- **KeepDiggin** — the framework / runtime / brand. Lowercase
  everywhere terminal-facing (`keepdiggin` package, `.keepdiggin/`
  project directory, `KEEPDIGGIN=1` env). Camel-case
  ("KeepDiggin") only in prose and brand surfaces. The name evokes
  the GSD attitude: the agent keeps digging at the task on your
  behalf, turn after turn, until it's done.
- **Canvas plugin** — one app's contract with KeepDiggin. Codebase
  uses *canvas*; this spec uses both.
- **App** — an installable surface listed on the Square.
- **Square** — KeepDiggin's launcher home screen (the
  `editor/platform/Square.tsx` component today). It is *not* a
  synonym for the framework — KeepDiggin is the framework, the
  Square is one screen inside it.
- **Manifest** — the canvas plugin's declaration file.

---

## 1 — Thesis

**One-line pitch.** KeepDiggin is a desktop runtime for apps where
the agent is a first-class user. Every app ships its source with the
binary, runs inside an embedded terminal, exposes its UI as prompts,
and lets users redirect it mid-task. Indie devs ship one app and
inherit a distribution channel, a contributor (the agent), and a
tester corps (the users) for free.

**The shift it bets on.** Most desktop software is built as if the
user can only push pixels and click widgets. The agent era inverts
that: the highest-bandwidth way to use a tool is to describe what you
want, and the highest-bandwidth way to extend a tool is to edit its
source while it's running. KeepDiggin is built around that
inversion. The agent is not a sidebar — it is a way of using the
app, peer to the cursor.

**Five user-visible properties that come from the bet.**

1. **Open source by default.** The app's source is shipped with the
   binary and the agent has read+write access to it. The agent can
   read why something behaves a way and explain it, can propose
   patches in-conversation, can hot-edit non-load-bearing files (skill
   content, prompts, color tokens) without a rebuild. Users become
   contributors the moment they say *"why does it do that — change
   it."*
2. **Prompts are a first-class input mode**, not a chat box bolted
   on. The agent can do anything a human can do with the UI (the app
   dev declares verbs; KeepDiggin wires them as tools), see
   everything the human sees (preview snapshot + structured state),
   and read everything the runtime emits (console + network +
   errors). Users alternate fluidly: drag a slider, then say "make
   the rest of the track follow that".
3. **State is a file you can read.** Every app has one canonical
   state file (whatever schema the app defines; e.g. KineticType's
   `story.json`). KeepDiggin watches it, validates it, hot-reloads
   the preview from it, and versions it. The agent edits this file.
   The user can read it. The two can never disagree about "what is
   the project right now".
4. **Time-travel is free.** Because state is one validated file,
   KeepDiggin keeps a content-addressed history of every change.
   The agent can branch, the user can rewind, both can diff. "Agent
   as contributor" stays safe — nothing the agent does is
   irreversible.
5. **Distribution is part of the runtime.** Apps install into the
   Square (browse → install → open) or ship standalone (one .app,
   one binary, no Square). Indie devs get discovery without losing
   the ability to ship a polished standalone. Users get one place to
   find new tools without being locked in.

**Who wins if this works.**

- *Indie builders* — ship one focused app, inherit terminal + agent
  contract + preview + Square + community. KeepDiggin absorbs the
  bottom 70% of "make a desktop app" so the dev can spend 100% on
  the magic.
- *Users* — get tools that feel alive: the agent can drive them, the
  source is right there, the next prompt can reshape them.
- *Agents* — get a consistent contract across every app in the
  ecosystem: same verbs of "observe / act / read state / write state
  / introspect tools / read memory." The skill an agent loads on
  entering app X is structurally identical to the skill for app Y;
  only verbs and schema differ.

**What KeepDiggin is not.**

- Not a generic Tauri replacement. It is opinionated for one app
  shape (one watched state file + one live preview + one agent + one
  terminal).
- Not a SaaS. Runtime is local; agent is local (claude code, codex,
  etc.); state files are local.
- Not an app store with review/curation/payments in V1. The Square
  is a registry + installer; what apps do is on them.

---

## 2 — The four pillars

Every app on KeepDiggin inherits all four. The app dev declares
schemas + verbs; KeepDiggin does the wiring. The agent sees a
consistent contract across every app.

### 2.1 — Observe (see preview, read logs)

The agent can look at the running app the same way a user does, plus
read the firehose underneath.

Two tools KeepDiggin auto-provides:

- `observe.snapshot()` → `{ screenshot, view, ts }`. Screenshot is a
  real bitmap of the preview surface. `view` is whatever the app dev
  declares in their manifest's `snapshot()` function — typically the
  same data that drives the UI (selection, playhead, visible
  elements, current route). Tight: under 50KB JSON per call.
- `observe.logs({ since?, level?, source?, limit? })` and
  `observe.network({ since?, status?, urlIncludes?, limit? })` —
  stackpack-debug style. Captured by KeepDiggin-level
  instrumentation in the preview iframe that runs before app code
  (no opt-in). Network capture includes URL, method, status,
  duration, sizes — not bodies by default (privacy guardrail; app
  dev opts body capture in per route).

**Why both.** Screenshot is what the user sees; structured snapshot
is what the agent can *reason* about. Logs are what the user *can't*
see — the agent's edge over a sighted human.

**Cost shape.** Snapshot is cheap; agents call it freely. Logs are
an append-only ring buffer (last ~5MB per app under
`.keepdiggin/logs/`); the tool reads slices, agent never gets the
whole buffer.

### 2.2 — Act (prompt-driven UI verbs + first-class user)

The agent can do anything a human user can do, by calling typed
tools. Two layers — the second is what makes the agent a first-class
user, not a remote control.

**Layer A: declared verbs.** The app dev declares a JSON schema of
high-intent verbs. Example for KineticType: `{ selectBeat: { index:
int }, setColor: { hex: string }, addBeat: { kind, durationSeconds,
... } }`. KeepDiggin wires each verb as a typed agent tool with arg
validation. App dev's runtime handler runs the verb against UI state.

**Layer B: low-level navigation primitives.** A fixed, app-agnostic
set of "be the user" tools that work on any app by treating its
preview surface as a navigable DOM-like tree:

- `nav.route(name)` — navigate to a named route the app declared.
- `nav.click(stableId)` / `nav.fill(stableId, value)` /
  `nav.read(stableId)` — Playwright-shaped primitives; selectors are
  stable test-id-style attributes the app dev sprinkles via
  `useStableId("color-input")`. Not raw DOM selectors — those rot.
- `nav.workflow([step, step, ...])` — atomic batch: run N steps,
  snapshot once at the end, roll back if any step fails. Lets the
  agent set up a multi-step interaction without the user watching
  the screen flicker.

**Why both layers.** Verbs are the right abstraction for things the
app dev has thought through (`addBeat` should auto-place on the next
track). Nav primitives are the escape hatch for everything else —
including things the app dev didn't anticipate. An indie dev with
five verbs gets the same agent superpower as a deep app with fifty
verbs; the difference is verb ergonomics, not capability.

**Read-back, not just write.** Both layers can read data back.
`nav.read("#beat-list")` returns the rendered list; verbs return a
`result` payload. The agent can do read-only introspection of the UI
without changing state — required for "look at this and tell me
what's wrong" workflows.

### 2.3 — State (one watched file, schema-validated, time-traveled)

Generalizes KineticType's `story.json` contract. The single most
important seam in KeepDiggin.

**The contract.** Each app declares:

- A canonical filename (`story.json`, `scene.json`, `palette.json`).
- A Zod schema for the file.
- A `migrate(oldVersion, oldData) → newData` function for schema
  evolution.

KeepDiggin:

- Watches the file (~300ms debounced, same as today's KineticType).
- Validates on every write; invalid writes are *rejected* and
  reported to the agent's tool result (not silently mangled).
- Hot-reloads the preview component with the new state.
- Stores every accepted write in a content-addressed log under
  `.keepdiggin/history/` (sha-named blobs + a thin index). Default
  retention: last 200 versions per project. Not a git repo — a flat
  append-only log; cheaper, no commit ceremony.

**Three agent tools, all built on the same log:**

- `state.read()` — current validated state.
- `state.write({ patch })` — JSON Patch (RFC 6902) applied to
  current state; validated; history entry written; preview reloads.
  Patches not full rewrites: smaller diffs, less context burn,
  fewer accidents.
- `state.history({ limit? })` / `state.diff(a, b)` /
  `state.revert(versionId)` / `state.branch(versionId, name)` /
  `state.checkout(name)` / `state.merge(name)` / `state.discard(name)`
  — list, diff, revert, branch. Branches are first-class: agent can
  `branch("experiment-1")`, make 20 patches, then either `merge` or
  `discard`. Lets the agent try things without the user watching
  every intermediate frame fly by.

**Why JSON Patch.** Agents are bad at producing valid full-document
rewrites against a schema; they are good at producing small diffs.
Patches force the agent to think in deltas — which is also how a
thoughtful human collaborator edits. Failed patches return a
structured error to the tool, and the agent can correct in one turn
instead of retrying the whole document.

### 2.4 — Identity (auto-skill + introspection + memory)

Every app gets a consistent agent-facing identity for free. No more
hand-writing SKILL.md per app.

**Auto-injected routing skill.** When a project opens, KeepDiggin
generates `.claude/skills/<app-id>/SKILL.md` from the app's manifest.
The skill is structurally identical across apps — only the verbs,
schema, and snapshot shape vary. The app dev may add domain-specific
knowledge files alongside (the KineticType pattern of
`typography-system.md`, `motion-design.md`, etc.) — but the routing
skill itself is generated, not authored.

**Introspection tool.** `introspect.capabilities()` returns the full
live tool catalog the agent has access to right now: every verb,
every nav route, the state schema, the snapshot shape, the memory
key list. The agent can call this any time — useful when uncertain,
when the app changed mid-session (hot-update), or when a fresh agent
picks up a paused session.

**Per-app memory.** `memory.get(key)` / `memory.set(key, value)` /
`memory.list()` / `memory.delete(key)`. Persisted per project under
`.keepdiggin/memory.json`. Two crucial properties:

- *User-visible.* The agent's memory is not a black box; an app can
  surface it in its own UI (KeepDiggin provides `memory.*` as a
  capability; the app provides the view).
- *App-scoped, project-scoped.* Memory in KineticType project A is
  invisible to KineticType project B and to other apps. No cross-app
  leaks.

---

## 3 — The canvas plugin (what an app dev declares)

An app is three files plus an icon. That's the whole surface.

```
my-app/
├── keepdiggin.manifest.ts     # what this app is
├── preview.tsx                # what the user sees
├── runtime.ts                 # how verbs change state
└── icon.png                   # 512×512, square
```

No fourth file. No "configure your build." No Rust unless the app
dev opts in (3.5). An agent should be able to read these three files
and fully understand the app.

> **Design constraint:** KeepDiggin is optimized for an agent to
> author apps in it, not a human. A human reads the manifest to
> understand what the agent built; the manifest is written by the
> agent. Implications: declarative, deterministic, narrow types,
> explicit names, no clever metaprogramming, no magical inference.
> Two apps built by two agents look structurally identical.

### 3.1 — The manifest

```ts
// keepdiggin.manifest.ts
import { defineApp } from "keepdiggin";
import { z } from "zod";

export const StoryState = z.object({ /* app's schema */ });

export default defineApp({
  id: "kinetic-type",
  name: "Kinetic Type",
  version: "1.0.0",
  icon: "./icon.png",

  state: {
    file: "story.json",
    schema: StoryState,
    migrate: (old) => old,
    initial: () => ({ /* empty state */ }),
  },

  verbs: {
    selectBeat:   { args: z.object({ index: z.number().int().min(0) }) },
    setColor:     { args: z.object({ hex: z.string().regex(/^#[0-9a-f]{6}$/i) }) },
    addBeat:      { args: z.object({ kind: z.enum(["reveal","morph","shape"]),
                                     durationSeconds: z.number() }) },
  },

  routes: {
    "library":   { description: "browse asset library" },
    "panel":     { description: "edit selected beat's properties" },
    "timeline":  { description: "see the whole sequence" },
  },

  snapshot: (state, ui) => ({
    selectedBeatIndex: ui.selection,
    playheadSeconds: ui.playhead,
    visibleBeats: state.beats.length,
    currentRoute: ui.route,
  }),

  memory: {
    keys: ["userPalettePreference", "lastUsedFontFamily"],
  },

  preview: () => import("./preview"),
  runtime: () => import("./runtime"),
});
```

Every field maps 1:1 to a Pillar 1–4 capability. Nothing decorative.
An agent reading this file knows: what schema, what verbs, what
routes, what the snapshot looks like, what memory keys exist.
Nothing else is hidden. Zod schemas drive both TypeScript inference
and the runtime tools given to the agent.

### 3.2 — The preview

```tsx
// preview.tsx
import { useState, useUI, useStableId } from "keepdiggin";

export default function Preview() {
  const state = useState();
  const { selection, playhead, route } = useUI();
  const colorInputId = useStableId("color-input");

  return (
    <main data-route={route}>
      {/* the app's actual UI; one component, app dev's choice of stack */}
    </main>
  );
}
```

Three KeepDiggin-provided hooks:

- `useState()` — current validated state from the watched file.
  Re-renders on every accepted write (user, agent, or external
  editor).
- `useUI()` — local UI state (selection, playhead, route, anything
  non-persistent). Set by the runtime module.
- `useStableId(name)` — gives an element a stable test-id-style
  attribute KeepDiggin uses for `nav.click(selector)`. The agent's
  nav layer never depends on raw DOM structure; only on names the
  app dev explicitly exposes.

No router required. No state-management library required. App dev
brings whatever — Zustand, Redux, MobX, plain `useState` — but the
contract with KeepDiggin is just these three hooks.

### 3.3 — The runtime

```ts
// runtime.ts
import { defineRuntime } from "keepdiggin";

export default defineRuntime({
  ui: {
    initial: { selection: null, playhead: 0, route: "panel" },
  },

  verbs: {
    selectBeat: ({ args, ui }) => {
      ui.set({ selection: args.index });
    },

    setColor: ({ args, ui, patch }) => {
      if (ui.selection == null) return { error: "no beat selected" };
      patch.apply([{ op: "replace",
                     path: `/beats/${ui.selection}/color`,
                     value: args.hex }]);
    },

    addBeat: ({ args, state, patch }) => {
      patch.apply([{ op: "add", path: "/beats/-", value: makeBeat(args) }]);
      return { newIndex: state.beats.length };
    },
  },

  routes: {
    panel:    () => import("./views/Panel"),
    library:  () => import("./views/Library"),
    timeline: () => import("./views/Timeline"),
  },
});
```

One responsibility: translate verbs into state patches and UI
updates. Pure where possible. Verbs receive `{ args, ui, state,
patch }` and return `{ result?, error? }`. They never touch the file
system directly, never mount React components, never call agent
tools. The narrow signature means an agent can read a runtime file
and predict exactly what each verb does without reading the rest of
the codebase.

### 3.4 — Auto-generated agent skill

KeepDiggin reads the manifest at app-open time and writes
`.claude/skills/<app-id>/SKILL.md`. The content is mechanical — same
template for every app, interpolating from the manifest:

```
---
name: <app-id>
description: You are running inside <app name> on KeepDiggin. ...
---

# <app name>

You are inside <app name>, a KeepDiggin app. The user launched you
from KeepDiggin's embedded terminal. The state file is
`./<state.file>` — KeepDiggin watches it and refreshes the preview
within ~300ms of every write.

## Hard rules
- Read `.keepdiggin/prompt-mode` and `.keepdiggin/selection` FIRST
  on every turn. Apply replace | append | insert semantics.
- Write to state via `state.write({ patch })`. Patches only — never
  rewrite the file in full.
- For domain knowledge, load the sibling skill files in this dir.

## Your tools
  observe.snapshot()           — see the preview
  observe.logs / network       — read what the preview emits
  state.read / write / history — read & patch the state file
  verb.<name>(...)             — <one line per declared verb>
  nav.route(name)              — routes: <list from manifest>
  nav.click / fill / read(id)  — drive UI as the user; ids: <list>
  memory.get / set(key)        — keys: <list>
  introspect.capabilities()    — re-list everything above, live

## Worked example
<one paragraph the app dev supplied in the manifest>
```

The app dev provides one worked-example string in the manifest;
everything else is generated. Domain knowledge lives in a sibling
`skills/` directory the app dev maintains.

### 3.5 — Native extensions (optional)

If an app needs OS-level powers (custom file types, system menus,
hardware access), it ships a Rust crate alongside, named
`<app-id>-native`. KeepDiggin loads it at boot. The native crate
gets exactly one capability: register more verbs. No direct preview
DOM access, no direct file mutations, no KeepDiggin internals. The
verb shape is identical to TS verbs. The agent sees no difference.

Standalone .app bundles ship the dylib inside `Frameworks/`.
Square-installed apps load it from `~/Library/Application
Support/KeepDiggin/apps/<id>/native/`. Cross-platform dylib
stability is a real cost; the V1 escape hatch is "ship as
subprocess + local socket" for apps that don't want to take on ABI
risk. The decision is per-app, not framework-wide.

### 3.6 — What the contract deliberately doesn't have

- **No lifecycle hooks** (onOpen, onClose, onError, onUserIdle).
  KeepDiggin handles lifecycle. Apps are pure-state-plus-verbs.
- **No multi-window.** One preview surface per project.
- **No remote runtime.** State is local, agent is local, source is
  local.
- **No plugin-loads-plugin recursion.** Apps don't host apps.
- **No animation/transition declarations in the manifest.** Apps own
  their preview entirely.
- **No theming API for apps.** Each app draws its own UI;
  KeepDiggin's chrome (terminal, menubar, Square) is themed
  separately.

Every omission is load-bearing. Adding any of them makes the agent's
job harder. When an app dev wants one of these, the answer is "do it
inside your preview component."

---

## 4 — Distribution (Square + standalone)

Two distribution shapes for the same runtime. The runtime code is
identical in both; only the wrapper differs.

### 4.1 — Standalone

An app dev runs `npx keepdiggin build`. Out comes a single native
bundle:

```
Kinetic Type.app/
└── Contents/
    ├── Info.plist
    ├── MacOS/kinetic-type           # Tauri binary, statically linked
    ├── Resources/
    │   ├── app/                     # manifest + preview + runtime
    │   ├── skills/                  # domain skills
    │   ├── keepdiggin/              # KeepDiggin runtime
    │   └── icon.icns
    └── Frameworks/                  # optional native dylibs
```

Regular distributable .app/.exe/.AppImage. Users double-click;
KeepDiggin boots in single-app mode (no Square, just opens the most
recent project for this app, or its empty state). Updates ship via
KeepDiggin's auto-updater pointed at the app dev's release feed. No
infra required beyond GitHub releases.

**Why standalone exists** when the Square is the "real" channel:
branding, polish, control. An indie who wants `Kinetic Type.app` on
a user's dock — with their icon, their installer, their support
story — gets it without ceding identity to a hub. Steam exists;
itch.io exists. Both are needed.

### 4.2 — The Square (KeepDiggin's hub)

KeepDiggin's hub is itself a KeepDiggin app, distributed as
`KeepDiggin.app`. The home screen of that app is **the Square** — a
launcher, not a dashboard.

**Two states only:**

- **Square (home).** A grid of installed-app tiles plus a "Browse
  registry" entry to install more. That's it. No global project
  list, no global memory view, no global history.
- **Inside an app.** Once the user clicks a tile, the Square hands
  the central surface entirely to that app. The app decides what to
  show — a projects list (KineticType does), a blank canvas, a
  dashboard, an empty state with a prompt. KeepDiggin adds exactly
  **one** persistent affordance: a "← Square" control visible
  always, that returns to the home screen. The terminal pane stays
  mounted on the side (PTY survives the round-trip).

Per-app concerns (history, memory, settings) are inside-the-app
surfaces the app dev designs, not framework-level globals. If an
app wants to surface its history log, it builds that view using
KeepDiggin's `state.history()` API. KeepDiggin provides the
capability; the app owns the UI.

### 4.3 — What's shared, what's per-app

The split is the seam the audit in §5 validates. Anything in
"shared" must be app-agnostic; anything in "per-app" must be
declared in the contract.

**Shared (in `keepdiggin/`):** PTY pool + terminal pane (xterm);
file watcher; schema validator + patch applier + content-addressed
history store; preview iframe + observe instrumentation; verb tool
registry + agent tool plumbing; nav primitives; memory store; auto-
skill generator; project lifecycle commands; auto-updater.

**Per-app (in the app bundle):** manifest; preview component;
runtime module / verb handlers; domain skill files (optional); native
extension crate (optional); icon, README, license.

The agent doesn't see the split. From inside any app, the agent has
the same tool surface. The split exists so KeepDiggin can iterate
independently of the apps — when the framework adds a capability,
every installed app gets it for free.

### 4.4 — Registry + installation

The Square talks to a registry. V1 design:

- **No central review.** Anyone publishes. Registry just tracks
  what exists.
- **Identity signed.** Apps signed with the dev's keypair. First-
  time install warns "from unknown publisher" the way macOS does for
  unsigned .apps. Verified GitHub identities get a checkmark.
- **No payments.** Free apps only. Devs link out for donations or
  external commerce.
- **No CDN.** Registry stores manifest pointers; apps host from
  anywhere (GitHub releases, S3, their own server). Registry is a
  pointer file, not a CDN.

The registry being thin is deliberate. If KeepDiggin takes off,
expand. If it doesn't, the registry never grows into a liability.

### 4.5 — Project anatomy on disk

Every project, whether opened via Square or standalone, has the
same shape:

```
my-project/
├── story.json                    # canonical state file (app-defined name)
├── .keepdiggin/
│   ├── app-id                    # which app this project belongs to
│   ├── prompt-mode               # replace | append | insert
│   ├── selection                 # current selection
│   ├── memory.json               # per-project memory
│   ├── history/                  # content-addressed version log
│   │   ├── index.json
│   │   └── <sha256>.json
│   └── logs/                     # ring buffer for observe.logs
└── .claude/
    └── skills/<app-id>/
        ├── SKILL.md              # auto-generated routing skill
        ├── typography-system.md  # symlinked from app bundle
        └── ...
```

- `app-id` is the only per-project file that says which app owns
  this project. Lose it → the Square falls back to detecting from
  the state file's schema.
- `.claude/skills/` symlinks from the app bundle (KineticType
  pattern today), so app updates propagate to existing projects
  without rewriting per-project files.
- `.keepdiggin/` is `.gitignore`d by default. Users who want
  history committed opt in.

### 4.6 — Concurrency: agent and user

Both write to the state file. KeepDiggin already solves this for
KineticType via the `diff.ts` reconciliation pass; the V1 framework
generalizes it.

All writes go through KeepDiggin's patch applier, which serializes
them. The agent's `state.write(patch)` and the user's UI-triggered
writes (dragging a slider → verb call → patch) hit the same queue.
Conflicting writes within the same animation frame resolve by last-
write-wins on a per-path basis (JSON Patch paths are precise enough
that "user changed beat 0 color while agent added beat 3" doesn't
conflict).

The agent never observes a half-written state. The user never sees
flicker between the agent's intermediate steps if the agent uses
`state.branch()` for multi-step edits. The history log records every
accepted patch with an `author` field (`user` | `agent` | verb name)
so both sides see who did what.

---

## 5 — Extract-kit audit

The validation artifact: every file in `src-tauri/src/`, `editor/`,
and `src/kinetic/` (plus templates/skills/scripts) gets a label so
the KeepDiggin/app boundary stops being theoretical.

**Methodology.** Each file gets one of:

- **shell** — domain-agnostic substrate; stays in KeepDiggin when
  extracted; nothing about kinetic typography in here.
- **app** — kinetic-typography-specific; ships inside the
  kinetic-type app bundle.
- **split** — does both; the file needs to be cut on a clean line.

The codebase already names many of these seams: `editor/canvas.ts`,
`src-tauri/src/canvas.rs`, `editor/platform/`, `editor/shell.ts`,
`editor/runtime.ts`. The audit confirms and labels; it does not
invent. Note: `editor/platform/` is a folder name on disk and stays
as is — it doesn't need to be renamed to match the brand.

### 5.1 — `src-tauri/src/`

| File | Label | Notes |
|---|---|---|
| `main.rs` | shell | Tauri entry point. |
| `lib.rs` | shell | Command registry + `AppState`. Commands are domain-free. |
| `pty.rs` | shell | PTY pool. Already app-agnostic. |
| `watch.rs` | shell | File watcher. Generic. |
| `projects.rs` | shell | Project lifecycle. Calls `canvas::active()` for filename — clean seam already. |
| `prompt_mode.rs` | shell | Generic. |
| `selection.rs` | shell | Generic. |
| `window_state.rs` | shell | Generic. |
| `agents.rs` | shell | Detects installed coding agents. Generic. |
| `settings.rs` | shell | Default agent, skip-permissions. Generic. |
| `preview.rs` | shell | Cached preview MP4 serving. Concept is shell; the renderer that produces it is app. |
| `doc.rs` | shell | Generic save/load. `_story` aliases are kinetic veneer; delete post-extract. |
| `canvas.rs` | shell | The `Canvas` trait. The Rust shell/app seam. Keep the trait; move the kinetic impl out. |
| `skill.rs` | split | Generator infra is shell; embedded skill content (`include_str!("../skills/kinetic/...")`, kinetic `CLAUDE_MD`) is app. Shell ships `install_skill(bundle)`; app ships the bundle contents. |
| `video.rs` | app | YouTube download, video import. KineticType-specific. |

### 5.2 — `src-tauri/templates/` and `src-tauri/skills/kinetic/`

| Path | Label | Notes |
|---|---|---|
| `templates/seed-story.json` | app | Kinetic seed doc. Each canvas plugin ships its own. |
| `templates/rc.zsh` | shell | Per-project shell init. Generic enough for V1. |
| `skills/kinetic/*` (6 files) | app | All domain. Ship inside the kinetic-type bundle. |

### 5.3 — `src/kinetic/` and `src/typography/`

| File | Label | Notes |
|---|---|---|
| `src/kinetic/schema.ts` | app | Zod schema for `story.json`. |
| `src/kinetic/KineticStory.tsx` | app | The Remotion composition. |
| `src/kinetic/beats.tsx` | app | Beat renderers. |
| `src/kinetic/Background.tsx` | app | App. |
| `src/kinetic/glyphs.ts` | app | App. |
| `src/kinetic/providers/*` | app | App. |
| `src/typography/*` | app | All three. Used only by the kinetic composition. |

### 5.4 — `editor/`

| File | Label | Notes |
|---|---|---|
| `main.tsx` | shell | React root. |
| `index.html` | shell | Generic. |
| `App.tsx` | split | Mixes Square ↔ active-app routing, the kinetic 3-column shell, and project lifecycle wiring. Shell keeps routing + wiring; kinetic bundle owns the 3-column layout. Split line already visible — file calls `<KineticApp />`. |
| `platform/Square.tsx` | shell | The launcher. Per §4.2 stays a launcher, no global tabs. |
| `platform/apps.ts` | shell | App registry / manifest type. Contents (kinetic + mocks) move to registry; type stays. |
| `canvases/kinetic/index.tsx` | app | Kinetic canvas plugin's TS export. |
| `canvases/kinetic/KineticApp.tsx` | app | The whole kinetic editor world. |
| `canvas.ts` | shell | The TS canvas-plugin seam. Mirrors `canvas.rs`. |
| `shell.ts` | shell | `ShellActions` context. Already-named substrate API. |
| `runtime.ts` | shell | `isTauri()`. Generic. |
| `terminal.tsx` | shell | xterm + canvas renderer. |
| `ProjectsView.tsx` | split | Currently shell-level. Per §4.2, projects-as-screen is app-owned now. Move to `canvases/kinetic/`. |
| `PromptModeBar.tsx` | shell | Prompt mode is a KeepDiggin concept. |
| `PerfOverlay.tsx` | shell | Diagnostic. |
| `FirstRun.tsx` | shell | KeepDiggin onboarding. |
| `UndoMenu.tsx` | shell | When Pillar 3 time-travel lands, this is its UI. |
| `panel.tsx` | app | Kinetic properties panel. Move. |
| `timeline.tsx` | app | Kinetic timeline. Move. |
| `player.tsx` | app | Kinetic preview player. Move. |
| `controls.tsx` | app | Kinetic transport bar. Move. |
| `Library.tsx` | app | Kinetic library. Move. |
| `library/*` | app | Move. |
| `StarterCard.tsx` | app | Kinetic empty-state. Move. |
| `AddImage.tsx` / `AddVideo.tsx` | app | Move. |
| `diff.ts` | split | Reconciliation algo is generic; currently assumes kinetic schema's shape. Generalize. Once Pillar 3 patches land, this is a thin shell-side JSON-Patch merger. |
| `history.ts` | split | Local undo stack is generic; type managed is app-specific. Once Pillar 3's content-addressed history exists, this file is obsolete — delete after extract. |
| `selection.ts` | shell | Generic — selection is whatever the active canvas says it is. Type lives in shell. |
| `resize.ts` | shell | Generic draggable-divider primitive. |

### 5.5 — `scripts/`

| File | Label | Notes |
|---|---|---|
| `scripts/kinetic.ts` | app | The kinetic CLI. |
| `scripts/library-previews.ts` | app | App. |
| `scripts/project-preview.ts` | split | Orchestration (open project → render → cache MP4) is generic; renderer is app. Shell ships orchestrator + `preview.rs` cache; app ships the renderer command. |

### 5.6 — Tally

|  | files | LOC share (rough) |
|---|---|---|
| shell (→ KeepDiggin) | ~30 | 60–65% |
| app (→ kinetic-type bundle) | ~25 | 30% |
| split | 6 | 5–10% |

Healthier than expected. Only six files need surgery; everything
else falls cleanly on one side or the other. The boundary the
codebase has been building toward (`canvas.ts`, `canvas.rs`,
`editor/platform/`, `shell.ts`) already accounts for the lion's
share of the work.

### 5.7 — Findings

Three findings worth promoting to decisions (§7):

1. **KeepDiggin is already 60%+ extracted in place.** The remaining
   work isn't invention — it's relocation, naming the framework,
   and finishing the six split files.
2. **Pillar 3 (state with time-travel) deletes more code than it
   adds.** Generic JSON-Patch writes + content-addressed history
   obsolete `editor/history.ts` entirely and reduce `editor/diff.ts`
   to a thin shell-side patch merger. Net code goes down.
3. **The biggest unfinished seam is `App.tsx`.** Currently mixes
   Square routing, kinetic 3-column layout, and project wiring.
   The cleanest single change in a future refactor is to lift the
   kinetic-specific layout into `canvases/kinetic/KineticApp.tsx`
   (which already exists as a file) so `App.tsx` becomes ~50 lines
   of Square routing.

---

## 6 — The agent's view

What it looks like, inside an open project, from the agent's seat.

### 6.1 — What loads when the agent attaches

The user opens a project. KeepDiggin:

1. Resolves the project's canvas plugin (from
   `.keepdiggin/app-id`).
2. Writes/refreshes the auto-generated routing skill from the
   manifest.
3. Boots a PTY into the project root with `KEEPDIGGIN=1` and
   `KEEPDIGGIN_APP=<app-id>` in the env. The agent launches inside
   this PTY.
4. Mounts the preview component, installs observe instrumentation
   in its iframe, starts the watcher.

By the time the agent sees its first prompt, it has: a working
terminal, a routing skill listing its tools, a live preview, a state
file it can read/write, and a history log starting at version 0.

### 6.2 — Tool surface (full catalog)

Five namespaces, ~15 tools. Stable across every KeepDiggin app.

**`observe.*`** — `snapshot()`, `logs(...)`, `network(...)`.

**`state.*`** — `read()`, `write({ patch })`, `history(...)`,
`diff(a, b)`, `revert(versionId)`, `branch(versionId?, name)`,
`checkout(name)`, `merge(name)`, `discard(name)`.

**`verb.*`** — one tool per declared verb, args validated against
the manifest schema. The set is app-specific; agent learns it from
the routing skill and can refresh via `introspect.capabilities()`.

**`nav.*`** — `route(name)`, `click(stableId)`,
`fill(stableId, value)`, `read(stableId)`,
`workflow([step, ...])`.

**`memory.*`** — `list()`, `get(key)`, `set(key, value)`,
`delete(key)`.

**`introspect.*`** — `capabilities()` returns the full live tool
catalog (every verb, route, stable id, memory key, schema). The
"what do I have" tool.

### 6.3 — Patterns the agent learns by doing

Five patterns the routing skill doesn't spell out (framework-level),
but every KeepDiggin agent learns by doing them once. Shape how
Pillars 1–4 actually feel in practice.

1. **Look-before-leap.** Before any non-trivial change, call
   `observe.snapshot()`. The structured `view` tells the agent
   what's selected, what's on screen, what route the user is on.
   Cheap, prevents 80% of "agent edits the wrong thing" mistakes.
2. **Branch for experiments.** Multi-step edits go:
   `state.branch("experiment")` → N patches → `observe.snapshot()`
   → `merge` or `discard`. User doesn't see half-finished
   intermediate states unless agent surfaces them deliberately.
3. **Logs as ground truth.** If the user says "the morph looks
   wrong," the agent's first move is `observe.logs({ since:
   <render start>, level: "warn" })`. Render pipeline emits
   structured warnings the agent can read but the user can't.
4. **Workflows for "fill out this form."** Multi-step interactions
   (set duration → choose theme → add three beats) issue as one
   `nav.workflow([...])`. Atomic; one preview reflow at end; if
   any step fails the whole batch reverts.
5. **Memory for stable user preferences.** First time the user says
   "I like high contrast," agent stores
   `memory.set("palettePreference", "high-contrast")`. Subsequent
   palette tasks read memory first.

### 6.4 — What the agent can NOT do (intentionally)

- **Read or write outside the project root.** Filesystem sandboxed
  to project dir + agent's PTY home.
- **Bypass the schema.** Invalid patches return `error`; the file
  is not written.
- **Bypass the verb signatures.** Arg validation runs before the
  handler.
- **Mutate the preview iframe directly.** Reached only through
  `nav.*` and `verb.*`.
- **Install or remove apps.** App lifecycle is user-only.

This is the security/safety story for "agent has access to your
source." The agent reads everything, but writes only through narrow
audited channels.

---

## 7 — Decisions and non-goals

### 7.1 — Decisions

1. The framework is named **KeepDiggin**. Lowercase `keepdiggin`
   for package, `.keepdiggin/` for project directory, `KEEPDIGGIN=1`
   for env. Camel-case "KeepDiggin" only in prose and brand
   surfaces.
2. Hybrid distribution — Square + standalone. Same runtime,
   different wrappers.
3. The Square is launcher-only. No global tabs. Each app owns its
   inside-the-app surface; the only persistent KeepDiggin chrome is
   "← Square" + the terminal.
4. Three-file canvas contract: manifest + preview + runtime. Plus
   optional `skills/*.md` and optional Rust native crate.
5. JSON Patch for state writes. RFC 6902. Not full-doc rewrites.
6. Content-addressed history under `.keepdiggin/history/`. Append-
   only log, not git.
7. Stable IDs for nav primitives. App devs sprinkle
   `useStableId("name")`; KeepDiggin never uses raw DOM selectors.
8. Auto-generated routing skill. Hand-written domain skills
   (typography-system, motion-design, etc.) stay; routing skill
   itself is mechanical.
9. `.keepdiggin/` git-ignored by default. Opt-in for committed
   history.
10. Codebase vocabulary kept: "canvas plugin," "Square,"
    "manifest" — matches what `canvas.rs`, `editor/canvas.ts`,
    `editor/platform/`, `editor/shell.ts` already established. The
    "platform / substrate" placeholder vocabulary is replaced by
    "KeepDiggin" in prose; `editor/platform/` stays as a folder
    name.
11. Thin registry — pointer file; no CDN, no review, no payments.

### 7.2 — Non-goals for V1

- No mobile/web targets. Desktop only (macOS first).
- No multi-user / collab. Single-user, single-machine. No CRDT.
- No auth / SSO / RBAC.
- No remote agent. Local PTY only.
- No payments. Free apps only.
- No app review / curation.
- No plugin-loads-plugin.
- No theming API for apps.
- No multi-window per project.
- No history retention beyond ~200 versions per project. Content-
  addressed reference counting GCs old versions. Users who need
  forever-history use git on the state file.
- No body capture in `observe.network` by default. Opt-in per route
  by the app dev.

### 7.3 — Open questions deferred to writing-plans

The spec doesn't resolve these; the implementation plan will. Listed
explicitly so they don't sneak in as accidental decisions:

- Where native Rust extensions live in standalone vs Square mode
  (in-bundle vs `~/Library/Application Support/KeepDiggin/...`).
- Snapshot rate-limiting — framework-enforced or trusted to the
  agent.
- Verb return-shape consistency — `return { result }` vs side-
  effecting `patch.apply()`. Probably one signature, both
  available.
- Manifest hot-reload mid-session. Nice-to-have, not V1.
- Standalone .app auto-updater feed format. Sparkle XML? GitHub
  Releases? Both?

### 7.4 — Success criteria for the spike

The spike (this spec + the audit in §5) succeeds if all three are
true:

1. **The audit's "shell" pile makes structural sense without
   kinetic typography.** A reader who doesn't know KineticType
   would understand what KeepDiggin does from §5.1–§5.4.
2. **A hypothetical second canvas plugin is describable in one
   paragraph.** Pick a domain (e.g. "Markdown Slide Deck" — state
   is `slides.json` with `[{markdown, theme}]`; verbs are
   `addSlide`/`setTheme`/`reorder`; preview is a paginated MD
   renderer; routes are "deck" / "outline"). If the paragraph fits
   the contract without inventing new fields, the contract holds.
3. **None of the spec's claims depend on code that doesn't exist
   yet.** Pillars 1–4 map to either existing KineticType behavior
   or a clean extension of it. Verified:
   - Pillar 1 — observe instrumentation is new code; preview
     iframe + screenshot pipeline already exists.
   - Pillar 2 — verbs/nav are new code; stable IDs and the
     canvas/preview seam already exist.
   - Pillar 3 — patches/history are new code; `diff.ts` and
     `watch.rs` already exist and are 70% of the way there.
   - Pillar 4 — auto-skill generation is new code; per-project
     skill-writing infrastructure already exists in `skill.rs`.

---

## Appendix — Glossary alignment with codebase

| Spec term | Codebase term | Where in codebase |
|---|---|---|
| KeepDiggin (the framework) | the substrate / shell / "platform" placeholder | `editor/canvas.ts`, `src-tauri/src/canvas.rs`, `editor/shell.ts`, `editor/platform/` (folder) |
| canvas plugin | canvas | `Canvas` trait in `canvas.rs`; `activeCanvas` export in `editor/canvas.ts` |
| Square (the launcher screen) | Square | `editor/platform/Square.tsx` |
| app manifest | `AppManifest` | `editor/platform/apps.ts` |
| state file | doc / story | `editor/canvas.ts` (`docFilename`), `src-tauri/src/doc.rs` |
| auto-generated skill | per-project skill | `src-tauri/src/skill.rs` |
| watcher | `DocWatcher` | `src-tauri/src/watch.rs` |
| prompt mode | prompt mode | `src-tauri/src/prompt_mode.rs`, `editor/PromptModeBar.tsx` |
