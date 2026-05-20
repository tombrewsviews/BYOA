# BYOA Agent-Chat UI Layer — Design

**Status:** spec, awaiting user review
**Date:** 2026-05-20
**Author:** brainstormed with Claude (Opus 4.7) at the user's prompt
**Repo:** KineticType (first reference implementation), BYOA framework (eventual extraction target)

---

## Summary

Add an optional UI surface that replaces the embedded xterm.js terminal
with a chat-style view, while still hosting the user's own CLI agent
underneath. The agent runs as a child process authenticated against the
user's existing subscription (Claude Pro / Codex / Gemini), exactly as
BYOA already requires. The new surface parses the agent's *structured
output stream* into a normalized event model and renders it as
sans-serif chat UI with rich governance affordances. The user can
toggle between Chat view and Terminal view at any time; the agent
session is preserved across the toggle. Domain knowledge stays in the
skill the app already ships — the UI layer is app-agnostic and
per-agent-aware.

---

## Motivation

BYOA today ships with an xterm-based embedded terminal. That works for
developers who already live in the CLI. For everyone else, the dense
mono-spaced text and y/n permission prompts are a barrier. Three things
hurt:

1. **Density.** Streamed agent output mixes prose, code, tool calls,
   and ANSI control sequences in one column of monospace. Comprehension
   load is high.
2. **Governance.** Permission prompts ("Allow Edit on file X? y/n")
   appear inline and are easy to fat-finger. There is no way to inspect
   what exactly is being approved.
3. **Discoverability.** Slash commands, `@file` mentions, output flags,
   and other developer ergonomics fill the gap left by "good context
   engineering" — but most non-developers don't know they exist.

The Chat view aims to remove all three frictions without abandoning
BYOA's central commitment: **the user's own agent, the user's own
auth, no provider key on the app's side.**

---

## Non-goals

- **No PTY scraping.** v1 only supports agents that emit a structured
  event stream (e.g. `claude --output-format stream-json`). If the
  adapter cannot recognize the agent or run it in structured-output
  mode, the Chat-view toggle is disabled and the user stays in Terminal
  view. Best-effort parsing of raw TUI output is explicitly deferred —
  the maintenance cost is high and the result is fragile.
- **No domain knowledge in the UI layer.** Verbs, state-file schemas,
  and app-specific etiquette stay in the skill. Pattern guidance like
  "what is a beat" never lives in `editor/agent-chat/`. The UI renders
  whatever the agent says, with the agent's normal vocabulary.
- **No replacement of the terminal.** Terminal view stays the default
  and remains fully supported. Power users can switch to it at any
  time, including mid-session.
- **No multi-agent orchestration in v1.** One agent process per session,
  same as today.
- **No fourth-layer harness in v1.** A future "wrapping harness" that
  controls invocations more tightly than skills (discussed in
  brainstorming) is acknowledged but deferred.

---

## Architecture

### Three layers (unchanged), with one new component

```
Layer 1: The agent          (claude / codex / gemini, unchanged)
Layer 2: The skill          (per-app, unchanged — domain knowledge)
Layer 3: The presentation   (NEW: Chat view OR Terminal view, user's choice)
```

Inside Layer 3, the new component is `editor/agent-chat/`:

```
[agent process] ──structured stream──▶ [per-agent adapter] ──▶ [normalized events] ──▶ [Chat UI]
       ▲                                                                                  │
       └──────────────────────── user input (prose, files, decisions) ────────────────────┘
```

The Terminal view (`editor/terminal.tsx`) is untouched. The two views
are siblings; the editor chrome has a single toggle that swaps them.

### Where things live

- `editor/agent-chat/` — new directory.
  - `adapters/claude.ts` — Claude Code adapter (v1 ships this).
  - `adapters/codex.ts` — stub, throws `NotSupportedInV1`.
  - `adapters/gemini.ts` — stub, throws `NotSupportedInV1`.
  - `adapters/types.ts` — `AgentAdapter` interface.
  - `events.ts` — normalized event union and constructors.
  - `Chat.tsx` — top-level surface.
  - `Message.tsx` — assistant text bubble.
  - `UserMessage.tsx` — user message bubble.
  - `ToolCard.tsx` — read-only tool-call summary (v1).
  - `PermissionDialog.tsx` — governance dialog for permission prompts.
  - `Composer.tsx` — prose input + file drag-and-drop.
  - `ChatStore.ts` — the session model (events, status, pending
    permission, etc.) — plain TS, not Redux.
- `src-tauri/src/agent_chat.rs` — new Tauri module.
  - Spawns the agent in structured-output mode (separate code path from
    `pty.rs`). v1 uses the same `portable-pty` plumbing for stdio but
    invokes `claude --output-format stream-json` directly without a
    login shell wrapper. The stream is forwarded byte-for-byte to the
    frontend via `agent-chat://{id}/data` events; line-buffering and
    JSON parsing happen in TypeScript.
  - Tauri commands: `agent_chat_open`, `agent_chat_write_user_input`,
    `agent_chat_respond_to_permission`, `agent_chat_close`.

