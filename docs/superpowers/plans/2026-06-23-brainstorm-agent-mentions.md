# Brainstorm `@agent` Mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user drop a text element containing `@agent <instruction>` on the Brainstorm Canvas board and have the continuous-mode watch loop route it as an editable turn — the agent acts on the board, deletes the note, and echoes the instruction in chat.

**Architecture:** Pure detection logic is extracted from `watch.ts` (mirroring the existing exported, unit-tested `hashElements`). The watch loop, on each wake, scans fetched elements for `@agent`, and if any *fresh* ones exist routes them through a new editable `sendMention` handle (the existing `"watch"` origin is hard-forced read-only, so it cannot edit/delete). A send-once guard keyed on `id:version` prevents re-fire runaway. The agent deletes the cited element IDs via its `delete_element` MCP tool, per a new SKILL.md contract.

**Tech Stack:** TypeScript, React, Vitest, Tauri, Excalidraw (via `mcp-excalidraw-server`).

## Global Constraints

- Mention detection runs **only in continuous mode** — it lives in `watch.ts`, which `BrainstormApp` starts only when `mode === "continuous"`.
- Trigger match is **`/@agent/i` anywhere in a text element's `text`** (case-insensitive).
- Multiple tags in one tick are **combined into one turn**.
- `@agent` turns **take priority** over the passive observe turn — when present, skip observe that tick.
- Re-fire guard is **send-once**, keyed on `id:version` (an edited tag = new `version` = fresh).
- `@agent` turns must run **editable** (NOT the read-only `"watch"` origin). They route through the `"user"` origin.
- The chat **user bubble shows the readable quoted instruction(s)**; the agent receives the fuller scaffolded prompt.
- Excalidraw text elements have `type: "text"` and a string `text` field.
- Run a single test file with: `npx vitest run editor/canvases/brainstorm/__tests__/watch.test.ts`.

---

### Task 1: `detectMentions` — pure detection of `@agent` tags

**Files:**
- Modify: `editor/canvases/brainstorm/watch.ts` (add exported `detectMentions` near `hashElements`, ~line 47)
- Test: `editor/canvases/brainstorm/__tests__/watch.test.ts` (add a new `describe` block)

**Interfaces:**
- Consumes: the raw `elements` array (`Array<Record<string, unknown>>`) already fetched in `wake()`.
- Produces:
  ```ts
  export interface Mention {
    id: string;        // element id
    version: number;   // element version (for the send-once signature)
    text: string;      // the element's full text, verbatim
    instruction: string; // text with a leading "@agent" prefix stripped + trimmed
  }
  export function detectMentions(
    elements: Array<Record<string, unknown>>,
  ): Mention[]
  ```

- [ ] **Step 1: Write the failing tests**

Add to `editor/canvases/brainstorm/__tests__/watch.test.ts`:

```ts
import { hashElements, detectMentions } from "../watch";

describe("brainstorm watch — @agent detection", () => {
  const textEl = (id: string, text: string, version = 1) => ({
    id,
    type: "text",
    text,
    version,
    versionNonce: version * 7,
  });

  it("detects a text element with a leading @agent prefix and strips it", () => {
    const m = detectMentions([textEl("a", "@agent add a pricing node")]);
    expect(m).toHaveLength(1);
    expect(m[0].id).toBe("a");
    expect(m[0].version).toBe(1);
    expect(m[0].text).toBe("@agent add a pricing node");
    expect(m[0].instruction).toBe("add a pricing node");
  });

  it("is case-insensitive on the @agent trigger", () => {
    expect(detectMentions([textEl("a", "@Agent hi")])).toHaveLength(1);
    expect(detectMentions([textEl("b", "@AGENT hi")])).toHaveLength(1);
  });

  it("detects @agent mid-sentence and keeps the instruction verbatim", () => {
    const m = detectMentions([textEl("a", "hey @agent can you group these")]);
    expect(m).toHaveLength(1);
    expect(m[0].instruction).toBe("hey @agent can you group these");
  });

  it("ignores text elements without @agent", () => {
    expect(detectMentions([textEl("a", "just a note")])).toHaveLength(0);
  });

  it("ignores non-text elements even if a text-like field contains @agent", () => {
    expect(
      detectMentions([{ id: "a", type: "rectangle", text: "@agent", version: 1 }]),
    ).toHaveLength(0);
  });

  it("returns all matches when several @agent elements exist", () => {
    const m = detectMentions([
      textEl("a", "@agent one"),
      textEl("b", "plain"),
      textEl("c", "@agent two"),
    ]);
    expect(m.map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("handles an empty @agent (no instruction) without throwing", () => {
    const m = detectMentions([textEl("a", "@agent")]);
    expect(m).toHaveLength(1);
    expect(m[0].instruction).toBe("");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run editor/canvases/brainstorm/__tests__/watch.test.ts`
