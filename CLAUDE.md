# KineticType

## Gotchas

### Moving the project directory breaks the Rust build cache

`src-tauri/target/` caches absolute paths. If the project is moved or renamed, `npm run tauri:dev` fails with errors like:

```
failed to read plugin permissions: failed to read file '/old/path/.../tauri-...'
```

Fix: `cargo clean --manifest-path src-tauri/Cargo.toml` (or `rm -rf src-tauri/target`), then rebuild.

The cache itself is normal and healthy at ~2–10 GB — don't clear it routinely. Only after a move.

<!-- primitiv -->
## Primitiv — Design System

When the user asks about design tokens, components, patterns, or anything about the look and feel of this product (e.g. "is there a X component?", "what token should I use for Y?", "how should Z look?"), treat it as a query for the Primitiv MCP. Use the tools below to answer — always in the context of this design system.

Before building or modifying any UI, call `get_design_context` and validate the response before proceeding.

### Step 1 — Load the contract
Call `get_design_context` (no args) to get the summary.

### Step 2 — Validate before using
Check the response for two things:

**a) sourceRoot must match this project.**
The response includes a `sourceRoot` field — the absolute path of the project this contract was built from.
If `sourceRoot` does not match the current project's directory, stop immediately.
Do not use the contract data. Tell the user: "Primitiv is pointed at a different project (`sourceRoot`). Run `primitiv init` and `primitiv build` in this project first, or update your MCP config to point at this project's `primitiv.config.js`."

**b) warnings must be empty.**
If the response includes a `warnings` array, stop and surface each warning to the user before continuing.
Each warning includes the exact command needed to fix it (e.g. `npx @ai-by-design/primitiv build /path/to/primitiv.config.js`).

### Step 3 — Use the contract
Once validated, use the contract for all UI work:

- `get_design_context { category: "tokens" }` — full token list
- `get_design_context { category: "components" }` — full component list
- `get_token { name: "...", category: "..." }` — look up a specific token
- `get_component { name: "..." }` — look up a specific component
- `get_conflicts` — see unresolved design conflicts
- `get_inferred_rules` — see design rules inferred from the codebase
- `get_violations` — see hardcoded literals in the codebase that bypass the contract

### Step 4 — Avoid token misuse
Before generating any `className` or style with a literal value (e.g. `bg-[#hex]`, `p-[8px]`), call `get_violations` to see active misuses and `get_design_context` for available tokens. Prefer existing tokens — `bg-[var(--color-primary)]`, `p-[var(--spacing-2)]` — over hardcoded literals. If a violation already has a `suggestion.token`, use that name.

### Rationale (when present)
Tokens and components may include a `rationale` object with `why`, `when`, `deprecated`, `alternatives`, `examples`, or `tags`. When rationale is present:

- Prefer tokens/components whose rationale matches the user's intent over ones with no rationale
- If `deprecated: true`, do not use it — suggest the `alternatives` instead
- Surface `why` and `when` to the user so they understand intent, not just the value
<!-- /primitiv -->