### Seam policy (enforced by convention, lint rule later)

- Nothing in `editor/agent-chat/` may import from `editor/` (other than
  shared low-level utilities that are themselves app-agnostic — e.g.
  `editor/runtime.ts` for `isTauri()`) or from `src/kinetic/`.
- App-specific config (project path, working directory, skill location)
  is injected via props or React context, never imported.
- The event model in `events.ts` is documented as a stable contract.
  Adapters fan in to it; the UI fans out from it. No agent-specific
  conditionals in UI components.

When a second BYOA app appears, extracting `agent-chat/` to a package
should be a `mv` + `package.json` operation, not a redesign.

---

## The normalized event model

The single most important artifact of this spec. The UI consumes this;
each adapter produces this. New adapters become straightforward as long
as they normalize into this shape.

```ts
// editor/agent-chat/events.ts

export type ChatEvent =
  | { kind: 'turn-start';        turnId: string;  startedAt: number }
  | { kind: 'message-delta';     turnId: string;  text: string }
  | { kind: 'message-end';       turnId: string }
  | { kind: 'tool-call';         turnId: string;  callId: string;  name: string;  input: unknown }
  | { kind: 'tool-result';       callId: string;  ok: boolean;     output: unknown }
  | { kind: 'permission-request'; promptId: string; tool: string;  args: unknown;  scope: string }
  | { kind: 'permission-decided'; promptId: string; decision: 'allow' | 'allow-always' | 'deny' }
  | { kind: 'error';             turnId?: string; message: string; recoverable: boolean }
  | { kind: 'turn-end';          turnId: string;  endedAt: number };
```

**Design notes:**

- `input` and `output` are `unknown` deliberately. The UI inspects them
  for known shapes (e.g. file paths in `Edit` calls) but treats
  unknown shapes as opaque JSON to render. This is what lets adapters
  forward agent-specific tool payloads without the UI needing to know
  them.
- `permission-request` and `permission-decided` are separate events.
  The dialog is owned by the UI; the adapter is told the user's
  decision via `agent_chat_respond_to_permission`.
- `turnId` and `callId` are adapter-supplied. For Claude Code these
  map to `message_id` and tool-use `id`. For Codex/Gemini they will
  map to whatever those agents emit.
- `error.recoverable` distinguishes "transient hiccup, agent still
  alive" from "agent crashed, session is dead." The UI renders the
  former inline and the latter as a session-end card.

### Adapter interface

```ts
// editor/agent-chat/adapters/types.ts

export interface AgentAdapter {
  /** Stable id matching src-tauri/src/agents.rs AgentKind::id(). */
  readonly id: 'claude' | 'codex' | 'gemini';

  /**
   * Command + args to launch the agent in structured-output mode.
   * The Tauri backend spawns this directly (no login shell).
   * Returning null means "this agent cannot run in structured mode" —
   * the toggle will be disabled.
   */
  spawnArgs(opts: { cwd: string; skipPermissions: boolean }):
    | { cmd: string; args: string[]; env: Record<string, string> }
    | null;

  /**
   * Parse a chunk of raw bytes from the agent's stdout into zero or
   * more normalized events. Adapter is stateful (line buffering, etc.)
   * The adapter is also given a way to push events asynchronously, for
   * cases where parsing one chunk surfaces multiple events out of
   * order with stdin.
   */
  parseChunk(chunk: Uint8Array, emit: (e: ChatEvent) => void): void;

  /**
   * Encode a user prose message for the agent's stdin.
   * Most agents just want UTF-8 bytes; some have framing.
   */
  encodeUserInput(text: string, attachments: string[]): Uint8Array;

  /**
   * Encode a permission decision for the agent's stdin.
   * Adapter-specific because different agents prompt differently.
   * Returns null if this agent's permission flow can't be answered
   * via stdin (e.g. it uses a separate IPC channel) — in which case
   * the adapter is expected to have provided its own out-of-band path.
   */
  encodePermissionDecision(
    promptId: string,
    decision: 'allow' | 'allow-always' | 'deny',
  ): Uint8Array | null;
}
```

---

## Data flow

### Opening a chat session

1. User clicks "Chat view" in the editor chrome.
2. Frontend calls `agent_chat_open(agentId, cwd)`.
3. Frontend resolves the adapter's `spawnArgs` and passes
   `{ cmd, args, env, cwd }` to `agent_chat_open`. The backend spawns
   the process via `std::process::Command` with piped stdio
   (rationale in Risks §3) and a fallback to `portable-pty` if a TTY
   turns out to be required.
