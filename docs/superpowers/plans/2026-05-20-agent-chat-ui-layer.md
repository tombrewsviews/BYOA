# Agent-Chat UI Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional chat-style UI surface that runs the user's own CLI agent in structured-output mode, with per-agent adapters, governance dialogs, and a toggle to the existing terminal — without breaking current PTY behavior.

**Architecture:** New `editor/agent-chat/` directory hosts TypeScript adapters (Claude in v1; Codex/Gemini stubbed), a normalized event model, and React chat components. A new `src-tauri/src/agent_chat.rs` Tauri module spawns agents in structured-output mode using piped stdio (separate from `pty.rs`). The chat surface mounts in the same slot as `Terminal` in `editor/canvases/kinetic/KineticApp.tsx`, toggled per-project via window state. Domain knowledge stays in BYOA's skill files — the UI layer is app-agnostic and bound only to per-agent stream formats. See spec at `docs/superpowers/specs/2026-05-20-agent-chat-ui-layer-design.md`.

**Tech Stack:** TypeScript / React 19 (renderer), Rust / Tauri 2 / std::process::Command with piped stdio (backend), Vitest (tests).

**Spec reference:** `docs/superpowers/specs/2026-05-20-agent-chat-ui-layer-design.md`

---

## File Structure

**New files:**
- `editor/agent-chat/events.ts` — normalized `ChatEvent` union
- `editor/agent-chat/adapters/types.ts` — `AgentAdapter` interface
- `editor/agent-chat/adapters/claude.ts` — Claude Code adapter (v1's only real adapter)
- `editor/agent-chat/adapters/codex.ts` — stub, throws on use
- `editor/agent-chat/adapters/gemini.ts` — stub, throws on use
- `editor/agent-chat/adapters/registry.ts` — `getAdapter(agentId)` lookup
- `editor/agent-chat/ChatStore.ts` — in-memory session model
- `editor/agent-chat/Chat.tsx` — top-level surface
- `editor/agent-chat/Message.tsx` — assistant bubble
- `editor/agent-chat/UserMessage.tsx` — user bubble
- `editor/agent-chat/ToolCard.tsx` — tool-call summary card
- `editor/agent-chat/PermissionDialog.tsx` — governance dialog
- `editor/agent-chat/Composer.tsx` — input area
- `editor/agent-chat/SessionToolbar.tsx` — agent label + view-switch button
- `editor/agent-chat/__fixtures__/claude-prose.jsonl` — recorded Claude stream
- `editor/agent-chat/__fixtures__/claude-tool-call.jsonl`
- `editor/agent-chat/__fixtures__/claude-permission-allow.jsonl`
- `editor/agent-chat/__fixtures__/claude-permission-deny.jsonl`
- `editor/agent-chat/__fixtures__/claude-error.jsonl`
- `editor/agent-chat/__fixtures__/claude-multiturn.jsonl`
- `editor/agent-chat/__tests__/adapter-claude.test.ts`
- `editor/agent-chat/__tests__/chat-store.test.ts`
- `editor/agent-chat/__tests__/permission-dialog.test.tsx`
- `src-tauri/src/agent_chat.rs` — process spawn, stdio pump, Tauri commands
- `vitest.config.ts` — test runner config (project currently has none)

**Modified files:**
- `src-tauri/src/lib.rs` — register new module + Tauri commands
- `src-tauri/src/window_state.rs` — add `view_mode` per-project field
- `editor/canvases/kinetic/KineticApp.tsx:601-616` — mount `Chat` or `Terminal` based on view toggle
- `package.json` — add `vitest`, `@testing-library/react`, `@testing-library/dom`, `jsdom` devDependencies; add `"test": "vitest run"` script

---

## Wave 1 — Foundations (no UI yet, no Rust yet)

### Task 1: Test infrastructure

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `editor/agent-chat/__tests__/.gitkeep`

- [ ] **Step 1: Install test deps**

```bash
npm install --save-dev vitest@^2 @testing-library/react@^16 @testing-library/dom@^10 @testing-library/jest-dom@^6 jsdom@^25 @vitest/coverage-v8@^2
```

Expected: deps appear in `package.json` devDependencies.

- [ ] **Step 2: Add test script**

Edit `package.json` `scripts` section. Replace:
```json
    "tauri:build": "tauri build"
```
with:
```json
    "tauri:build": "tauri build",
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

Create new file `/Users/parandykt/Apps/KineticType/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["editor/agent-chat/__tests__/**/*.test.{ts,tsx}"],
    globals: false,
  },
});
```

- [ ] **Step 4: Verify test runner works (no tests yet)**

Run: `npm test`
Expected: vitest runs, reports "No test files found" (or `0 passed`), exits 0.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts editor/agent-chat/__tests__/.gitkeep
git commit -m "chore: add vitest + testing-library for agent-chat tests"
```

---

### Task 2: Normalized event model

**Files:**
- Create: `editor/agent-chat/events.ts`
- Create: `editor/agent-chat/__tests__/events.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/__tests__/events.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { ChatEvent } from "../events";
import { isMessageDelta, isToolCall, isPermissionRequest } from "../events";

describe("ChatEvent guards", () => {
  it("isMessageDelta narrows correctly", () => {
    const e: ChatEvent = {
      kind: "message-delta",
      turnId: "t1",
      text: "hi",
    };
    expect(isMessageDelta(e)).toBe(true);
    if (isMessageDelta(e)) {
      // type-narrowing: this should compile
      expect(e.text).toBe("hi");
    }
  });

  it("isToolCall returns false for other kinds", () => {
    const e: ChatEvent = {
      kind: "message-delta",
      turnId: "t1",
      text: "hi",
    };
    expect(isToolCall(e)).toBe(false);
  });

  it("isPermissionRequest narrows tool/args/scope", () => {
    const e: ChatEvent = {
      kind: "permission-request",
      promptId: "p1",
      tool: "Edit",
      args: { path: "/x" },
      scope: "file",
    };
    expect(isPermissionRequest(e)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — "Cannot find module '../events'".

- [ ] **Step 3: Write the events module**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/events.ts`:

```ts
/**
 * Normalized event model for the agent-chat UI layer.
 *
 * Each per-agent adapter parses its agent's structured output stream
 * into these events. The UI is a pure consumer — no agent-specific
 * conditionals live above this boundary.
 *
 * `input` and `output` are `unknown` deliberately. The UI inspects
 * them for known shapes (e.g. file paths in Edit calls) but treats
 * unknown shapes as opaque JSON to render.
 */
export type ChatEvent =
  | { kind: "turn-start"; turnId: string; startedAt: number }
  | { kind: "message-delta"; turnId: string; text: string }
  | { kind: "message-end"; turnId: string }
  | {
      kind: "tool-call";
      turnId: string;
      callId: string;
      name: string;
      input: unknown;
    }
  | {
      kind: "tool-result";
      callId: string;
      ok: boolean;
      output: unknown;
    }
  | {
      kind: "permission-request";
      promptId: string;
      tool: string;
      args: unknown;
      scope: string;
    }
  | {
      kind: "permission-decided";
      promptId: string;
      decision: "allow" | "allow-always" | "deny";
    }
  | {
      kind: "error";
      turnId?: string;
      message: string;
      recoverable: boolean;
    }
  | { kind: "turn-end"; turnId: string; endedAt: number };

export type ChatEventKind = ChatEvent["kind"];

export const isMessageDelta = (
  e: ChatEvent,
): e is Extract<ChatEvent, { kind: "message-delta" }> =>
  e.kind === "message-delta";

export const isToolCall = (
  e: ChatEvent,
): e is Extract<ChatEvent, { kind: "tool-call" }> => e.kind === "tool-call";

export const isToolResult = (
  e: ChatEvent,
): e is Extract<ChatEvent, { kind: "tool-result" }> => e.kind === "tool-result";

export const isPermissionRequest = (
  e: ChatEvent,
): e is Extract<ChatEvent, { kind: "permission-request" }> =>
  e.kind === "permission-request";

export const isTurnEnd = (
  e: ChatEvent,
): e is Extract<ChatEvent, { kind: "turn-end" }> => e.kind === "turn-end";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — 3 tests in `events.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add editor/agent-chat/events.ts editor/agent-chat/__tests__/events.test.ts
git commit -m "feat(agent-chat): add normalized ChatEvent model"
```

---

### Task 3: Adapter interface + registry + stubs

**Files:**
- Create: `editor/agent-chat/adapters/types.ts`
- Create: `editor/agent-chat/adapters/codex.ts`
- Create: `editor/agent-chat/adapters/gemini.ts`
- Create: `editor/agent-chat/adapters/registry.ts`
- Create: `editor/agent-chat/__tests__/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/__tests__/registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getAdapter } from "../adapters/registry";