Expected: FAIL — `detectMentions` is not exported / not a function.

- [ ] **Step 3: Implement `detectMentions`**

In `editor/canvases/brainstorm/watch.ts`, directly below the `hashElements` function (after line 47), add:

```ts
/** A text element on the board addressed to the agent via "@agent". */
export interface Mention {
  id: string;
  version: number;
  text: string;
  instruction: string;
}

const MENTION_RE = /@agent/i;
/** Strips a leading "@agent" (case-insensitive) + following whitespace. */
const LEADING_MENTION_RE = /^@agent\s*/i;

/**
 * Find text elements whose content mentions "@agent". Detection is purely
 * content-based (no special element type/color). A leading "@agent " prefix is
 * stripped for the instruction; a mid-sentence mention is kept verbatim so the
 * agent gets the full request. Exported for unit testing.
 */
export function detectMentions(
  elements: Array<Record<string, unknown>>,
): Mention[] {
  const out: Mention[] = [];
  for (const el of elements) {
    if (el.type !== "text") continue;
    const text = typeof el.text === "string" ? el.text : "";
    if (!MENTION_RE.test(text)) continue;
    out.push({
      id: String(el.id ?? ""),
      version: typeof el.version === "number" ? el.version : 0,
      text,
      instruction: text.replace(LEADING_MENTION_RE, "").trim(),
    });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run editor/canvases/brainstorm/__tests__/watch.test.ts`
Expected: PASS (the original 5 `hashElements` tests + the 7 new ones).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add editor/canvases/brainstorm/watch.ts editor/canvases/brainstorm/__tests__/watch.test.ts
git commit -m "feat(brainstorm): detectMentions — find @agent text on the board"
```

---

### Task 2: Send-once guard helper

**Files:**
- Modify: `editor/canvases/brainstorm/watch.ts` (add `mentionSignature` + `filterUndispatched` near `detectMentions`)
- Test: `editor/canvases/brainstorm/__tests__/watch.test.ts` (add a `describe` block)

**Interfaces:**
- Consumes: `Mention[]` from Task 1.
- Produces:
  ```ts
  export function mentionSignature(m: Mention): string  // `${id}:${version}`
  export function filterUndispatched(mentions: Mention[], seen: Set<string>): Mention[]
  ```
  `filterUndispatched` returns only mentions whose signature is NOT in `seen`. It does NOT mutate `seen` (the caller records signatures after a successful dispatch).

- [ ] **Step 1: Write the failing tests**

Add to `editor/canvases/brainstorm/__tests__/watch.test.ts`:

```ts
import {
  hashElements,
  detectMentions,
  mentionSignature,
  filterUndispatched,
  type Mention,
} from "../watch";

