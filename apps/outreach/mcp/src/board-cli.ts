// Spawns the `board-cli` Rust binary per call, writes a `{verb, args}` JSON
// request to its stdin, and parses the `{ok, data|error}` JSON response from
// stdout. This is the ONLY place the MCP server talks to `board-cli` — all
// gate logic (rule-block, blast-radius/needs-confirm, optimistic-concurrency,
// retired-id) lives in Rust (`board.rs`); this module is a thin pass-through.
//
// The binary is located via the `BOARD_CLI` env var if set, else falls back
// to `"board-cli"` on PATH (Task 5.2 wires an absolute path via the
// installer).

import { spawn } from "node:child_process";

export type BoardCliResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export function callBoardCli(verb: string, args: unknown): Promise<BoardCliResult> {
  const bin = process.env.BOARD_CLI || "board-cli";

  return new Promise((resolve) => {
    // env: process.env inherits the MCP server's full process env, including
    // DATABASE_URL/OUTREACH_ACTOR when the installer wrote them into
    // .mcp.json (see skill.rs write_mcp_config) — this is how board-cli ends
    // up targeting the same shared board + actor as the desktop UI.
    const child = spawn(bin, [], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("error", (err) => {
      resolve({ ok: false, error: `config: failed to spawn board-cli (${bin}): ${err.message}` });
    });

    child.on("close", () => {
      if (!stdout.trim()) {
        resolve({ ok: false, error: `config: board-cli produced no output${stderr ? `: ${stderr.trim()}` : ""}` });
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as BoardCliResult;
        resolve(parsed);
      } catch (e) {
        resolve({ ok: false, error: `config: board-cli returned invalid JSON: ${(e as Error).message}` });
      }
    });

    child.stdin.write(JSON.stringify({ verb, args }));
    child.stdin.end();
  });
}