describe("adapter registry", () => {
  it("returns null for unsupported agents in v1", () => {
    expect(getAdapter("codex")).not.toBeNull();
    expect(getAdapter("gemini")).not.toBeNull();
    // claude adapter lands in Task 4 — until then, registry returns
    // null for it too. This test will be updated when claude adapter
    // is added.
  });

  it("stub adapters declare no spawn args (chat disabled)", () => {
    const codex = getAdapter("codex");
    expect(codex).not.toBeNull();
    expect(
      codex!.spawnArgs({ cwd: "/tmp", skipPermissions: false }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — "Cannot find module '../adapters/registry'".

- [ ] **Step 3: Write the adapter interface**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/adapters/types.ts`:

```ts
import type { ChatEvent } from "../events";

export type AgentId = "claude" | "codex" | "gemini";

export interface SpawnArgs {
  cmd: string;
  args: string[];
  env: Record<string, string>;
}

export interface AgentAdapter {
  /** Stable id matching src-tauri/src/agents.rs AgentKind::id(). */
  readonly id: AgentId;

  /**
   * Command + args to launch the agent in structured-output mode.
   * Returning null means "this agent cannot run in structured mode" —
   * the chat-view toggle will be disabled for it.
   */
  spawnArgs(opts: { cwd: string; skipPermissions: boolean }): SpawnArgs | null;

  /**
   * Parse a chunk of raw bytes from the agent's stdout into zero or
   * more normalized events. Adapter is stateful (line buffering, etc.).
   */
  parseChunk(chunk: Uint8Array, emit: (e: ChatEvent) => void): void;

  /** Encode a user prose message for the agent's stdin. */
  encodeUserInput(text: string, attachments: string[]): Uint8Array;

  /**
   * Encode a permission decision for the agent's stdin. Returns null
   * if this agent's permission flow uses an out-of-band channel.
   */
  encodePermissionDecision(
    promptId: string,
    decision: "allow" | "allow-always" | "deny",
  ): Uint8Array | null;
}
```

- [ ] **Step 4: Write the Codex stub**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/adapters/codex.ts`:

```ts
import type { AgentAdapter } from "./types";

export const codexAdapter: AgentAdapter = {
  id: "codex",
  spawnArgs: () => null,
  parseChunk: () => {
    throw new Error("codex adapter not implemented in v1");
  },
  encodeUserInput: () => {
    throw new Error("codex adapter not implemented in v1");
  },
  encodePermissionDecision: () => null,
};
```

- [ ] **Step 5: Write the Gemini stub**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/adapters/gemini.ts`:

```ts
import type { AgentAdapter } from "./types";

export const geminiAdapter: AgentAdapter = {
  id: "gemini",
  spawnArgs: () => null,
  parseChunk: () => {
    throw new Error("gemini adapter not implemented in v1");
  },
  encodeUserInput: () => {
    throw new Error("gemini adapter not implemented in v1");
  },
  encodePermissionDecision: () => null,
};
```

- [ ] **Step 6: Write the registry**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/adapters/registry.ts`:

```ts
import type { AgentAdapter, AgentId } from "./types";
import { codexAdapter } from "./codex";
import { geminiAdapter } from "./gemini";

const adapters: Partial<Record<AgentId, AgentAdapter>> = {
  codex: codexAdapter,
  gemini: geminiAdapter,
  // claude added in the next task
};

export const getAdapter = (id: string): AgentAdapter | null =>
  adapters[id as AgentId] ?? null;
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test`
Expected: PASS — registry tests green.

- [ ] **Step 8: Commit**

```bash
git add editor/agent-chat/adapters/types.ts editor/agent-chat/adapters/codex.ts editor/agent-chat/adapters/gemini.ts editor/agent-chat/adapters/registry.ts editor/agent-chat/__tests__/registry.test.ts
git commit -m "feat(agent-chat): adapter interface + codex/gemini stubs"
```

---

## Wave 2 — The Claude adapter (the real work)

### Task 4: Claude adapter — spawn args + prose stream

**Files:**
- Create: `editor/agent-chat/adapters/claude.ts`
- Create: `editor/agent-chat/__fixtures__/claude-prose.jsonl`
- Create: `editor/agent-chat/__tests__/adapter-claude.test.ts`
- Modify: `editor/agent-chat/adapters/registry.ts`

- [ ] **Step 1: Write the prose fixture**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/__fixtures__/claude-prose.jsonl`. This is the format Claude Code emits in `--output-format stream-json --verbose`: newline-delimited JSON. One synthetic-but-format-accurate exchange:

```jsonl
{"type":"system","subtype":"init","session_id":"sess-1","model":"claude-opus-4-7","tools":["Read","Edit","Bash"]}
{"type":"assistant","message":{"id":"msg_1","role":"assistant","content":[{"type":"text","text":"Hello"}]}}
{"type":"assistant","message":{"id":"msg_1","role":"assistant","content":[{"type":"text","text":"Hello, world"}]}}
{"type":"result","subtype":"success","session_id":"sess-1","total_cost_usd":0.01,"is_error":false}
```

- [ ] **Step 2: Write the failing test**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/__tests__/adapter-claude.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claudeAdapter } from "../adapters/claude";
import type { ChatEvent } from "../events";

const fixture = (name: string): Uint8Array =>
  new TextEncoder().encode(
    readFileSync(join(__dirname, "..", "__fixtures__", name), "utf-8"),
  );

const collect = (bytes: Uint8Array): ChatEvent[] => {
  const events: ChatEvent[] = [];
  claudeAdapter.parseChunk(bytes, (e) => events.push(e));
  return events;
};

describe("claudeAdapter.spawnArgs", () => {
  it("returns claude with stream-json flags", () => {
    const s = claudeAdapter.spawnArgs({ cwd: "/x", skipPermissions: false });
    expect(s).not.toBeNull();
    expect(s!.cmd).toBe("claude");
    expect(s!.args).toContain("--output-format");
    expect(s!.args).toContain("stream-json");
    expect(s!.args).toContain("--verbose");
  });

  it("adds --dangerously-skip-permissions when requested", () => {
    const s = claudeAdapter.spawnArgs({ cwd: "/x", skipPermissions: true });
    expect(s!.args).toContain("--dangerously-skip-permissions");
  });
});

describe("claudeAdapter.parseChunk — prose", () => {
  it("emits turn-start, message-delta, turn-end", () => {
    const events = collect(fixture("claude-prose.jsonl"));
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("turn-start");
    expect(kinds).toContain("message-delta");
    expect(kinds).toContain("turn-end");
    const deltas = events
      .filter((e) => e.kind === "message-delta")
      .map((e) => (e as { text: string }).text);
    expect(deltas.join("")).toContain("Hello");
  });

  it("handles chunks split across newlines", () => {
    const full = fixture("claude-prose.jsonl");
    const a = full.slice(0, 40);
    const b = full.slice(40);
    const events: ChatEvent[] = [];
    claudeAdapter.parseChunk(a, (e) => events.push(e));
    claudeAdapter.parseChunk(b, (e) => events.push(e));
    expect(events.some((e) => e.kind === "turn-end")).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — "Cannot find module '../adapters/claude'".

- [ ] **Step 4: Write the Claude adapter (prose-only first cut)**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/adapters/claude.ts`:

```ts
import type { ChatEvent } from "../events";
import type { AgentAdapter, SpawnArgs } from "./types";

interface ClaudeStreamLine {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    id: string;
    role: string;
    content?: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: unknown }
    >;
  };
  is_error?: boolean;
}

interface AdapterState {
  buf: string;
  decoder: TextDecoder;
  turnId: string | null;
  emittedText: Map<string, string>;
}

const state: AdapterState = {
  buf: "",
  decoder: new TextDecoder(),
  turnId: null,
  emittedText: new Map(),
};

const startTurnIfNeeded = (emit: (e: ChatEvent) => void): string => {
  if (state.turnId) return state.turnId;
  const id = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  state.turnId = id;
  emit({ kind: "turn-start", turnId: id, startedAt: Date.now() });
  return id;
};

const handleLine = (line: string, emit: (e: ChatEvent) => void): void => {
  if (!line.trim()) return;
  let evt: ClaudeStreamLine;
  try {
    evt = JSON.parse(line);
  } catch {
    emit({
      kind: "error",
      message: `claude adapter: invalid JSON line (${line.slice(0, 80)})`,
      recoverable: true,
    });
    return;
  }

  if (evt.type === "system" && evt.subtype === "init") {
    return; // session start metadata — nothing to emit
  }

  if (evt.type === "assistant" && evt.message) {
    const turnId = startTurnIfNeeded(emit);
    const msgId = evt.message.id;
    const fullText =
      evt.message.content
        ?.filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("") ?? "";
    const previous = state.emittedText.get(msgId) ?? "";
    if (fullText.length > previous.length) {
      const delta = fullText.slice(previous.length);
      state.emittedText.set(msgId, fullText);
      emit({ kind: "message-delta", turnId, text: delta });
    }
    return;
  }

  if (evt.type === "result") {
    const turnId = state.turnId ?? startTurnIfNeeded(emit);
    if (evt.is_error) {
      emit({
        kind: "error",
        turnId,
        message: "claude reported error result",
        recoverable: false,
      });
    }
    emit({ kind: "turn-end", turnId, endedAt: Date.now() });
    state.turnId = null;
    state.emittedText.clear();
    return;
  }
};

const parseChunk = (
  chunk: Uint8Array,
  emit: (e: ChatEvent) => void,
): void => {
  state.buf += state.decoder.decode(chunk, { stream: true });
  let nl: number;
  while ((nl = state.buf.indexOf("\n")) >= 0) {
    const line = state.buf.slice(0, nl);
    state.buf = state.buf.slice(nl + 1);
    handleLine(line, emit);
  }
};

const spawnArgs = (opts: {
  cwd: string;
  skipPermissions: boolean;
}): SpawnArgs => {
  const args = ["--output-format", "stream-json", "--verbose"];
  if (opts.skipPermissions) args.push("--dangerously-skip-permissions");
  return { cmd: "claude", args, env: {} };
};

const encodeUserInput = (text: string, attachments: string[]): Uint8Array => {
  const refs = attachments.map((p) => `@${p}`).join(" ");
  const composed = refs ? `${refs}\n\n${text}` : text;
  return new TextEncoder().encode(composed + "\n");
};

const encodePermissionDecision = (
  _promptId: string,
  decision: "allow" | "allow-always" | "deny",
): Uint8Array =>
  new TextEncoder().encode(
    decision === "deny" ? "n\n" : decision === "allow-always" ? "a\n" : "y\n",
  );

export const claudeAdapter: AgentAdapter = {
  id: "claude",
  spawnArgs,
  parseChunk,
  encodeUserInput,
  encodePermissionDecision,
};
```

- [ ] **Step 5: Register the adapter**

Edit `/Users/parandykt/Apps/KineticType/editor/agent-chat/adapters/registry.ts`. Replace:

```ts
const adapters: Partial<Record<AgentId, AgentAdapter>> = {
  codex: codexAdapter,
  gemini: geminiAdapter,
  // claude added in the next task
};
```

with:

```ts
import { claudeAdapter } from "./claude";

const adapters: Partial<Record<AgentId, AgentAdapter>> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
};
```

(Also remove the duplicate `import { codexAdapter }` line if it appears twice after editing — keep the file imports clean.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — Claude adapter tests + the chunked-input test all green.

- [ ] **Step 7: Commit**

```bash
git add editor/agent-chat/adapters/claude.ts editor/agent-chat/adapters/registry.ts editor/agent-chat/__fixtures__/claude-prose.jsonl editor/agent-chat/__tests__/adapter-claude.test.ts
git commit -m "feat(agent-chat): claude adapter — spawn args + prose stream"
```

---

### Task 5: Claude adapter — tool calls and results

**Files:**
- Create: `editor/agent-chat/__fixtures__/claude-tool-call.jsonl`
- Modify: `editor/agent-chat/adapters/claude.ts`
- Modify: `editor/agent-chat/__tests__/adapter-claude.test.ts`

- [ ] **Step 1: Write the tool-call fixture**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/__fixtures__/claude-tool-call.jsonl`:

```jsonl
{"type":"system","subtype":"init","session_id":"sess-2"}
{"type":"assistant","message":{"id":"msg_2","role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"/x/story.json"}}]}}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"{\"beats\":[]}","is_error":false}]}}
{"type":"result","subtype":"success","session_id":"sess-2","is_error":false}
```

- [ ] **Step 2: Append the failing test**

Append to `/Users/parandykt/Apps/KineticType/editor/agent-chat/__tests__/adapter-claude.test.ts`:

```ts
describe("claudeAdapter.parseChunk — tool calls", () => {
  it("emits tool-call with name + input, then tool-result", () => {
    const events = collect(fixture("claude-tool-call.jsonl"));
    const call = events.find((e) => e.kind === "tool-call");
    expect(call).toBeDefined();
    expect((call as { name: string }).name).toBe("Read");
    expect((call as { input: { file_path: string } }).input.file_path).toBe(
      "/x/story.json",
    );

    const result = events.find((e) => e.kind === "tool-result");
    expect(result).toBeDefined();
    expect((result as { ok: boolean }).ok).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `call` is `undefined`.

- [ ] **Step 4: Extend the adapter to handle tool-use and tool-result**

Edit `/Users/parandykt/Apps/KineticType/editor/agent-chat/adapters/claude.ts`. Replace the `ClaudeStreamLine` interface with:

```ts
interface ClaudeStreamLine {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    id: string;
    role: string;
    content?: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: unknown }
      | {
          type: "tool_result";
          tool_use_id: string;
          content: unknown;
          is_error?: boolean;
        }
    >;
  };
  is_error?: boolean;
}
```

Then replace the `if (evt.type === "assistant" && evt.message) { ... }` block with:

```ts
  if (evt.type === "assistant" && evt.message) {
    const turnId = startTurnIfNeeded(emit);
    const msgId = evt.message.id;
    for (const c of evt.message.content ?? []) {
      if (c.type === "text") {
        const fullText =
          evt.message.content
            ?.filter(
              (x): x is { type: "text"; text: string } => x.type === "text",
            )
            .map((x) => x.text)
            .join("") ?? "";
        const previous = state.emittedText.get(msgId) ?? "";
        if (fullText.length > previous.length) {
          const delta = fullText.slice(previous.length);
          state.emittedText.set(msgId, fullText);
          emit({ kind: "message-delta", turnId, text: delta });
        }
        break; // text already aggregated for the whole message
      }
      if (c.type === "tool_use") {
        emit({
          kind: "tool-call",
          turnId,
          callId: c.id,
          name: c.name,
          input: c.input,
        });
      }
    }
    return;
  }

  if (evt.type === "user" && evt.message) {
    for (const c of evt.message.content ?? []) {
      if (c.type === "tool_result") {
        emit({
          kind: "tool-result",
          callId: c.tool_use_id,
          ok: !c.is_error,
          output: c.content,
        });
      }
    }
    return;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — including the new tool-call test and all previous tests.

- [ ] **Step 6: Commit**

```bash
git add editor/agent-chat/adapters/claude.ts editor/agent-chat/__fixtures__/claude-tool-call.jsonl editor/agent-chat/__tests__/adapter-claude.test.ts
git commit -m "feat(agent-chat): claude adapter — tool-call and tool-result"
```

---

### Task 6: Claude adapter — permission requests + decisions

**Files:**
- Create: `editor/agent-chat/__fixtures__/claude-permission-allow.jsonl`
- Create: `editor/agent-chat/__fixtures__/claude-permission-deny.jsonl`
- Modify: `editor/agent-chat/adapters/claude.ts`
- Modify: `editor/agent-chat/__tests__/adapter-claude.test.ts`

- [ ] **Step 1: Write the allow fixture**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/__fixtures__/claude-permission-allow.jsonl`:

```jsonl
{"type":"system","subtype":"init","session_id":"sess-3"}
{"type":"assistant","message":{"id":"msg_3","role":"assistant","content":[{"type":"tool_use","id":"toolu_2","name":"Edit","input":{"file_path":"/x/story.json","old_string":"a","new_string":"b"}}]}}
{"type":"permission_request","prompt_id":"perm-1","tool":"Edit","args":{"file_path":"/x/story.json"},"scope":"file"}
{"type":"permission_decision","prompt_id":"perm-1","decision":"allow"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_2","content":"ok","is_error":false}]}}
{"type":"result","subtype":"success","session_id":"sess-3","is_error":false}
```

- [ ] **Step 2: Write the deny fixture**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/__fixtures__/claude-permission-deny.jsonl`:

```jsonl
{"type":"system","subtype":"init","session_id":"sess-4"}
{"type":"assistant","message":{"id":"msg_4","role":"assistant","content":[{"type":"tool_use","id":"toolu_3","name":"Bash","input":{"command":"rm -rf /"}}]}}
{"type":"permission_request","prompt_id":"perm-2","tool":"Bash","args":{"command":"rm -rf /"},"scope":"command"}
{"type":"permission_decision","prompt_id":"perm-2","decision":"deny"}
{"type":"result","subtype":"success","session_id":"sess-4","is_error":false}
```

**Note on fixture realism:** Claude's actual stream-json format for permission prompts is not fully stable across versions. These fixtures encode the adapter's *expected normalized contract*; if Claude's real shape differs, only the `handleLine` parsing branch changes — the emitted `ChatEvent`s stay identical.

- [ ] **Step 3: Append the failing tests**

Append to `/Users/parandykt/Apps/KineticType/editor/agent-chat/__tests__/adapter-claude.test.ts`:

```ts
describe("claudeAdapter.parseChunk — permissions", () => {
  it("emits permission-request and permission-decided for allow flow", () => {
    const events = collect(fixture("claude-permission-allow.jsonl"));
    const req = events.find((e) => e.kind === "permission-request");
    expect(req).toBeDefined();
    expect((req as { tool: string }).tool).toBe("Edit");
    const decided = events.find((e) => e.kind === "permission-decided");
    expect((decided as { decision: string }).decision).toBe("allow");
  });

  it("emits permission-decided=deny for deny flow", () => {
    const events = collect(fixture("claude-permission-deny.jsonl"));
    const decided = events.find((e) => e.kind === "permission-decided");
    expect((decided as { decision: string }).decision).toBe("deny");
  });
});

describe("claudeAdapter.encodePermissionDecision", () => {
  it("returns 'y' for allow", () => {
    const bytes = claudeAdapter.encodePermissionDecision("p", "allow");
    expect(new TextDecoder().decode(bytes!)).toBe("y\n");
  });
  it("returns 'n' for deny", () => {
    const bytes = claudeAdapter.encodePermissionDecision("p", "deny");
    expect(new TextDecoder().decode(bytes!)).toBe("n\n");
  });
  it("returns 'a' for allow-always", () => {
    const bytes = claudeAdapter.encodePermissionDecision("p", "allow-always");
    expect(new TextDecoder().decode(bytes!)).toBe("a\n");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — permission-request events are not yet emitted.

- [ ] **Step 5: Extend the adapter**

Edit `/Users/parandykt/Apps/KineticType/editor/agent-chat/adapters/claude.ts`. Add to `ClaudeStreamLine`:

```ts
  prompt_id?: string;
  tool?: string;
  args?: unknown;
  scope?: string;
  decision?: "allow" | "allow-always" | "deny";
```

Then add these branches inside `handleLine`, just before the final closing `}` of the function:

```ts
  if (evt.type === "permission_request" && evt.prompt_id && evt.tool) {
    emit({
      kind: "permission-request",
      promptId: evt.prompt_id,
      tool: evt.tool,
      args: evt.args ?? {},
      scope: evt.scope ?? "unknown",
    });
    return;
  }

  if (evt.type === "permission_decision" && evt.prompt_id && evt.decision) {
    emit({
      kind: "permission-decided",
      promptId: evt.prompt_id,
      decision: evt.decision,
    });
    return;
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all permission tests green.

- [ ] **Step 7: Commit**

```bash
git add editor/agent-chat/adapters/claude.ts editor/agent-chat/__fixtures__/claude-permission-allow.jsonl editor/agent-chat/__fixtures__/claude-permission-deny.jsonl editor/agent-chat/__tests__/adapter-claude.test.ts
git commit -m "feat(agent-chat): claude adapter — permission request/decision flow"
```

---

### Task 7: Claude adapter — error and multi-turn fixtures

**Files:**
- Create: `editor/agent-chat/__fixtures__/claude-error.jsonl`
- Create: `editor/agent-chat/__fixtures__/claude-multiturn.jsonl`
- Modify: `editor/agent-chat/__tests__/adapter-claude.test.ts`

- [ ] **Step 1: Write the error fixture**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/__fixtures__/claude-error.jsonl`:

```jsonl
{"type":"system","subtype":"init","session_id":"sess-5"}
{"type":"assistant","message":{"id":"msg_5","role":"assistant","content":[{"type":"text","text":"trying"}]}}
not valid json at all
{"type":"assistant","message":{"id":"msg_5","role":"assistant","content":[{"type":"text","text":"trying again"}]}}
{"type":"result","subtype":"success","session_id":"sess-5","is_error":false}
```

- [ ] **Step 2: Write the multi-turn fixture**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/__fixtures__/claude-multiturn.jsonl`:

```jsonl
{"type":"system","subtype":"init","session_id":"sess-6"}
{"type":"assistant","message":{"id":"msg_a","role":"assistant","content":[{"type":"text","text":"first"}]}}
{"type":"result","subtype":"success","session_id":"sess-6","is_error":false}
{"type":"assistant","message":{"id":"msg_b","role":"assistant","content":[{"type":"text","text":"second"}]}}
{"type":"result","subtype":"success","session_id":"sess-6","is_error":false}
```

- [ ] **Step 3: Append the tests**

Append to `/Users/parandykt/Apps/KineticType/editor/agent-chat/__tests__/adapter-claude.test.ts`:

```ts
describe("claudeAdapter.parseChunk — error recovery", () => {
  it("emits recoverable error on invalid JSON line, keeps parsing", () => {
    const events = collect(fixture("claude-error.jsonl"));
    const err = events.find((e) => e.kind === "error");
    expect(err).toBeDefined();
    expect((err as { recoverable: boolean }).recoverable).toBe(true);
    // The line after the bad one still produces a message-delta:
    const deltas = events.filter((e) => e.kind === "message-delta");
    expect(deltas.length).toBeGreaterThan(0);
  });
});

describe("claudeAdapter.parseChunk — multi-turn", () => {
  it("produces two turn-start / turn-end pairs", () => {
    const events = collect(fixture("claude-multiturn.jsonl"));
    const starts = events.filter((e) => e.kind === "turn-start");
    const ends = events.filter((e) => e.kind === "turn-end");
    expect(starts.length).toBe(2);
    expect(ends.length).toBe(2);
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — error-recovery and multi-turn tests both green. (If the multi-turn test fails because `state.turnId` doesn't reset cleanly, that's a real adapter bug — the prior task should have reset it on `turn-end`. Verify by reading the `handleLine` `result` branch.)

- [ ] **Step 5: Commit**

```bash
git add editor/agent-chat/__fixtures__/claude-error.jsonl editor/agent-chat/__fixtures__/claude-multiturn.jsonl editor/agent-chat/__tests__/adapter-claude.test.ts
git commit -m "test(agent-chat): claude adapter — error recovery and multi-turn"
```

---

## Wave 3 — ChatStore (state) and components

### Task 8: ChatStore — session model + reducer

**Files:**
- Create: `editor/agent-chat/ChatStore.ts`
- Create: `editor/agent-chat/__tests__/chat-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/__tests__/chat-store.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createChatStore } from "../ChatStore";
import type { ChatEvent } from "../events";

const apply = (events: ChatEvent[]) => {
  const store = createChatStore();
  for (const e of events) store.applyEvent(e);
  return store.getState();
};

describe("ChatStore", () => {
  it("accumulates message-delta into the current assistant bubble", () => {
    const s = apply([
      { kind: "turn-start", turnId: "t1", startedAt: 0 },
      { kind: "message-delta", turnId: "t1", text: "Hel" },
      { kind: "message-delta", turnId: "t1", text: "lo" },
      { kind: "turn-end", turnId: "t1", endedAt: 1 },
    ]);
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0].assistantText).toBe("Hello");
    expect(s.turns[0].status).toBe("ended");
  });

  it("records tool calls and pairs them with results by callId", () => {
    const s = apply([
      { kind: "turn-start", turnId: "t1", startedAt: 0 },
      {
        kind: "tool-call",
        turnId: "t1",
        callId: "c1",
        name: "Read",
        input: { file_path: "/x" },
      },
      { kind: "tool-result", callId: "c1", ok: true, output: "data" },
      { kind: "turn-end", turnId: "t1", endedAt: 1 },
    ]);
    expect(s.turns[0].toolCalls).toHaveLength(1);
    expect(s.turns[0].toolCalls[0].name).toBe("Read");
    expect(s.turns[0].toolCalls[0].result?.ok).toBe(true);
  });

  it("tracks a single pending permission at a time", () => {
    const store = createChatStore();
    store.applyEvent({ kind: "turn-start", turnId: "t1", startedAt: 0 });
    store.applyEvent({
      kind: "permission-request",
      promptId: "p1",
      tool: "Edit",
      args: {},
      scope: "file",
    });
    expect(store.getState().pendingPermission?.promptId).toBe("p1");
    store.applyEvent({
      kind: "permission-decided",
      promptId: "p1",
      decision: "allow",
    });
    expect(store.getState().pendingPermission).toBeNull();
  });

  it("notifies subscribers on change", () => {
    const store = createChatStore();
    let count = 0;
    const unsub = store.subscribe(() => count++);
    store.applyEvent({ kind: "turn-start", turnId: "t1", startedAt: 0 });
    store.applyEvent({ kind: "message-delta", turnId: "t1", text: "x" });
    expect(count).toBe(2);
    unsub();
    store.applyEvent({ kind: "turn-end", turnId: "t1", endedAt: 1 });
    expect(count).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — "Cannot find module '../ChatStore'".

- [ ] **Step 3: Write the ChatStore**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/ChatStore.ts`:

```ts
import type { ChatEvent } from "./events";

export interface ToolCallRecord {
  callId: string;
  name: string;
  input: unknown;
  result: { ok: boolean; output: unknown } | null;
}

export interface TurnRecord {
  turnId: string;
  startedAt: number;
  endedAt: number | null;
  assistantText: string;
  toolCalls: ToolCallRecord[];
  status: "streaming" | "ended" | "errored";
  errorMessage?: string;
}

export interface PendingPermission {
  promptId: string;
  tool: string;
  args: unknown;
  scope: string;
}

export interface ChatState {
  turns: TurnRecord[];
  pendingPermission: PendingPermission | null;
  sessionAlive: boolean;
}

export interface ChatStore {
  getState(): ChatState;
  applyEvent(e: ChatEvent): void;
  subscribe(fn: () => void): () => void;
  reset(): void;
}

const initialState = (): ChatState => ({
  turns: [],
  pendingPermission: null,
  sessionAlive: true,
});

export const createChatStore = (): ChatStore => {
  let state: ChatState = initialState();
  const subs = new Set<() => void>();
  const notify = () => {
    for (const fn of subs) fn();
  };
  const currentTurn = (): TurnRecord | null =>
    state.turns.length ? state.turns[state.turns.length - 1] : null;

  return {
    getState: () => state,
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    reset: () => {
      state = initialState();
      notify();
    },
    applyEvent: (e) => {
      switch (e.kind) {
        case "turn-start": {
          state = {
            ...state,
            turns: [
              ...state.turns,
              {
                turnId: e.turnId,
                startedAt: e.startedAt,
                endedAt: null,
                assistantText: "",
                toolCalls: [],
                status: "streaming",
              },
            ],
          };
          break;
        }
        case "message-delta": {
          const t = currentTurn();
          if (!t || t.turnId !== e.turnId) break;
          const updated: TurnRecord = {
            ...t,
            assistantText: t.assistantText + e.text,
          };
          state = {
            ...state,
            turns: [...state.turns.slice(0, -1), updated],
          };
          break;
        }
        case "tool-call": {
          const t = currentTurn();
          if (!t || t.turnId !== e.turnId) break;
          const updated: TurnRecord = {
            ...t,
            toolCalls: [
              ...t.toolCalls,
              {
                callId: e.callId,
                name: e.name,
                input: e.input,
                result: null,
              },
            ],
          };
          state = {
            ...state,
            turns: [...state.turns.slice(0, -1), updated],
          };
          break;
        }
        case "tool-result": {
          state = {
            ...state,
            turns: state.turns.map((t) => ({
              ...t,
              toolCalls: t.toolCalls.map((c) =>
                c.callId === e.callId
                  ? { ...c, result: { ok: e.ok, output: e.output } }
                  : c,
              ),
            })),
          };
          break;
        }
        case "permission-request": {
          state = {
            ...state,
            pendingPermission: {
              promptId: e.promptId,
              tool: e.tool,
              args: e.args,
              scope: e.scope,
            },
          };
          break;
        }
        case "permission-decided": {
          if (state.pendingPermission?.promptId === e.promptId) {
            state = { ...state, pendingPermission: null };
          }
          break;
        }
        case "error": {
          const t = currentTurn();
          if (t && (!e.turnId || t.turnId === e.turnId)) {
            const updated: TurnRecord = {
              ...t,
              status: e.recoverable ? t.status : "errored",
              errorMessage: e.message,
            };
            state = {
              ...state,
              turns: [...state.turns.slice(0, -1), updated],
              sessionAlive: e.recoverable ? state.sessionAlive : false,
            };
          }
          break;
        }
        case "turn-end": {
          state = {
            ...state,
            turns: state.turns.map((t) =>
              t.turnId === e.turnId
                ? { ...t, endedAt: e.endedAt, status: "ended" }
                : t,
            ),
          };
          break;
        }
        case "message-end":
          // No state change — message-delta accumulation is authoritative.
          return;
      }
      notify();
    },
  };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all four ChatStore tests green.

- [ ] **Step 5: Commit**

```bash
git add editor/agent-chat/ChatStore.ts editor/agent-chat/__tests__/chat-store.test.ts
git commit -m "feat(agent-chat): ChatStore session model + reducer"
```

---

### Task 9: PermissionDialog component

**Files:**
- Create: `editor/agent-chat/PermissionDialog.tsx`
- Create: `editor/agent-chat/__tests__/permission-dialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/__tests__/permission-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PermissionDialog } from "../PermissionDialog";

describe("PermissionDialog", () => {
  const pending = {
    promptId: "p1",
    tool: "Edit",
    args: { file_path: "/x/story.json" },
    scope: "file",
  };

  it("renders tool name and args summary", () => {
    render(<PermissionDialog pending={pending} onDecide={() => {}} />);
    expect(screen.getByText(/Edit/)).toBeTruthy();
    expect(screen.getByText(/story\.json/)).toBeTruthy();
  });

  it("calls onDecide('allow') when Allow once is clicked", () => {
    const onDecide = vi.fn();
    render(<PermissionDialog pending={pending} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole("button", { name: /allow once/i }));
    expect(onDecide).toHaveBeenCalledWith("p1", "allow");
  });

  it("calls onDecide('allow-always') when Allow always is clicked", () => {
    const onDecide = vi.fn();
    render(<PermissionDialog pending={pending} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole("button", { name: /allow always/i }));
    expect(onDecide).toHaveBeenCalledWith("p1", "allow-always");
  });

  it("calls onDecide('deny') when Deny is clicked", () => {
    const onDecide = vi.fn();
    render(<PermissionDialog pending={pending} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole("button", { name: /deny/i }));
    expect(onDecide).toHaveBeenCalledWith("p1", "deny");
  });

  it("treats Escape as Deny", () => {
    const onDecide = vi.fn();
    render(<PermissionDialog pending={pending} onDecide={onDecide} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDecide).toHaveBeenCalledWith("p1", "deny");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — "Cannot find module '../PermissionDialog'".

- [ ] **Step 3: Write the component**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/PermissionDialog.tsx`:

```tsx
import React, { useEffect } from "react";
import type { PendingPermission } from "./ChatStore";

export type Decision = "allow" | "allow-always" | "deny";

interface Props {
  pending: PendingPermission;
  onDecide: (promptId: string, decision: Decision) => void;
}

const summarize = (tool: string, args: unknown): string => {
  if (args && typeof args === "object") {
    const a = args as Record<string, unknown>;
    if (typeof a.file_path === "string") return String(a.file_path);
    if (typeof a.command === "string") return String(a.command);
    if (typeof a.url === "string") return String(a.url);
  }
  return tool;
};

export const PermissionDialog: React.FC<Props> = ({ pending, onDecide }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDecide(pending.promptId, "deny");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending.promptId, onDecide]);

  const summary = summarize(pending.tool, pending.args);

  return (
    <div
      role="dialog"
      aria-label={`Permission request: ${pending.tool}`}
      style={{
        position: "absolute",
        left: 16,
        right: 16,
        bottom: 80,
        background: "#15151c",
        border: "1px solid #2a2a36",
        borderRadius: 10,
        padding: 16,
        fontFamily: "system-ui, -apple-system, Helvetica Neue, sans-serif",
        color: "#e4e4ee",
        boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          opacity: 0.6,
          marginBottom: 6,
        }}
      >
        Permission required · {pending.scope}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
        {pending.tool}
      </div>
      <div
        style={{
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          fontSize: 12,
          opacity: 0.85,
          marginBottom: 14,
          wordBreak: "break-all",
        }}
      >
        {summary}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={() => onDecide(pending.promptId, "deny")}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #3a3a48",
            background: "transparent",
            color: "#e4e4ee",
            cursor: "pointer",
          }}
        >
          Deny
        </button>
        <button
          onClick={() => onDecide(pending.promptId, "allow")}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #4a4a58",
            background: "#2a2a36",
            color: "#e4e4ee",
            cursor: "pointer",
          }}
        >
          Allow once
        </button>
        <button
          onClick={() => onDecide(pending.promptId, "allow-always")}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "none",
            background: "#7c5cff",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Allow always
        </button>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Add `@testing-library/jest-dom` matchers**

Add a new line to `vitest.config.ts` `test` section: `setupFiles: ["./vitest.setup.ts"]`. The final file should read:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["editor/agent-chat/__tests__/**/*.test.{ts,tsx}"],
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

Then create `/Users/parandykt/Apps/KineticType/vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all permission-dialog tests green.

- [ ] **Step 6: Commit**

```bash
git add editor/agent-chat/PermissionDialog.tsx editor/agent-chat/__tests__/permission-dialog.test.tsx vitest.config.ts vitest.setup.ts
git commit -m "feat(agent-chat): PermissionDialog component + Escape-as-Deny"
```

---

### Task 10: Message, UserMessage, ToolCard components

**Files:**
- Create: `editor/agent-chat/Message.tsx`
- Create: `editor/agent-chat/UserMessage.tsx`
- Create: `editor/agent-chat/ToolCard.tsx`

These components are presentation-only and visually verified, so no new unit tests are required here. Their behavior is exercised by the integration acceptance criteria.

- [ ] **Step 1: Write `Message`**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/Message.tsx`:

```tsx
import React from "react";

interface Props {
  text: string;
  streaming: boolean;
}

export const Message: React.FC<Props> = ({ text, streaming }) => (
  <div
    style={{
      maxWidth: "70ch",
      fontFamily: "system-ui, -apple-system, Helvetica Neue, sans-serif",
      fontSize: 15,
      lineHeight: 1.55,
      color: "#e4e4ee",
      whiteSpace: "pre-wrap",
      padding: "10px 0",
    }}
  >
    {text}
    {streaming ? (
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 8,
          height: 14,
          background: "#7c5cff",
          marginLeft: 3,
          verticalAlign: "text-bottom",
          animation: "agentchat-pulse 1s steps(2) infinite",
        }}
      />
    ) : null}
  </div>
);
```

- [ ] **Step 2: Write `UserMessage`**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/UserMessage.tsx`:

```tsx
import React from "react";

interface Props {
  text: string;
}

export const UserMessage: React.FC<Props> = ({ text }) => (
  <div
    style={{
      maxWidth: "70ch",
      marginLeft: "auto",
      fontFamily: "system-ui, -apple-system, Helvetica Neue, sans-serif",
      fontSize: 15,
      lineHeight: 1.55,
      color: "#e4e4ee",
      background: "#1c1c26",
      borderRadius: 10,
      padding: "8px 12px",
      whiteSpace: "pre-wrap",
    }}
  >
    {text}
  </div>
);
```

- [ ] **Step 3: Write `ToolCard`**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/ToolCard.tsx`:

```tsx
import React, { useState } from "react";
import type { ToolCallRecord } from "./ChatStore";

interface Props {
  call: ToolCallRecord;
}

const summary = (call: ToolCallRecord): string => {
  const a = call.input;
  if (a && typeof a === "object") {
    const r = a as Record<string, unknown>;
    if (typeof r.file_path === "string") return String(r.file_path);
    if (typeof r.command === "string") return String(r.command);
    if (typeof r.url === "string") return String(r.url);
  }
  return "";
};

export const ToolCard: React.FC<Props> = ({ call }) => {
  const [open, setOpen] = useState(false);
  const sub = summary(call);
  const status = call.result == null ? "running" : call.result.ok ? "ok" : "err";
  const badge =
    status === "running" ? "…" : status === "ok" ? "✓" : "✗";
  const badgeColor =
    status === "running" ? "#7c5cff" : status === "ok" ? "#22c55e" : "#ef4444";

  return (
    <div
      style={{
        border: "1px solid #2a2a36",
        borderRadius: 8,
        padding: "8px 10px",
        margin: "8px 0",
        fontFamily: "system-ui, -apple-system, Helvetica Neue, sans-serif",
        fontSize: 13,
        color: "#cdcdd8",
        background: "#13131a",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "flex",
          gap: 8,
          width: "100%",
          alignItems: "center",
        }}
      >
        <span style={{ color: badgeColor, fontWeight: 600 }}>{badge}</span>
        <span style={{ fontWeight: 600 }}>{call.name}</span>
        {sub ? (
          <span
            style={{
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: 12,
              opacity: 0.8,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              minWidth: 0,
            }}
          >
            {sub}
          </span>
        ) : null}
        <span style={{ opacity: 0.55 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <pre
          style={{
            margin: "8px 0 0",
            fontSize: 12,
            background: "#0a0a10",
            padding: 8,
            borderRadius: 6,
            overflow: "auto",
            maxHeight: 240,
          }}
        >
{JSON.stringify(
              { input: call.input, result: call.result },
              null,
              2,
            )}
        </pre>
      ) : null}
    </div>
  );
};
```

- [ ] **Step 4: Commit**

```bash
git add editor/agent-chat/Message.tsx editor/agent-chat/UserMessage.tsx editor/agent-chat/ToolCard.tsx
git commit -m "feat(agent-chat): Message, UserMessage, ToolCard components"
```

---

### Task 11: Composer component with file drag-in

**Files:**
- Create: `editor/agent-chat/Composer.tsx`

- [ ] **Step 1: Write the component**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/Composer.tsx`:

```tsx
import React, { useCallback, useRef, useState } from "react";

interface Props {
  disabled: boolean;
  onSubmit: (text: string, attachments: string[]) => void;
  onStop: () => void;
  running: boolean;
}

export const Composer: React.FC<Props> = ({
  disabled,
  onSubmit,
  onStop,
  running,
}) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [dropActive, setDropActive] = useState(false);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed, attachments);
    setText("");
    setAttachments([]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDropActive(false);
      const paths: string[] = [];
      for (const f of Array.from(e.dataTransfer.files)) {
        // Tauri exposes the absolute path on dropped files via the
        // non-standard `path` property. Browser fallback: just the name.
        const anyFile = f as File & { path?: string };
        paths.push(anyFile.path ?? f.name);
      }
      if (paths.length) {
        setAttachments((prev) => [...prev, ...paths]);
      }
    },
    [],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
      style={{
        padding: 10,
        borderTop: "1px solid #2a2a36",
        background: dropActive ? "#1a1a25" : "transparent",
      }}
    >
      {attachments.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 6,
          }}
        >
          {attachments.map((p, i) => (
            <span
              key={`${p}-${i}`}
              style={{
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 4,
                background: "#1c1c26",
                color: "#cdcdd8",
              }}
            >
              @{p}
            </span>
          ))}
        </div>
      ) : null}
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={
          disabled ? "Waiting for agent…" : "Message your agent (Enter to send)"
        }
        rows={3}
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "#13131a",
          border: "1px solid #2a2a36",
          borderRadius: 8,
          color: "#e4e4ee",
          fontFamily: "system-ui, -apple-system, Helvetica Neue, sans-serif",
          fontSize: 14,
          padding: 8,
          resize: "vertical",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 6,
        }}
      >
        {running ? (
          <button
            onClick={onStop}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid #ef4444",
              background: "transparent",
              color: "#ef4444",
              cursor: "pointer",
            }}
          >
            Stop
          </button>
        ) : null}
        <button
          onClick={submit}
          disabled={disabled || !text.trim()}
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            border: "none",
            background: disabled || !text.trim() ? "#3a3a48" : "#7c5cff",
            color: "#fff",
            cursor: disabled || !text.trim() ? "not-allowed" : "pointer",
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add editor/agent-chat/Composer.tsx
git commit -m "feat(agent-chat): Composer with file drag-in and Enter-to-send"
```

---

### Task 12: SessionToolbar component

**Files:**
- Create: `editor/agent-chat/SessionToolbar.tsx`

- [ ] **Step 1: Write the component**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/SessionToolbar.tsx`:

```tsx
import React from "react";

interface Props {
  agentLabel: string;
  cwd: string;
  onSwitchToTerminal: () => void;
  onEndSession: () => void;
  sessionAlive: boolean;
}

export const SessionToolbar: React.FC<Props> = ({
  agentLabel,
  cwd,
  onSwitchToTerminal,
  onEndSession,
  sessionAlive,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "6px 10px",
      borderBottom: "1px solid #2a2a36",
      fontFamily: "system-ui, -apple-system, Helvetica Neue, sans-serif",
      fontSize: 12,
      color: "#a4a4b4",
      background: "#0e0e16",
    }}
  >
    <span style={{ fontWeight: 600, color: "#e4e4ee" }}>{agentLabel}</span>
    <span
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        opacity: 0.7,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flex: 1,
        minWidth: 0,
      }}
      title={cwd}
    >
      {cwd}
    </span>
    {sessionAlive ? (
      <button
        onClick={onEndSession}
        style={{
          padding: "3px 8px",
          borderRadius: 4,
          border: "1px solid #3a3a48",
          background: "transparent",
          color: "#cdcdd8",
          cursor: "pointer",
        }}
      >
        End
      </button>
    ) : null}
    <button
      onClick={onSwitchToTerminal}
      style={{
        padding: "3px 8px",
        borderRadius: 4,
        border: "1px solid #3a3a48",
        background: "transparent",
        color: "#cdcdd8",
        cursor: "pointer",
      }}
    >
      Terminal
    </button>
  </div>
);
```

- [ ] **Step 2: Commit**

```bash
git add editor/agent-chat/SessionToolbar.tsx
git commit -m "feat(agent-chat): SessionToolbar with switch-to-terminal action"
```

---

## Wave 4 — Rust backend (process spawn + stdio pump)

### Task 13: `agent_chat.rs` — spawn + read loop

**Files:**
- Create: `src-tauri/src/agent_chat.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create `agent_chat.rs`**

Create `/Users/parandykt/Apps/KineticType/src-tauri/src/agent_chat.rs`:

```rust
//! Agent-chat session manager.
//!
//! Unlike pty.rs, this module does NOT spawn an interactive login shell.
//! It runs the chosen agent binary directly with structured-output flags
//! (e.g. `claude --output-format stream-json --verbose`) and pipes
//! stdin/stdout. The renderer (per-agent TS adapter) does all parsing.
//!
//! Event channel: `agent-chat://{id}/data` carries raw stdout bytes
//! coalesced with the same strategy as pty.rs. `agent-chat://{id}/closed`
//! fires once when the process exits.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;

use dashmap::DashMap;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::AppState;

pub struct AgentChatSession {
    pub child: Mutex<Child>,
    pub stdin: Mutex<Option<ChildStdin>>,
}

#[derive(Deserialize)]
pub struct SpawnArgs {
    pub cmd: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub cwd: String,
}

#[tauri::command]
pub fn agent_chat_open(
    spawn: SpawnArgs,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    let mut cmd = Command::new(&spawn.cmd);
    cmd.args(&spawn.args);
    cmd.current_dir(&spawn.cwd);

    // Inherit env so the agent finds its auth (e.g. ~/.claude).
    for (k, v) in std::env::vars() {
        cmd.env(k, v);
    }
    for (k, v) in &spawn.env {
        cmd.env(k, v);
    }

    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn {}: {}", spawn.cmd, e))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "no stdin handle".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "no stdout handle".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "no stderr handle".to_string())?;

    let id = Uuid::new_v4().to_string();

    let (tx, rx) = mpsc::channel::<Vec<u8>>();

    // stdout reader
    {
        let tx = tx.clone();
        let mut stdout = stdout;
        thread::spawn(move || {
            let mut buf = [0u8; 16384];
            loop {
                match stdout.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    // stderr reader — multiplex into the same channel, prefixed.
    // (Renderer-side adapter sees stderr as junk lines and emits
    // recoverable error events. Keeping it visible aids debugging.)
    {
        let tx = tx.clone();
        let mut stderr = stderr;
        thread::spawn(move || {
            let mut buf = [0u8; 16384];
            loop {
                match stderr.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    // Flusher
    let app_for_thread = app.clone();
    let id_for_thread = id.clone();
    thread::spawn(move || {
        const FLUSH_WINDOW: Duration = Duration::from_micros(800);
        const FLUSH_BYTES: usize = 64 * 1024;
        let event_name = format!("agent-chat://{}/data", id_for_thread);
        let closed_name = format!("agent-chat://{}/closed", id_for_thread);
        let mut pending: Vec<u8> = Vec::with_capacity(FLUSH_BYTES);

        loop {
            let first = match rx.recv() {
                Ok(v) => v,
                Err(_) => break,
            };
            pending.clear();
            pending.extend_from_slice(&first);

            while pending.len() < FLUSH_BYTES {
                match rx.recv_timeout(FLUSH_WINDOW) {
                    Ok(v) => pending.extend_from_slice(&v),
                    Err(_) => break,
                }
            }

            // Emit as UTF-8; non-UTF-8 bytes are replaced with U+FFFD.
            let payload = String::from_utf8_lossy(&pending).to_string();
            let _ = app_for_thread.emit(&event_name, payload);
        }
        let _ = app_for_thread.emit(&closed_name, ());
    });

    let session = AgentChatSession {
        child: Mutex::new(child),
        stdin: Mutex::new(Some(stdin)),
    };
    state.agent_chats.insert(id.clone(), session);
    Ok(id)
}

#[tauri::command]
pub fn agent_chat_write(
    id: String,
    data: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = state
        .agent_chats
        .get(&id)
        .ok_or_else(|| "session not found".to_string())?;
    let mut guard = session.stdin.lock().map_err(|e| e.to_string())?;
    let stdin = guard
        .as_mut()
        .ok_or_else(|| "stdin already closed".to_string())?;
    stdin.write_all(&data).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_chat_close(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some((_, session)) = state.agent_chats.remove(&id) {
        if let Ok(mut g) = session.stdin.lock() {
            g.take(); // dropping ChildStdin closes the pipe
        }
        if let Ok(mut child) = session.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    Ok(())
}
```

- [ ] **Step 2: Wire into `lib.rs`**

Edit `/Users/parandykt/Apps/KineticType/src-tauri/src/lib.rs`. Add `mod agent_chat;` after `mod agents;`. Then change `AppState` to include the new map:

Replace:

```rust
pub struct AppState {
    pub active_project: Mutex<Option<projects::ActiveProject>>,
    pub ptys: DashMap<String, pty::PtySession>,
}
```

with:

```rust
pub struct AppState {
    pub active_project: Mutex<Option<projects::ActiveProject>>,
    pub ptys: DashMap<String, pty::PtySession>,
    pub agent_chats: DashMap<String, agent_chat::AgentChatSession>,
}
```

Replace:

```rust
    let state = AppState {
        active_project: Mutex::new(None),
        ptys: DashMap::new(),
    };
```

with:

```rust
    let state = AppState {
        active_project: Mutex::new(None),
        ptys: DashMap::new(),
        agent_chats: DashMap::new(),
    };
```

In the `invoke_handler` list, add these three lines just after `pty::pty_paste_prompt,`:

```rust
            agent_chat::agent_chat_open,
            agent_chat::agent_chat_write,
            agent_chat::agent_chat_close,
```

- [ ] **Step 3: Build the Rust side**

Run: `npm run tauri:build -- --debug --bundles none` (or simply `cargo check --manifest-path src-tauri/Cargo.toml`).
Expected: clean build, no warnings worse than existing ones.

If `cargo check` fails because `uuid` isn't a workspace dep, add it: `cargo add --manifest-path src-tauri/Cargo.toml uuid --features v4` — but it's already used by `pty.rs`, so it should be available.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/agent_chat.rs src-tauri/src/lib.rs
git commit -m "feat(agent-chat): rust process spawn + stdio pump + tauri commands"
```

---

## Wave 5 — Wiring it all together

### Task 14: `Chat.tsx` — top-level surface

**Files:**
- Create: `editor/agent-chat/Chat.tsx`

- [ ] **Step 1: Write the component**

Create `/Users/parandykt/Apps/KineticType/editor/agent-chat/Chat.tsx`:

```tsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentAdapter } from "./adapters/types";
import { getAdapter } from "./adapters/registry";
import { createChatStore } from "./ChatStore";
import { Message } from "./Message";
import { UserMessage } from "./UserMessage";
import { ToolCard } from "./ToolCard";
import { PermissionDialog } from "./PermissionDialog";
import { Composer } from "./Composer";
import { SessionToolbar } from "./SessionToolbar";

interface Props {
  agentId: string;
  agentLabel: string;
  cwd: string;
  skipPermissions: boolean;
  onSwitchToTerminal: () => void;
}

export const Chat: React.FC<Props> = ({
  agentId,
  agentLabel,
  cwd,
  skipPermissions,
  onSwitchToTerminal,
}) => {
  const adapter: AgentAdapter | null = useMemo(() => getAdapter(agentId), [agentId]);
  const storeRef = useRef(createChatStore());
  const store = storeRef.current;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [userBubbles, setUserBubbles] = useState<{ id: number; text: string }[]>(
    [],
  );
  const [running, setRunning] = useState(false);

  const state = useSyncExternalStore(
    store.subscribe,
    () => store.getState(),
    () => store.getState(),
  );

  // Mount: spawn agent.
  useEffect(() => {
    if (!adapter) return;
    const spawn = adapter.spawnArgs({ cwd, skipPermissions });
    if (!spawn) return;

    let unlistenData: UnlistenFn | null = null;
    let unlistenClosed: UnlistenFn | null = null;
    let aborted = false;

    void (async () => {
      try {
        const id = await invoke<string>("agent_chat_open", {
          spawn: { ...spawn, cwd },
        });
        if (aborted) {
          void invoke("agent_chat_close", { id });
          return;
        }
        setSessionId(id);

        unlistenData = await listen<string>(
          `agent-chat://${id}/data`,
          (e) => {
            const bytes = new TextEncoder().encode(e.payload);
            adapter.parseChunk(bytes, (ev) => store.applyEvent(ev));
          },
        );
        unlistenClosed = await listen<null>(`agent-chat://${id}/closed`, () => {
          store.applyEvent({
            kind: "error",
            message: "agent process exited",
            recoverable: false,
          });
        });
      } catch (e) {
        store.applyEvent({
          kind: "error",
          message: `agent_chat_open failed: ${(e as Error).message ?? e}`,
          recoverable: false,
        });
      }
    })();

    return () => {
      aborted = true;
      unlistenData?.();
      unlistenClosed?.();
      if (sessionId) void invoke("agent_chat_close", { id: sessionId });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, cwd, skipPermissions]);

  // Track running state based on turn status.
  useEffect(() => {
    const last = state.turns[state.turns.length - 1];
    setRunning(!!last && last.status === "streaming");
  }, [state.turns]);

  const send = useCallback(
    (text: string, attachments: string[]) => {
      if (!adapter || !sessionId) return;
      const bytes = adapter.encodeUserInput(text, attachments);
      setUserBubbles((b) => [...b, { id: Date.now(), text }]);
      void invoke("agent_chat_write", { id: sessionId, data: Array.from(bytes) });
    },
    [adapter, sessionId],
  );

  const stop = useCallback(() => {
    if (!sessionId) return;
    // Send Ctrl-C (0x03). Adapter-agnostic best effort.
    void invoke("agent_chat_write", { id: sessionId, data: [0x03] });
  }, [sessionId]);

  const decide = useCallback(
    (promptId: string, decision: "allow" | "allow-always" | "deny") => {
      if (!adapter || !sessionId) return;
      const bytes = adapter.encodePermissionDecision(promptId, decision);
      if (bytes) {
        void invoke("agent_chat_write", {
          id: sessionId,
          data: Array.from(bytes),
        });
      }
      store.applyEvent({ kind: "permission-decided", promptId, decision });
    },
    [adapter, sessionId, store],
  );

  const endSession = useCallback(() => {
    if (!sessionId) return;
    void invoke("agent_chat_close", { id: sessionId });
    setSessionId(null);
  }, [sessionId]);

  if (!adapter || !adapter.spawnArgs({ cwd, skipPermissions })) {
    return (
      <div
        style={{
          padding: 16,
          fontFamily: "system-ui, -apple-system, Helvetica Neue, sans-serif",
          color: "#cdcdd8",
        }}
      >
        Chat view is not yet supported for {agentLabel}. Use Terminal view.
        <div style={{ marginTop: 12 }}>
          <button
            onClick={onSwitchToTerminal}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid #3a3a48",
              background: "transparent",
              color: "#e4e4ee",
              cursor: "pointer",
            }}
          >
            Switch to Terminal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#0a0a10",
      }}
    >
      <SessionToolbar
        agentLabel={agentLabel}
        cwd={cwd}
        sessionAlive={state.sessionAlive}
        onSwitchToTerminal={onSwitchToTerminal}
        onEndSession={endSession}
      />
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "10px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {state.turns.map((t, idx) => {
          const userBubble = userBubbles[idx];
          return (
            <React.Fragment key={t.turnId}>
              {userBubble ? <UserMessage text={userBubble.text} /> : null}
              {t.toolCalls.map((c) => (
                <ToolCard key={c.callId} call={c} />
              ))}
              {t.assistantText ? (
                <Message
                  text={t.assistantText}
                  streaming={t.status === "streaming"}
                />
              ) : null}
              {t.errorMessage ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "#ef4444",
                    fontFamily:
                      "system-ui, -apple-system, Helvetica Neue, sans-serif",
                  }}
                >
                  {t.errorMessage}
                </div>
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
      {state.pendingPermission ? (
        <PermissionDialog
          pending={state.pendingPermission}
          onDecide={decide}
        />
      ) : null}
      <Composer
        disabled={!sessionId || running}
        onSubmit={send}
        onStop={stop}
        running={running}
      />
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add editor/agent-chat/Chat.tsx
git commit -m "feat(agent-chat): Chat surface — top-level wiring and event loop"
```

---

### Task 15: Persist view-mode per project

**Files:**
- Modify: `src-tauri/src/window_state.rs`
- Modify: `src-tauri/src/lib.rs`

The window-state file at `~/.kinetic-studio/window.json` is global, but the view mode is per-project. Easiest path: add a separate `view_mode.json` map keyed by project path, with two new Tauri commands `get_view_mode(path)` and `set_view_mode(path, mode)`.

- [ ] **Step 1: Add the storage helpers**

Edit `/Users/parandykt/Apps/KineticType/src-tauri/src/window_state.rs`. Append at the end of the file (after the existing exports):

```rust
// View-mode persistence per project — separate file so window-state code
// stays trivial and we can evolve schemas independently.

use std::collections::HashMap;

fn view_mode_path() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".kinetic-studio").join("view-mode.json"))
        .unwrap_or_else(|| PathBuf::from(".kinetic-studio/view-mode.json"))
}

fn read_view_modes() -> HashMap<String, String> {
    fs::read_to_string(view_mode_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_view_modes(map: &HashMap<String, String>) -> Result<(), String> {
    if let Some(parent) = view_mode_path().parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    fs::write(view_mode_path(), json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_view_mode(project_path: String) -> String {
    read_view_modes()
        .get(&project_path)
        .cloned()
        .unwrap_or_else(|| "terminal".to_string())
}

#[tauri::command]
pub fn set_view_mode(project_path: String, mode: String) -> Result<(), String> {
    let mut map = read_view_modes();
    map.insert(project_path, mode);
    write_view_modes(&map)
}
```

- [ ] **Step 2: Register the commands in `lib.rs`**

Edit `/Users/parandykt/Apps/KineticType/src-tauri/src/lib.rs`. In the `invoke_handler` list, add after `window_state::save_window_state,`:

```rust
            window_state::get_view_mode,
            window_state::set_view_mode,
```

- [ ] **Step 3: Build to verify**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/window_state.rs src-tauri/src/lib.rs
git commit -m "feat(view-mode): per-project view-mode persistence in ~/.kinetic-studio"
```

---

### Task 16: Mount Chat in `KineticApp.tsx`

**Files:**
- Modify: `editor/canvases/kinetic/KineticApp.tsx:601-616`

- [ ] **Step 1: Read context around the existing Terminal mount**

The Terminal mount is at `editor/canvases/kinetic/KineticApp.tsx:609`. The surrounding `div` (lines 601-616) decides whether to show Terminal vs SecondaryTab. We'll add a sibling toggle and conditionally render `Chat` instead of `Terminal`.

- [ ] **Step 2: Apply the edit**

Edit `/Users/parandykt/Apps/KineticType/editor/canvases/kinetic/KineticApp.tsx`.

Add this import near the existing `Terminal` import (line 30):

```ts
import { Chat } from "../../agent-chat/Chat";
```

Just below the existing imports, add a hook to read/write the view mode. Find the component function (search for `KineticApp` declaration) and add near the top of its body, alongside other `useState`/`useEffect` hooks:

```ts
const [viewMode, setViewMode] = React.useState<"terminal" | "chat">("terminal");
const projectPath = (window as unknown as { __KINETIC_PROJECT?: string })
  .__KINETIC_PROJECT ?? "";

React.useEffect(() => {
  if (!projectPath) return;
  void (async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const m = await invoke<string>("get_view_mode", { projectPath });
      if (m === "chat") setViewMode("chat");
    } catch {
      /* ignore — default to terminal */
    }
  })();
}, [projectPath]);

const persistViewMode = React.useCallback(
  (m: "terminal" | "chat") => {
    setViewMode(m);
    if (!projectPath) return;
    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        await invoke("set_view_mode", { projectPath, mode: m });
      } catch {
        /* ignore */
      }
    })();
  },
  [projectPath],
);
```

If `KineticApp` already has a more idiomatic way to access the project path (e.g. through a prop or a context), use that instead of the global. The shape doesn't matter as long as `projectPath` is the absolute path of the open project.

Then replace the block at lines 601-616:

```tsx
            <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: leftTab === "terminal" || !SecondaryTab ? "block" : "none",
                }}
              >
                <Terminal />
              </div>
              {SecondaryTab && leftTab === "secondary" && (
                <div style={{ position: "absolute", inset: 0 }}>
                  <SecondaryTab.Component />
                </div>
              )}
            </div>
```

with:

```tsx
            <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  top: 4,
                  right: 8,
                  zIndex: 10,
                  display: "flex",
                  gap: 4,
                }}
              >
                <button
                  onClick={() => persistViewMode("terminal")}
                  style={{
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontSize: 11,
                    border: "1px solid #2a2a36",
                    background:
                      viewMode === "terminal" ? "#2a2a36" : "transparent",
                    color: "#e4e4ee",
                    cursor: "pointer",
                  }}
                >
                  Terminal
                </button>
                <button
                  onClick={() => persistViewMode("chat")}
                  style={{
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontSize: 11,
                    border: "1px solid #2a2a36",
                    background:
                      viewMode === "chat" ? "#2a2a36" : "transparent",
                    color: "#e4e4ee",
                    cursor: "pointer",
                  }}
                >
                  Chat
                </button>
              </div>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display:
                    (leftTab === "terminal" || !SecondaryTab) &&
                    viewMode === "terminal"
                      ? "block"
                      : "none",
                }}
              >
                <Terminal />
              </div>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display:
                    (leftTab === "terminal" || !SecondaryTab) &&
                    viewMode === "chat"
                      ? "block"
                      : "none",
                }}
              >
                <Chat
                  agentId="claude"
                  agentLabel="Claude Code"
                  cwd={projectPath}
                  skipPermissions={false}
                  onSwitchToTerminal={() => persistViewMode("terminal")}
                />
              </div>
              {SecondaryTab && leftTab === "secondary" && (
                <div style={{ position: "absolute", inset: 0 }}>
                  <SecondaryTab.Component />
                </div>
              )}
            </div>
```

**Note on agent selection:** v1 hardcodes `agentId="claude"`. A future task can read `settings::default_agent` from Tauri to drive this dynamically — out of scope here.

- [ ] **Step 3: Commit**

```bash
git add editor/canvases/kinetic/KineticApp.tsx
git commit -m "feat(agent-chat): mount Chat alongside Terminal behind a toggle"
```

---

## Wave 6 — Validation

### Task 17: Run the full test suite + lint

**Files:** none modified.

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: all tests pass. Six adapter fixture tests + ChatStore + PermissionDialog + events.

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors. If errors are pre-existing in unrelated files, scope is "no new errors introduced by agent-chat/."

- [ ] **Step 3: Run Rust build**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean build, no new warnings.

- [ ] **Step 4: Commit (only if you made any fix-up changes)**

```bash
git status
# If clean, skip the commit. Otherwise:
git add -A
git commit -m "chore(agent-chat): final fixups from validation pass"
```

---

### Task 18: Manual integration test

**Files:** none. This is a checklist for human verification.

Run `npm run tauri:dev` and verify each acceptance criterion from the spec:

- [ ] **Step 1: Default behavior unchanged**

  Open an existing project. Confirm Terminal view is the default and works identically to before.

- [ ] **Step 2: Toggle to Chat view**

  Click the "Chat" pill in the top-right of the terminal pane. Verify the surface swaps to the chat UI with the `SessionToolbar` showing "Claude Code" + the project path.

- [ ] **Step 3: Send a prose message**

  Type "what files are in this project?" and press Enter. Verify:
  - The user message appears in a right-aligned bubble.
  - An assistant `Message` bubble streams in with the response.
  - If the agent calls `Read` or similar, a `ToolCard` appears with the file path summary.

- [ ] **Step 4: Permission flow**

  Ask the agent to edit a file. When a `PermissionDialog` appears, verify:
  - The tool name and file path are shown.
  - "Allow once" sends the agent forward.
  - "Deny" prevents the edit.
  - Escape closes the dialog as Deny.

- [ ] **Step 5: File drag-in**

  Drag a file from Finder/Explorer into the composer. Verify an `@/absolute/path` chip appears above the textarea, and submitting sends the message with the `@path` prefixed.

- [ ] **Step 6: Switch back to Terminal**

  Click "Terminal" in the toolbar OR the top-right pill. Verify:
  - The chat session ends (process exits in the activity monitor).
  - Terminal view re-mounts cleanly.
  - The agent there starts fresh from the user's `$SHELL`.

- [ ] **Step 7: View mode persists**

  Quit the app while in Chat view. Re-open the same project. Verify Chat view is restored.

- [ ] **Step 8: Unsupported agent shows graceful message**

  Manually set the default agent to Codex in settings (or hack the `agentId` prop to `"codex"`). Verify the "Chat view is not yet supported for Codex" card appears instead of a broken surface.

If any step fails, file a follow-up task. v1 is complete when all eight steps pass.

---

## Self-review notes

- **Spec coverage:** All acceptance criteria from the spec map to tasks 16 (toggle + persistence), 14 + 4-7 (Chat surface + Claude adapter), 16 (Terminal unchanged), seam policy (enforced by file layout — task structure puts everything in `editor/agent-chat/`), and tasks 4-7 (six fixture tests).
- **Placeholder scan:** No "TBD," "TODO," or "implement later." Tool-summary helpers, permission dialog wording, and styling tokens are all concrete.
- **Type consistency:** `ChatEvent` defined once in Task 2; all later tasks import the same union. `AgentAdapter` defined in Task 3, consumed unchanged in Tasks 4–7 and 14. `PendingPermission` and `ToolCallRecord` are exported from `ChatStore` and consumed by components.
- **Known leftover:** The fixture format for Claude `permission_request` events is the adapter's expected contract, not Claude's documented event shape — the spec calls this out as risk #1. If Claude's real format differs at integration time, only the `handleLine` parsing branch changes; the emitted `ChatEvent`s and the UI consuming them stay identical.