describe("brainstorm watch — send-once guard", () => {
  const m = (id: string, version: number): Mention => ({
    id,
    version,
    text: `@agent ${id}`,
    instruction: id,
  });

  it("signature combines id and version", () => {
    expect(mentionSignature(m("a", 3))).toBe("a:3");
  });

  it("filters out a mention already in the seen set", () => {
    const seen = new Set(["a:1"]);
    expect(filterUndispatched([m("a", 1)], seen)).toEqual([]);
  });

  it("keeps a mention whose version bumped (an edited tag retries)", () => {
    const seen = new Set(["a:1"]);
    const result = filterUndispatched([m("a", 2)], seen);
    expect(result).toHaveLength(1);
    expect(result[0].version).toBe(2);
  });

  it("does not mutate the seen set", () => {
    const seen = new Set(["a:1"]);
    filterUndispatched([m("b", 1)], seen);
    expect([...seen]).toEqual(["a:1"]);
  });

  it("keeps multiple fresh mentions", () => {
    const seen = new Set<string>();
    expect(filterUndispatched([m("a", 1), m("b", 1)], seen)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run editor/canvases/brainstorm/__tests__/watch.test.ts`
Expected: FAIL — `mentionSignature` / `filterUndispatched` not exported.

- [ ] **Step 3: Implement the guard helpers**

In `editor/canvases/brainstorm/watch.ts`, directly below `detectMentions`, add:

```ts
/** Stable per-version identity of a mention. Including the version means an
 *  edited tag (Excalidraw bumps version) counts as a fresh, re-triggerable
 *  mention; an unchanged tag the agent forgot to delete is not re-fired. */
export function mentionSignature(m: Mention): string {
  return `${m.id}:${m.version}`;
}

/** Keep only mentions not already dispatched this session. Pure: the caller
 *  records signatures into `seen` after a successful send. */
export function filterUndispatched(
  mentions: Mention[],
  seen: Set<string>,
): Mention[] {
  return mentions.filter((m) => !seen.has(mentionSignature(m)));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run editor/canvases/brainstorm/__tests__/watch.test.ts`
Expected: PASS (all prior tests + 5 new).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add editor/canvases/brainstorm/watch.ts editor/canvases/brainstorm/__tests__/watch.test.ts
git commit -m "feat(brainstorm): send-once guard for @agent mentions"
```

---

### Task 3: Build the agent prompt + readable bubble

**Files:**
- Modify: `editor/canvases/brainstorm/watch.ts` (add `buildMentionTurn`)
- Test: `editor/canvases/brainstorm/__tests__/watch.test.ts` (add a `describe` block)

**Interfaces:**
- Consumes: `Mention[]` from Task 1.
- Produces:
  ```ts
  export function buildMentionTurn(mentions: Mention[]): { prompt: string; bubble: string }
  ```
  `prompt` = the scaffolded instruction sent to the model (cites element IDs, tells it to act then `delete_element` each). `bubble` = the readable user-facing text (just the instructions, one per line).

- [ ] **Step 1: Write the failing tests**

Add to `editor/canvases/brainstorm/__tests__/watch.test.ts`:

```ts
import {
  // ...existing imports plus:
  buildMentionTurn,
} from "../watch";

describe("brainstorm watch — buildMentionTurn", () => {
  const m = (id: string, instruction: string): Mention => ({
    id,
    version: 1,
    text: `@agent ${instruction}`,
    instruction,
  });

  it("bubble lists the instructions one per line", () => {
    const { bubble } = buildMentionTurn([m("a", "add pricing"), m("b", "group risks")]);
    expect(bubble).toBe("add pricing\ngroup risks");
  });

  it("prompt cites each element id and tells the agent to delete them", () => {
    const { prompt } = buildMentionTurn([m("a", "add pricing")]);
    expect(prompt).toContain("add pricing");
    expect(prompt).toContain("a"); // the element id
    expect(prompt.toLowerCase()).toContain("delete_element");
    expect(prompt.toLowerCase()).toContain("describe_scene");
  });

  it("prompt enumerates multiple mentions with their ids", () => {
    const { prompt } = buildMentionTurn([m("a", "one"), m("b", "two")]);
    expect(prompt).toContain("id: a");
    expect(prompt).toContain("id: b");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run editor/canvases/brainstorm/__tests__/watch.test.ts`
Expected: FAIL — `buildMentionTurn` not exported.

- [ ] **Step 3: Implement `buildMentionTurn`**

In `editor/canvases/brainstorm/watch.ts`, below the guard helpers, add:

```ts
/** Build the editable turn for one or more @agent mentions: the scaffolded
 *  prompt sent to the model, and the readable bubble shown in chat. */
export function buildMentionTurn(mentions: Mention[]): {
  prompt: string;
  bubble: string;
} {
  const bubble = mentions.map((m) => m.instruction).join("\n");
  const list = mentions
    .map((m, i) => `${i + 1}. "${m.instruction}"  (id: ${m.id})`)
    .join("\n");
  const prompt = [
    "[board instruction] The user left message(s) for you on the board.",
    "Read the board first (describe_scene), then act on these:",
    "",
    list,
    "",
    "After acting, delete these element(s) from the board (delete_element) so",
    "the instruction is cleared. Then say briefly in chat what you did.",
  ].join("\n");
  return { prompt, bubble };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run editor/canvases/brainstorm/__tests__/watch.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add editor/canvases/brainstorm/watch.ts editor/canvases/brainstorm/__tests__/watch.test.ts
git commit -m "feat(brainstorm): build @agent mention prompt + readable bubble"
```

---

### Task 4: `Chat.tsx` — editable `sendMention` with a distinct bubble

**Files:**
- Modify: `editor/agent-chat/Chat.tsx` (extend `send`'s signature ~line 118-141; add `sendMention` to `ChatHandle` ~line 31-37 and the `onReady` handle ~line 222-227)

**Interfaces:**
- Consumes: nothing from earlier tasks (this is the chat-side plumbing).
- Produces (on the `ChatHandle`):
  ```ts
  sendMention: (prompt: string, bubble: string) => void;
  ```
  Sends an editable, user-origin turn whose chat bubble is `bubble` but whose model prompt is `prompt`.

**Why:** the existing `"watch"` origin forces `permissionMode: "plan"` (read-only) at `Chat.tsx:126`; an `@agent` turn must edit and delete, so it uses the `"user"` origin. The only new capability is letting the displayed bubble differ from the prompt sent to the model.

- [ ] **Step 1: Extend `send` to accept an optional explicit bubble**

In `editor/agent-chat/Chat.tsx`, change the `send` callback signature (line 118-119) from:

```ts
  const send = useCallback(
    (text: string, attachments: string[], origin: "user" | "watch" = "user") => {
```

to:

```ts
  const send = useCallback(
    (
      text: string,
      attachments: string[],
      origin: "user" | "watch" = "user",
      bubbleText?: string,
    ) => {
```

Then change the user-bubble line (currently line 140) from:

```ts
        setUserBubbles((b) => ({ ...b, [turnIndex]: text }));
```

to:

```ts
        setUserBubbles((b) => ({ ...b, [turnIndex]: bubbleText ?? text }));
```

(Leave the `composePrompt(text, attachments)` call untouched — the model still receives `text`.)

- [ ] **Step 2: Add `sendMention` to the `ChatHandle` interface**

Change the `ChatHandle` interface (lines 31-37) from:

```ts
export interface ChatHandle {
  /** Send a watch-origin turn (no user bubble; rendered as an observation).
   *  No-op if a turn is already running. */
  sendWatch: (prompt: string) => void;
  /** True while a turn is in flight (the watch loop gates on this). */
  isRunning: () => boolean;
}
```

to:

```ts
export interface ChatHandle {
  /** Send a watch-origin turn (no user bubble; rendered as an observation).
   *  No-op if a turn is already running. */
  sendWatch: (prompt: string) => void;
  /** Send an editable user-origin turn for an @agent board mention. `prompt`
   *  goes to the model; `bubble` is the readable text shown in chat. */
  sendMention: (prompt: string, bubble: string) => void;
  /** True while a turn is in flight (the watch loop gates on this). */
  isRunning: () => boolean;
}
```

- [ ] **Step 3: Expose `sendMention` on the `onReady` handle**

Change the `onReady` effect (lines 222-227) from:

```ts
  useEffect(() => {
    onReady?.({
      sendWatch: (prompt: string) => send(prompt, [], "watch"),
      isRunning: () => activeTurnIdRef.current !== null,
    });
  }, [onReady, send]);
```

to:

```ts
  useEffect(() => {
    onReady?.({
      sendWatch: (prompt: string) => send(prompt, [], "watch"),
      sendMention: (prompt: string, bubble: string) =>
        send(prompt, [], "user", bubble),
      isRunning: () => activeTurnIdRef.current !== null,
    });
  }, [onReady, send]);
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`BrainstormApp.tsx` will still typecheck — its `WatchHandle` literal doesn't yet reference `sendMention`; that's Task 5. The `ChatHandle` consumer in `BrainstormApp` accesses methods optionally via `chatHandleRef.current?.…`.)

- [ ] **Step 5: Run the full test suite (no regressions)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add editor/agent-chat/Chat.tsx
git commit -m "feat(chat): sendMention — editable turn with a distinct chat bubble"
```

---

### Task 5: Wire mention detection into the watch loop

**Files:**
- Modify: `editor/canvases/brainstorm/watch.ts` (`WatchHandle` interface ~line 34-37; `wake()` ~line 68-87; add a `dispatchedMentions` set in `startWatchLoop` ~line 58)
- Modify: `editor/canvases/brainstorm/BrainstormApp.tsx` (`startWatchLoop` handle literal, lines 92-95)

**Interfaces:**
- Consumes: `detectMentions`, `filterUndispatched`, `mentionSignature`, `buildMentionTurn` (Tasks 1-3); `ChatHandle.sendMention` (Task 4).
- Produces: `WatchHandle` gains `sendMention: (prompt: string, bubble: string) => void`.

- [ ] **Step 1: Add `sendMention` to the `WatchHandle` interface**

In `editor/canvases/brainstorm/watch.ts`, change `WatchHandle` (lines 34-37) from:

```ts
export interface WatchHandle {
  sendWatch: (prompt: string) => void;
  isRunning: () => boolean;
}
```

to:

```ts
export interface WatchHandle {
  sendWatch: (prompt: string) => void;
  sendMention: (prompt: string, bubble: string) => void;
  isRunning: () => boolean;
}
```

- [ ] **Step 2: Add the dispatched-mentions set**

In `startWatchLoop`, alongside the existing state vars (after line 59 `let stopped = false;`), add:

```ts
  // Signatures (id:version) of @agent mentions already dispatched this session.
  // Send-once: a tag the agent forgot to delete is not re-fired; editing it
  // (version bump) makes it fresh again.
  const dispatchedMentions = new Set<string>();
```

- [ ] **Step 3: Route mentions in `wake()` before the observe path**

In `wake()`, insert the mention check between the hash dedup and `sendWatch`. Change the body from (lines 80-83):

```ts
      const hash = hashElements(elements);
      if (hash === lastSentHash) return; // nothing substantive changed
      lastSentHash = hash;
      handle.sendWatch(WATCH_PROMPT);
```

to:

```ts
      // @agent mentions take priority over passive observation. If any fresh
      // (not-yet-dispatched) mention exists, send it as an editable turn and
      // skip the observe turn this tick. The agent deletes the cited elements.
      const fresh = filterUndispatched(detectMentions(elements), dispatchedMentions);
      if (fresh.length > 0) {
        for (const m of fresh) dispatchedMentions.add(mentionSignature(m));
        const { prompt, bubble } = buildMentionTurn(fresh);
        handle.sendMention(prompt, bubble);
        return;
      }

      const hash = hashElements(elements);
      if (hash === lastSentHash) return; // nothing substantive changed
      lastSentHash = hash;
      handle.sendWatch(WATCH_PROMPT);
```

- [ ] **Step 4: Wire `sendMention` into BrainstormApp's handle**

In `editor/canvases/brainstorm/BrainstormApp.tsx`, change the `startWatchLoop` call (lines 92-95) from:

```ts
    const stop = startWatchLoop(canvasUrl, {
      sendWatch: (prompt) => chatHandleRef.current?.sendWatch(prompt),
      isRunning: () => chatHandleRef.current?.isRunning() ?? false,
    });
```

to:

```ts
    const stop = startWatchLoop(canvasUrl, {
      sendWatch: (prompt) => chatHandleRef.current?.sendWatch(prompt),
      sendMention: (prompt, bubble) =>
        chatHandleRef.current?.sendMention(prompt, bubble),
      isRunning: () => chatHandleRef.current?.isRunning() ?? false,
    });
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS (the existing `hashElements` + new `detectMentions`/guard/`buildMentionTurn` tests; `wake()`'s glue is exercised indirectly — its pieces are unit-tested).

- [ ] **Step 7: Commit**

```bash
git add editor/canvases/brainstorm/watch.ts editor/canvases/brainstorm/BrainstormApp.tsx
git commit -m "feat(brainstorm): route @agent board mentions as editable turns"
```

---

### Task 6: Update the agent SKILL.md contract

**Files:**
- Modify: `src-tauri/skills/brainstorm/SKILL.md` (add a "Board instructions (@agent)" subsection under "Two modes", after the Continuous mode block ~line 46)

**Interfaces:** none (documentation the agent reads at runtime).

- [ ] **Step 1: Add the board-instruction contract**

In `src-tauri/skills/brainstorm/SKILL.md`, after the Continuous (watch) mode bullet list (after line 46, before the `## Etiquette` heading at line 48), insert:

```markdown
### Board instructions (`@agent`)

Sometimes a turn arrives prefixed `[board instruction]`. This means the user
wrote one or more `@agent …` text notes on the board, and the app has routed
them to you as an **editable** turn (unlike watch mode, you MAY draw here).

- Read the board first (`describe_scene` / `get_canvas_screenshot`).
- Do what each instruction asks, making the smallest change that satisfies it.
- **Then delete each cited element** with `delete_element` (the prompt lists
  their ids). This is what "reconciles" the note — once removed it won't fire
  again.
- Briefly say in chat what you did (one or two sentences). Don't repeat the
  whole instruction back — it's already shown in the chat.
```

- [ ] **Step 2: Verify the file still reads coherently**

Run: `sed -n '32,60p' src-tauri/skills/brainstorm/SKILL.md`
Expected: the new `### Board instructions (@agent)` section sits between the Continuous mode block and `## Etiquette`.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/skills/brainstorm/SKILL.md
git commit -m "docs(brainstorm): document the @agent board-instruction turn"
```

---

### Task 7: Manual end-to-end verification

**Files:** none (runtime verification).

**Interfaces:** none.

> This task has no automated test — it confirms the wired feature works against a
> live canvas server, which the unit tests deliberately don't spin up.

- [ ] **Step 1: Launch the app**

Run: `npm run tauri:dev` (per the dev-server gotcha in memory, read the output file rather than spawning a background wait-loop). Open a Brainstorm Canvas project.

- [ ] **Step 2: Enter continuous mode and open the board**

Switch Mode to **Continuous**. Open the board window. Add a couple of plain shapes/notes so the board is non-empty.

- [ ] **Step 3: Drop an `@agent` note**

Add a text element: `@agent add a node labelled "pricing" near the center`. Stop editing and wait ~4s (QUIET_MS).

- [ ] **Step 4: Verify the behavior**

Expected, within one tick:
- A **user bubble** appears in chat reading `add a node labelled "pricing" near the center` (the `@agent` stripped).
- The agent **creates** the pricing node on the board.
- The agent **deletes** the `@agent` text note from the board.
- The agent posts a brief chat reply describing what it did.
- It does **not** re-fire on subsequent ticks (note is gone; and even if delete failed, the send-once guard prevents re-fire until the note is edited).

- [ ] **Step 5: Verify the send-once / edit-retry guard (optional but recommended)**

Add `@agent group the risk items`, let it fire, then — if the agent leaves any note — *edit* that note's text. Expected: the edited note (new version) re-triggers a fresh turn; an untouched, agent-handled note does not.

- [ ] **Step 6: Verify passive observe still works**

With no `@agent` notes on the board, draw a few elements and pause. Expected: the normal muted "observing" suggestion behavior is unchanged.

---

## Notes for the executor

- The four pure functions (`detectMentions`, `mentionSignature`, `filterUndispatched`, `buildMentionTurn`) are the testable core; `wake()`'s glue (Task 5) is thin and verified manually in Task 7.
- Do not change the `"watch"` origin's read-only posture — that's intentional. `@agent` turns are editable *because* they use the `"user"` origin.
- Branch is already `feat/brainstorm-agent-mentions` (the design doc lives there).
