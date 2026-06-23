# Brainstorm Canvas — `@agent` mentions on the board

**Date:** 2026-06-23
**Status:** Approved design, pending implementation plan

## Problem

In the Brainstorm Canvas continuous (watch) mode, the agent is a passive
observer: after the user pauses drawing, the watch loop wakes it with a
read-only prompt to *suggest, not edit*. There is currently no way for the user
to give the agent an instruction **from the board itself** — and no way to give
it additional instructions at all without switching to the side-panel chat
composer.

We want the user to be able to drop a text element on the board containing
`@agent <instruction>` (e.g. *"@agent add a node for pricing and connect it to
revenue"*). On the next watch tick the agent should:

1. Read the board and act on the instruction (editing the board is allowed for
   these turns).
2. Delete the `@agent` text element(s) so the instruction is reconciled and
   doesn't re-fire.
3. Echo the instruction into the side-panel chat so there's a readable record
   of what was asked, followed by its response.

## Key constraint (why this isn't just "reuse watch mode")

The existing watch path — `handle.sendWatch(prompt)` → `send(prompt, [],
"watch")` — **hard-forces `permissionMode: "plan"` (read-only)** in
`editor/agent-chat/Chat.tsx:126`. A watch turn therefore *cannot* edit the board
or delete the note.

An `@agent` turn must (a) edit the board, (b) delete the note, and (c) show a
real user bubble in chat. That is exactly what the existing `origin === "user"`
send path already provides: it renders a `UserMessage` bubble and runs with the
live (editable) permission mode. So **`@agent` turns route through a new handle
method that uses the `"user"` origin**, not the watch origin.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Coexistence with passive observe | **`@agent` takes priority** — if any `@agent` tag exists this tick, route only the instruction(s) as an editable turn and skip the passive observe turn. Passive observation resumes once no tags remain. |
| Multiple tags in one tick | **Combine into one turn** — all `@agent` texts are collected and sent together; the agent addresses and deletes all of them in one turn. |
| Trigger syntax | **Text *containing* `@agent`** (case-insensitive), anywhere in the element's text. |
| Chat echo | **Always echo** the captured instruction(s) as the user bubble, then the agent's reply. |
| Detection owner | **Frontend detects, agent deletes** — `watch.ts` scans elements deterministically and passes element IDs; the agent deletes them via its `delete_element` MCP tool, atomically with its work. |
| Re-fire guard | **Send-once (a)** — a tag is dispatched at most once. If the agent fails to delete it, it is *not* retried every tick (avoids runaway). It can be re-triggered only by editing the element (version bump) or removing and re-adding it. |
| Chat bubble content | **Readable** — the user bubble shows just the quoted instruction(s); the agent receives the fuller scaffolded prompt. |

## Architecture

### Component responsibilities

- **`watch.ts` (deterministic detection + routing).** Each wake, after fetching
  `/api/elements`:
  1. Scan text elements for `/@agent/i` in their `text` field; collect
     `{ id, version, text }` for each match.
  2. Filter out tags already dispatched this session (the send-once guard), keyed
     by `id:version` so an *edited* tag (new version) is treated as fresh.
  3. **If fresh matches remain:** build the agent prompt + the readable bubble,
     call `handle.sendMention(prompt, bubble)`, record the dispatched signatures,
     and `return` (skip the passive observe path this tick).
  4. **If none:** fall through to the existing observe logic, unchanged.

- **`Chat.tsx` (`ChatHandle.sendMention`).** New imperative method that sends an
  editable, user-origin turn while letting the caller supply a distinct bubble
  string. Implemented by extending `send` to accept an optional explicit
  `bubbleText` (defaults to `text`), so the agent prompt and the displayed bubble
  can differ. `sendMention(prompt, bubble)` → `send(prompt, [], "user", bubble)`.

- **`BrainstormApp.tsx` (wiring).** Add `sendMention` to the `WatchHandle` passed
  into `startWatchLoop`, delegating to `chatHandleRef.current?.sendMention`.

- **Agent (SKILL.md contract).** A new "board instruction" section tells the
  agent: when a turn says it carries board instructions with cited element IDs,
  read the board, act, then `delete_element` each cited ID, and briefly say what
  it did.

### Data flow per tick

```
WebSocket element change ──> debounce (QUIET_MS) ──> wake()
                                                       │
                                  fetch /api/elements  │
                                                       ▼
                          scan text elements for /@agent/i
                                                       │
                ┌──────────────────────────────────────┴───────────────┐
                │ fresh @agent tag(s)?                                   │
                ▼ yes                                                    ▼ no
   build prompt + bubble                                   existing observe path
   handle.sendMention(prompt, bubble)                      (scene-hash dedup,
   record dispatched signatures                             sendWatch, read-only)
   return (skip observe)
                │
                ▼
   "user"-origin editable turn:
     user bubble = quoted instruction(s)
     agent reads board, edits, delete_element(ids), replies
```

### The agent prompt (sent to the model)

```
[board instruction] The user left message(s) for you on the board.
Read the board first (describe_scene), then act on these:

1. "<text of tag 1>"  (element id: <id1>)
2. "<text of tag 2>"  (element id: <id2>)

After acting, delete these element(s) from the board (delete_element) so the
instruction is cleared. Then say briefly in chat what you did.
```

### The chat bubble (shown to the user)

Just the quoted instruction(s), one per line, e.g.:

```
add a node for pricing and connect it to revenue
group the three risk items
```

(The leading `@agent` is stripped for readability where it appears as a prefix;
if `@agent` is mid-sentence, the text is shown verbatim.)

## Re-fire / dedup interaction (the careful part)

Two failure modes and how the design prevents each:

1. **Re-firing before deletion lands.** Between sending the mention turn and the
   agent's `delete_element` completing, the existing **running-gate**
   (`isRunning()` in `wake()`) prevents any new wake. Covered by existing code.

2. **A tag the agent forgot to delete looping forever.** Prevented by the
   **send-once guard**: `watch.ts` keeps a `Set<string>` of dispatched tag
   signatures (`id:version`). A tag already in the set is skipped. Because the
   key includes `version`, editing the tag (Excalidraw bumps `version`) makes it
   a fresh signature and re-triggers — the intended "edit to retry" affordance.
   A tag that is deleted (by the agent or user) simply never appears again.

The guard lives only in the watch controller instance, so it resets when
continuous mode is toggled off/on — acceptable and simple.

## Edge cases

- **`@agent` tag present but agent edits fail / errors:** turn ends, tag was
  dispatched once, not retried. User sees the failure in chat and can edit the
  note to retry.
- **`@agent` text plus other unrelated edits in the same tick:** `@agent` takes
  priority; the other edits are simply part of the board the agent reads. The
  observe turn for those edits is skipped this tick but will occur on a later
  tick once no tags remain (scene hash will differ).
- **Empty instruction (`@agent` with no following text):** still dispatched; the
  agent reads the board and may ask for clarification or act on obvious intent.
  No special-casing — keep it simple.
- **Tag deleted by the *user* before the tick fires:** never detected, nothing
  happens. Correct.
- **Prompted mode:** unaffected — the watch loop (and thus mention detection)
  only runs in continuous mode.

## Files touched

| File | Change | Est. |
|---|---|---|
| `editor/canvases/brainstorm/watch.ts` | `@agent` detection, send-once guard, `sendMention` call, build prompt + bubble; extend `WatchHandle` with `sendMention` | ~45 lines |
| `editor/agent-chat/Chat.tsx` | Add `sendMention` to `ChatHandle`; extend `send` with optional `bubbleText` | ~8 lines |
| `editor/canvases/brainstorm/BrainstormApp.tsx` | Wire `sendMention` into the `WatchHandle` | ~2 lines |
| `src-tauri/skills/brainstorm/SKILL.md` | Document the board-instruction turn (read → act → delete cited IDs → echo) | doc only |
| `editor/canvases/brainstorm/__tests__/watch.test.ts` | Tests for detection + send-once guard | ~new cases |

## Testing

Unit-testable pure logic should be extracted from `watch.ts` so tests don't need
a live server or sockets (mirroring how `hashElements` is already exported and
tested):

- **`detectMentions(elements) -> Array<{id, version, text, instruction}>`** —
  exported pure function. Tests:
  - text element containing `@agent` is detected; the instruction strips a
    leading `@agent` prefix
  - `@AGENT` / `@Agent` (case-insensitive) detected
  - `@agent` mid-sentence detected, text kept verbatim
  - non-text elements ignored; text without `@agent` ignored
  - multiple matches all returned
- **send-once guard** — a small pure helper (e.g.
  `filterUndispatched(mentions, seenSet)`) or tested via the detection +
  guard combination:
  - same `id:version` not dispatched twice
  - same `id` with bumped `version` dispatched again
- Existing `hashElements` tests remain unchanged.

## Out of scope

- Visual styling of the `@agent` note on the board (a special sticky color,
  icon, etc.) — the trigger is purely text-content based for now.
- Retry-until-deleted behavior — explicitly rejected (send-once).
- Letting watch (observe) turns edit the board — unchanged; only `@agent` turns
  are editable, and they go through the user-origin path.
