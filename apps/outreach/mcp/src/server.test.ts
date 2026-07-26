// Unit-tests `callBoardCli`'s argument-marshalling and ok/error mapping by
// pointing BOARD_CLI at a tiny fake stub script — no real board.db or Rust
// binary required. Run against the compiled output (`npm run build` first;
// `npm test` runs both).
//
// Imports the COMPILED module (`../dist/board-cli.js`) rather than the `.ts`
// source: `node --test` resolves relative `.js` specifiers against the file
// on disk, and our source uses NodeNext-style `.js` imports for the
// TS-compiles-to-JS output, not the `.ts` file itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { callBoardCli } from "../dist/board-cli.js";

/**
 * The complete set of verbs the Rust `board-cli` dispatch handles — the FULL
 * board capability surface (reads, lead ops, stage ops, notifications, revert).
 * The MCP server must register exactly this set so an embedded agent can do
 * everything a human can. Keep this list in sync with `board_cli.rs`'s `match`.
 */
const BOARD_CLI_VERBS = [
  "listStages",
  "listLeads",
  "getLead",
  "listRules",
  "getConfig",
  "listActors",
  "notifications",
  "markNotificationsRead",
  "revert",
  "addLead",
  "moveLead",
  "archiveLead",
  "unarchiveLead",
  "deleteLead",
  "appendContext",
  "draftMessage",
  "attachTranscript",
  "renameStage",
  "reorderStages",
  "addStage",
  "retireStage",
  "unretireStage",
  "remapStage",
].sort();

test("MCP registers a tool for every board-cli verb (full parity)", () => {
  // Parse the registered tool names out of the server source (registerTool("X").
  // The compiled test runs from dist/, so reach back to the src/ TypeScript.
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "..", "src", "server.ts"), "utf8");
  const registered = [...src.matchAll(/registerTool\(\s*"([A-Za-z]+)"/g)]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(
    registered,
    BOARD_CLI_VERBS,
    "MCP tools must exactly match board-cli verbs — an agent should be able to do everything a human can",
  );
});

/** Writes an executable stub script (shebang `#!/usr/bin/env node`) that
 * echoes back a fixed JSON response regardless of the stdin request, and
 * points BOARD_CLI at its path for the duration of `fn`. `callBoardCli`
 * spawns BOARD_CLI directly (no shell, no args), so the stub must be
 * independently executable. */
async function withStubBoardCli<T>(response: string, fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "outreach-mcp-test-"));
  const stubPath = join(dir, "board-cli-stub.mjs");
  writeFileSync(
    stubPath,
    `#!/usr/bin/env node\nprocess.stdin.resume();\nprocess.stdin.on("end", () => { process.stdout.write(${JSON.stringify(response)}); });\n`,
  );
  chmodSync(stubPath, 0o755);

  const prevBoardCli = process.env.BOARD_CLI;
  process.env.BOARD_CLI = stubPath;
  try {
    return await fn();
  } finally {
    if (prevBoardCli === undefined) delete process.env.BOARD_CLI;
    else process.env.BOARD_CLI = prevBoardCli;
  }
}

test("callBoardCli returns data on ok:true", async () => {
  await withStubBoardCli(JSON.stringify({ ok: true, data: { id: "abc123" } }), async () => {
    const result = await callBoardCli("addLead", { name: "Ana", stage: "researching" });
    assert.equal(result.ok, true);
    assert.deepEqual((result as { ok: true; data: unknown }).data, { id: "abc123" });
  });
});

test("callBoardCli surfaces the error string on ok:false", async () => {
  await withStubBoardCli(
    JSON.stringify({ ok: false, error: "needs-confirm: this affects 6 cards — re-run with confirm=true" }),
    async () => {
      const result = await callBoardCli("remapStage", {
        from: "contacted",
        to: "warm",
        dryRun: false,
        retireSource: false,
        confirmed: false,
      });
      assert.equal(result.ok, false);
      assert.equal(
        (result as { ok: false; error: string }).error,
        "needs-confirm: this affects 6 cards — re-run with confirm=true",
      );
    },
  );
});

test("callBoardCli reports a config error when the binary produces invalid JSON", async () => {
  await withStubBoardCli("not json", async () => {
    const result = await callBoardCli("listStages", {});
    assert.equal(result.ok, false);
    assert.match((result as { ok: false; error: string }).error, /invalid JSON/);
  });
});
