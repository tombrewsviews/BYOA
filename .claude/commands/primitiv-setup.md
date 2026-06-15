---
name: primitiv-setup
description: One-time install for Primitiv in this project. Run when the user asks to install Primitiv or when an MCP tool returns a noContract error.
allowed-tools: Bash(npx @ai-by-design/primitiv init *) Bash(npx @ai-by-design/primitiv build *)
---

# Primitiv Setup

Mode: SETUP. One-time install for Primitiv in this project. Idempotent — safe to re-run.

## What runs

`primitiv init` writes or refreshes:
- **Project config + contract** — `primitiv.config.js`, `primitiv.contract.json`
- **Claude Code wiring** — `/build-component` skill at `.claude/commands/build-component.md`
- **Agent instructions** — Primitiv block in `AGENTS.md` or `CLAUDE.md`

Also adds an entry to `.mcp.json` or `.cursor/mcp.json`. Takes ~30 seconds.

## Steps

1. Confirm with the user what will be created (use the 3 groups above) and ask for consent before proceeding.
2. Run `npx @ai-by-design/primitiv init` in the project root.
3. Run `npx @ai-by-design/primitiv build`.
4. Confirm setup is complete. Agents can now use Primitiv tools (`get_design_context`, `get_token`, `get_component`, `get_conflicts`, `get_inferred_rules`, `get_violations`).

## Uninstall

Delete `primitiv.config.js`, `primitiv.contract.json`, `.claude/commands/build-component.md`, `.claude/commands/primitiv-setup.md`, and remove the `<!-- primitiv -->` block from `AGENTS.md`/`CLAUDE.md`. Remove the `primitiv` entry from your MCP config.