4. A reader thread pumps stdout bytes into `agent-chat://{id}/data`
   events, using the same coalescing strategy as `pty.rs` (the bulk of
   that logic should be factored into a shared helper).
5. Frontend's `ChatStore` subscribes, runs each chunk through the
   adapter's `parseChunk`, and applies the resulting events to state.

### A user turn

1. User types in `Composer`, optionally drags files in.
2. On submit, `ChatStore` calls
   `agent_chat_write_user_input(id, text, attachmentPaths)`.
3. Backend invokes `adapter.encodeUserInput` (the adapter lives in
   TS, so this step actually happens in the frontend just before the
   Tauri call — see "Where adapters run" below).
4. The agent processes, emits structured-stream chunks back.
5. `ChatStore` accumulates `message-delta` events into the current
   assistant bubble; `tool-call` and `tool-result` events render as
   `ToolCard` instances; `permission-request` opens
   `PermissionDialog`.
6. `turn-end` resolves the turn; composer is re-enabled.

### Where adapters run

Adapters are TypeScript and run in the renderer. The Rust side is
"dumb": it spawns whatever command the frontend tells it to spawn (via
`agent_chat_open(cmd, args, env, cwd)`) and pipes stdin/stdout. This
keeps adapter logic in one language and one place, and keeps
`src-tauri/` from accumulating per-agent code. `spawnArgs` is therefore
called *in the renderer* to produce the spawn parameters, which are
then handed to the Rust command — the adapter never runs on the Rust
side.

Trade-off acknowledged: this means the renderer holds the agent's
stream-parsing state. If the renderer crashes mid-turn, the session is
lost. Acceptable for v1 — same risk as Terminal view, where xterm
state is also renderer-only.

---

## UI

### Visual posture

- Sans-serif system stack (the editor's existing
  `var(--font-sans)` token, falling back to `-apple-system,
  Helvetica Neue, ...`).
- Generous line-height (1.55), comfortable max-width on text
  (~70ch), 16px base size.
- Monospace only inside `<code>`, diffs, and file-path chips.
- Color: aligned with the existing dark editor chrome
  (`#0a0a10` background) but with softer contrast for body text
  than the terminal uses. Tokens come from `editor/`'s existing
  CSS variables.
- No emoji. No icons unless they carry meaning (tool kind,
  permission scope).

### Components

- **`Message`** — assistant prose bubble. Streams `message-delta`
  events. Markdown rendered: headings, lists, links, inline and block
  code. Code blocks have copy buttons.
- **`UserMessage`** — right-aligned plain-text bubble. No markdown
  (what the user typed is what they meant).
- **`ToolCard`** — collapsible card with:
  - Tool name (`Edit`, `Read`, `Bash`, etc.).
  - One-line summary derived from `input` (file path, command,
    URL — adapter-suggested via a small helper map of known tool
    shapes; falls back to the tool name only).
  - "Show details" expands to pretty-printed JSON input.
  - Result section appears when `tool-result` arrives.
  - In v1: read-only. v2 may add inline "Approve / Reject"
    affordances for tools that support deferred execution.
- **`PermissionDialog`** — modal-ish (positioned above the composer,
  blocking submit). Shows tool, args, scope. Three actions: Allow
  once, Allow always, Deny. Esc closes as Deny. Until a decision is
  made, the agent is blocked.
- **`Composer`** — multi-line text area with Enter-to-send,
  Shift-Enter for newline. Drag-and-drop file zone. Dropped files
  are converted to `@path/to/file` references inserted at the
  caret. File *contents* are not read by the UI — the agent reads
  them itself, as it always does. There is no slash menu in v1.
- **`SessionToolbar`** — shows agent name, working directory,
  "Switch to Terminal view" button, "End session" button.

### Toggle behavior

- The chrome's existing terminal slot now hosts either `Terminal`
  or `Chat`. Choice persisted per project in window state
  (extending the existing `window_state.rs`).
- Default is Terminal view, so existing behavior is unchanged for
  current users.
- Switching mid-session ends the current agent process and
  starts a new one in the other view. Trying to preserve a
  single agent process across both views is feasible long-term
  but adds complexity (PTY ↔ structured stream are different
  invocations) and is not worth it for v1.
- The toggle button is disabled when the active agent has no
  structured-output adapter (e.g. opencode in v1) with a tooltip
  explaining why.

---

## Error handling

- **Adapter parse error.** The bad chunk is dropped, an `error`
  event with `recoverable: true` is emitted, and parsing
  continues. Surfaced as a small inline warning, not a modal.
- **Agent process crash.** Reader thread sees EOF; backend emits
  `agent-chat://{id}/closed`. UI renders a session-end card with
  "Start new session" and "Switch to Terminal view" buttons.
