#!/usr/bin/env node
// Outreach board MCP server (stdio). Exposes one tool per board verb. Each
// tool call shells out to the `board-cli` Rust binary (see board-cli.ts) —
// the gates (rule-block, blast-radius/needs-confirm, optimistic-concurrency,
// retired-id) live ONCE in Rust (`board.rs`); this server never touches
// SQLite directly and never reimplements gate logic.
//
// `board-cli` is located via `BOARD_CLI` env var if set, else `"board-cli"`
// on PATH (Task 5.2 wires an absolute path via the installer).

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { callBoardCli } from "./board-cli.js";

const server = new McpServer({ name: "outreach-mcp", version: "0.1.0" });

/** Maps a `callBoardCli` result to an MCP tool result. On `ok:false` (a gate
 * outcome — rule-blocked / needs-confirm / conflict / etc.), the error
 * string is returned as content with `isError: true` so the agent can react.
 * On `ok:true`, `data` is JSON-stringified into a text content block. Shared
 * by every tool handler below so the mapping lives in one place. */
async function toToolResult(verb: string, args: unknown): Promise<CallToolResult> {
  const result = await callBoardCli(verb, args);
  if (result.ok) {
    return { content: [{ type: "text", text: JSON.stringify(result.data) }] };
  }
  return { content: [{ type: "text", text: result.error }], isError: true };
}

server.registerTool(
  "listStages",
  { description: "List all board stages, ordered by position.", inputSchema: {} },
  async (args) => toToolResult("listStages", args),
);

server.registerTool(
  "listLeads",
  { description: "List all leads on the board.", inputSchema: {} },
  async (args) => toToolResult("listLeads", args),
);

server.registerTool(
  "getLead",
  {
    description: "Get one lead's full detail (context, messages, transcripts).",
    inputSchema: { id: z.string() },
  },
  async (args) => toToolResult("getLead", args),
);

server.registerTool(
  "listRules",
  { description: "List all board rules.", inputSchema: {} },
  async (args) => toToolResult("listRules", args),
);

server.registerTool(
  "getConfig",
  { description: "Get the board's config (name, owner, version).", inputSchema: {} },
  async (args) => toToolResult("getConfig", args),
);

server.registerTool(
  "listActors",
  {
    description:
      "List everyone who has opened this board (the users you can @-mention in a note). Returns [{ id, label }].",
    inputSchema: {},
  },
  async (args) => toToolResult("listActors", args),
);

server.registerTool(
  "notifications",
  {
    description:
      "List the current user's notifications (newest first) plus the unread count. Notifications are @-mentions, stage changes, notes on mentioned leads, and new leads. Each item has { seq, kind, leadId, actor, body, createdAt, read }.",
    inputSchema: {},
  },
  async (args) => toToolResult("notifications", args),
);

server.registerTool(
  "addLead",
  {
    description: "Add a new lead to a stage.",
    inputSchema: { name: z.string(), org: z.string().optional(), stage: z.string() },
  },
  async (args) => toToolResult("addLead", args),
);

server.registerTool(
  "moveLead",
  {
    description: "Move a lead to a different stage (optimistic concurrency).",
    inputSchema: { id: z.string(), toStage: z.string(), expectedVersion: z.number().int() },
  },
  async (args) => toToolResult("moveLead", args),
);

server.registerTool(
  "archiveLead",
  {
    description:
      "Archive a lead — it leaves the default board view but keeps all its history and can be restored. Reversible.",
    inputSchema: { id: z.string() },
  },
  async (args) => toToolResult("archiveLead", args),
);

server.registerTool(
  "unarchiveLead",
  {
    description: "Restore a previously archived lead back to the board.",
    inputSchema: { id: z.string() },
  },
  async (args) => toToolResult("unarchiveLead", args),
);

server.registerTool(
  "deleteLead",
  {
    description:
      "Permanently delete a lead's card from the board. The full row is saved in the event log, so `revert` can still recreate it — but treat this as destructive and confirm with the human first.",
    inputSchema: { id: z.string() },
  },
  async (args) => toToolResult("deleteLead", args),
);

server.registerTool(
  "appendContext",
  {
    description: "Append a research fact to a lead's context (merge, never clobber).",
    inputSchema: { id: z.string(), research: z.unknown(), expectedVersion: z.number().int() },
  },
  async (args) => toToolResult("appendContext", args),
);

server.registerTool(
  "draftMessage",
  {
    description: "Draft (not send) a message onto a lead.",
    inputSchema: { id: z.string(), msg: z.unknown() },
  },
  async (args) => toToolResult("draftMessage", args),
);

server.registerTool(
  "attachTranscript",
  {
    description: "Attach a call/meeting transcript to a lead.",
    inputSchema: { id: z.string(), raw: z.string(), summary: z.string() },
  },
  async (args) => toToolResult("attachTranscript", args),
);

server.registerTool(
  "renameStage",
  {
    description: "Rename a stage's label.",
    inputSchema: { id: z.string(), label: z.string() },
  },
  async (args) => toToolResult("renameStage", args),
);

server.registerTool(
  "reorderStages",
  {
    description: "Set stage order.",
    inputSchema: { ids: z.array(z.string()) },
  },
  async (args) => toToolResult("reorderStages", args),
);

server.registerTool(
  "addStage",
  {
    description: "Add a new stage at a position.",
    inputSchema: { label: z.string(), position: z.number().int() },
  },
  async (args) => toToolResult("addStage", args),
);

server.registerTool(
  "retireStage",
  {
    description: "Retire a stage (blocked by rules or >5 cards — see remapStage).",
    inputSchema: { id: z.string() },
  },
  async (args) => toToolResult("retireStage", args),
);

server.registerTool(
  "unretireStage",
  {
    description: "Un-retire a previously retired stage.",
    inputSchema: { id: z.string() },
  },
  async (args) => toToolResult("unretireStage", args),
);

server.registerTool(
  "remapStage",
  {
    description: "Move all (or a filtered subset of) leads from one stage to another.",
    inputSchema: {
      from: z.string(),
      to: z.string(),
      orgFilter: z.string().optional(),
      dryRun: z.boolean(),
      retireSource: z.boolean(),
      confirmed: z.boolean(),
    },
  },
  async (args) => toToolResult("remapStage", args),
);

server.registerTool(
  "revert",
  {
    description:
      "Undo every board change made after event `seq` (newest first), restoring each to its prior state. The event log is append-only and fully reversible — this is the board's undo. Get `seq` values from the changes you made (each write returns a `seq`). Destructive to intervening changes; confirm with the human first.",
    inputSchema: { seq: z.number().int() },
  },
  async (args) => toToolResult("revert", args),
);

server.registerTool(
  "markNotificationsRead",
  {
    description:
      "Mark all of the current user's notifications as read (clears the unread count / the bell's red dot).",
    inputSchema: {},
  },
  async (args) => toToolResult("markNotificationsRead", args),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("outreach-mcp fatal error:", err);
  process.exit(1);
});