- **Spawn failure (binary missing, exec error).** Backend returns
  an error from `agent_chat_open`; UI shows the existing
  "agent missing" install-hint card from the first-run flow.
- **Permission decision sent for unknown promptId.** Adapter
  ignores; backend logs. The UI should not be able to produce this
  unless the dialog is stale — defend with a guard.
- **User cancels mid-turn.** Composer has a "Stop" button that
  sends Ctrl-C-equivalent via `agent_chat_write_user_input` with
  a control flag (adapter decides what bytes to send). If the
  agent doesn't respond within 2 seconds, the process is killed
  and a fresh session is offered.

---

## Testing

Three layers, three test strategies.

- **Adapter (`adapters/claude.ts`)** — pure function tests.
  Feed in recorded byte sequences from real `claude --output-format
  stream-json` runs (checked into `editor/agent-chat/__fixtures__/`),
  assert the emitted normalized events. These are the only tests in
  v1 that exercise real agent output, and they catch the
  highest-value regressions (stream-format drift between agent
  versions). One fixture per scenario:
  - Plain prose response.
  - Single tool call with result.
  - Permission request followed by allow.
  - Permission request followed by deny.
  - Error mid-turn (recoverable).
  - Multi-turn conversation.
- **`ChatStore`** — pure TS unit tests. Feed in event sequences,
  assert UI state.
- **Components (`Message`, `ToolCard`, etc.)** — Vitest +
  React-testing-library snapshot or interaction tests for the
  governance flows. No real agent involved.
- **Integration** — manual for v1. Acceptance criteria documented
  in the implementation plan. Automating end-to-end with a real
  Claude binary is out of scope until the adapter stabilizes.

---

## Risks and open questions

1. **Stream-format drift.** Claude's `stream-json` format is
   documented but not formally versioned. If Anthropic ships a
   format change, the adapter breaks until updated. Mitigation:
   keep adapters small, keep fixtures fresh, run them in CI when
   the project gets CI.
2. **Permission UX assumption.** The current dialog design assumes
   Claude's three-decision model (allow / allow-always / deny).
   Codex and Gemini may have different shapes. The event model
   accommodates arbitrary decisions, but the dialog will likely
   need per-agent variants — addressed when those adapters land,
   not in v1.
3. **`portable-pty` vs `std::process::Command` with piped stdio.**
   The terminal path uses `portable-pty` because xterm needs a
   real TTY. Chat doesn't need a TTY at all; piped stdio is
   simpler and removes ANSI noise the structured stream shouldn't
   contain anyway. v1 should default to piped stdio for the chat
   path. If the agent misbehaves without a TTY, fall back to
   `portable-pty`. Implementation-time decision; spec records the
   default.
4. **Working-directory contract.** The Terminal view runs the agent
   inside the user's `$SHELL` with the project rc sourced
   (`src-tauri/src/pty.rs:90-96`). The chat path will NOT do this —
   it invokes the agent binary directly. Implication: any
   project-specific shell setup the user has in `rc.zsh` is not
   active in chat sessions. For BYOA this is fine — agents don't
   need login shells — but it should be documented.
5. **Toggle UX dead-end.** If a user starts in Chat view but the
   selected agent has no adapter (e.g. opencode), the toggle is
   disabled and the user is silently dropped into Terminal view.
   The first-run / agent-picker flow should surface adapter
   support so the user sees this up front. Not blocking for v1,
   but worth a callout in the agent-picker before v1 ships.
6. **The fourth-layer harness.** Acknowledged as out of scope.
   When it lands, the harness will likely live *between* the user
   input and the agent stdin — wrapping `encodeUserInput` to
   inject app-specific context. The adapter interface is already
   well-positioned for this, but no concrete API for the harness
   is designed here.

---

## Out of scope, listed for future work

- Codex and Gemini adapters (post-v1).
- Inline tool-call approval cards (replacing the modal dialog for
  routine tools).
- File-picker / `@`-mention autocomplete in composer.
- Slash command UI translation (showing `/compact`, `/clear` as
  buttons).
- Multi-agent / multi-session tabs.
- The fourth-layer harness for per-app invocation control.
- Telemetry / replay (the event stream is a clean basis for it).

---

## Acceptance criteria for v1

Done when:

1. A new "Chat view" toggle in the editor chrome switches the
   embedded terminal slot to a chat surface, persists per project,
   and is disabled when the active agent isn't Claude.
2. A user can start a Claude session in chat view, send prose,
   receive streamed prose responses, see tool calls rendered as
   cards, approve and deny permission requests via dialog, drag a
   file into the composer to insert an `@path` reference, and end
   the session.
3. The Terminal view is unchanged for users who never touch the
   new toggle.
4. The seam policy holds: `editor/agent-chat/` has no upward
   imports.
5. Adapter fixture tests cover the six scenarios listed in
   "Testing."
6. No regressions in existing PTY behavior.
