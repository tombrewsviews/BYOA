# Outreach multi-user board (shared Postgres, live sync) — Design

**Status:** approved for planning (self-directed brainstorm; user directive: "make decisions, keep it simple and flexible").
**Depends on:** the completed Outreach app (`feat/outreach-app`, HEAD `15c37e2`).
**Companion:** `2026-07-25-outreach-board-design.md` (the single-user app this extends).

## Goal

Multiple people run the Outreach desktop app locally, all pointed at **one shared
Postgres database** (provisioned via Vercel Marketplace → Neon), see the **same
board live**, and contribute **simultaneously**. Each client is identified by a
**name** — no real auth. The desktop app still works fully **local-first** when no
database string is configured (today's behavior, unchanged).

Vercel's role is narrow: it **provisions and bills the managed Postgres**. There
is no Vercel web app, no serverless functions, no deploy pipeline. The runtime
(Rust backend, MCP server, `board-cli`, UI) stays entirely on each user's machine.

## Non-goals (explicit, per "keep it simple")

- **No auth / roles / impersonation protection.** The name IS the identity. This
  is a **trusted-collaborators** model — anyone with the connection string can
  bypass gates or claim any name. Consistent with §15.6 ("no roles, trust by
  construction"). Named here so it is a conscious choice.
- **No real-time push in v1.** Polling (already built) is the sync mechanism.
  Postgres `LISTEN/NOTIFY` is a future upgrade needing no data-model change.
- **No CRDT / merge engine.** The append-only event log + optimistic `version`
  gate already handle concurrent edits honestly (a stale write returns
  `conflict:` and the client reloads).
- **No SQLite→Postgres migration tool.** A shared board starts fresh; a local
  board stays local. (A one-off export can be a later script if ever needed.)
- **No async rewrite.** The whole board layer stays synchronous (see Decision 1).

## Architecture

```
 ┌─ user A (desktop) ─┐   ┌─ user B (desktop) ─┐   ┌─ user C (desktop) ─┐
 │ UI · MCP · board-cli│  │ UI · MCP · board-cli│  │ UI · MCP · board-cli│
 │  board.rs (verbs)   │  │  board.rs (verbs)   │  │  board.rs (verbs)   │
 └─────────┬───────────┘  └──────────┬──────────┘  └──────────┬──────────┘
           └───────────────┬─────────┴────────────────────────┘
                    DATABASE_URL (Postgres over TLS)
                    ┌───────────────────────────────┐
                    │  Vercel → Neon Postgres        │
                    │  (shared board: same schema)   │
                    └───────────────────────────────┘
```

Every client runs the *same* `board.rs` verbs and gates locally; they just share
one database instead of each having a local `board.db`.

## Design decisions (made, not open)

### Decision 1 — synchronous `postgres` crate (not async, not sqlx)
The entire `board.rs` layer is synchronous (`&Connection`, called from sync Tauri
commands and a sync `board-cli` `main`). Adopting async (`tokio-postgres`, `sqlx`)
would force `async` up through every caller. **Use the blocking `postgres` crate**
(same maintainers as `tokio-postgres`). Keeps all existing signatures synchronous;
smallest blast radius. Connection pooling is unnecessary for a small team — one
`postgres::Client` per process (the Tauri app opens one per active project; each
`board-cli` invocation opens its own short-lived one, exactly as it opens SQLite
today).

### Decision 2 — one `Db` seam, not a trait, not a fork
Introduce a thin enum wrapping the two concrete handles:

```rust
pub enum Db {
    Sqlite(rusqlite::Connection),
    Pg(postgres::Client),
}
```

`Db` exposes the *small* set of primitives the verbs actually use, and hides the
two differences that matter (param placeholders `?1`↔`$1`, and row extraction):

```rust
impl Db {
    fn exec(&mut self, sql: &str, params: &[&dyn ToSqlParam]) -> Result<u64>;      // execute, returns rows-affected
    fn query_opt_row<T>(&mut self, sql: &str, params: &[..], map: F) -> Result<Option<T>>;
    fn query_rows<T>(&mut self, sql: &str, params: &[..], map: F) -> Result<Vec<T>>;
    fn savepoint(&mut self, name: &str) -> Result<()>;   // SAVEPOINT (both dialects support it)
    fn release(&mut self, name: &str) -> Result<()>;
    fn rollback_to(&mut self, name: &str) -> Result<()>;
    fn last_insert_seq(&mut self) -> Result<i64>;        // events.seq — see Decision 4
}
```

Rationale vs. alternatives (all rejected): a generic `Backend` **trait** threads
generics through 109 call-sites and two impls (over-engineered); **forking**
`board.rs` duplicates every verb + gate (DRY violation). The enum implements ~8
primitives twice; the verb/gate logic is written **once**. The 109 SQL call-sites
change mechanically (`c.execute(...)` → `db.exec(...)`), keeping verb signatures
and all tests' intent intact. This is the "simple and flexible" middle.

**SQL dialect:** author SQL in the **portable subset**; where the two genuinely
differ (`?1` vs `$1`, `autoincrement` vs `generated … as identity`, `on conflict`),
`Db` normalizes. The verbs pass `?1`-style placeholders; the `Pg` arm rewrites to
`$1` (a tiny, well-tested translation), so verb SQL is written **once**.

### Decision 3 — local-first `open_board` dispatch
`open()` becomes `open_board(project_dir, cfg) -> Db`:
- `cfg.database_url` present → `Db::Pg(Client::connect(url, TlsMode))`; run
  `ensure_schema` (Postgres DDL) + race-safe seed (Decision 5).
- else → `Db::Sqlite(open(project_dir/board.db))` — **today's path, unchanged.**

No DB string ⇒ byte-identical to the single-user app. This preserves local-first
and makes Postgres purely opt-in.

### Decision 4 — `events.seq` monotonic id in both dialects
SQLite uses `integer primary key autoincrement`; Postgres uses
`bigint generated always as identity` (or `bigserial`). `commit()` needs the new
`seq` back: SQLite via `last_insert_rowid()`, Postgres via
`INSERT … RETURNING seq`. `Db::last_insert_seq` (or a `commit`-local `RETURNING`
branch) abstracts this. `revert(seq)` reads/deletes by `seq` identically in both.

### Decision 5 — actor identity from config
- New config: `OUTREACH_ACTOR` = the user's name. Derive `actor_id =
  slugify(name)`, `label = name`.
- On `open_board` (both modes), upsert: `insert into actors(id,label,created_at)
  values(...) on conflict (id) do nothing`.
- Replace the hardcoded `"local"` actor literal in verbs/`commit`/`init` seed with
  the configured `actor_id`. Default remains `("local","You")` when `OUTREACH_ACTOR`
  is unset (local mode). Verbs already thread `actor` — it now sources from config.
- Result: the append-only event log already records `actor` per write, so
  "who did what" is correct across users with zero new schema. `board_config.created_by`
  and `stages.created_by` likewise carry the real name.

### Decision 6 — race-safe one-time bootstrap (Postgres)
N clients may hit an empty shared DB at once. Seeding must happen exactly once:
- Wrap the seed block in a Postgres **advisory lock** (`pg_advisory_xact_lock(<const>)`).
- All seed inserts use `on conflict do nothing` (stages by `id`, `board_config`
  by `id=1`, actor by `id`).
- The existing "seed only when `count(stages)=0`" guard stays as the fast path.
SQLite mode is single-writer (one local file) so its existing seed is already safe.

### Decision 7 — live sync via existing poll
The board window already polls `listStages`+`listLeads` (1500ms) and the Properties
panel polls (2000ms). Against the shared DB, each client's poll re-fetches shared
state, so another user's change appears within one interval. The optimistic
`version` gate (built) makes simultaneous edits safe: a stale `moveLead`/
`appendContext` returns `conflict:` → client reloads and retries. **No new sync
code** — just point the existing polls at the shared DB. (Optional: shorten the
board poll to ~1000ms for snappier shared feel; flexible, no model change.)

## Configuration surface (what the user sets — you asked to make this ready)

Two values per client, stored locally (never committed), read at project open:
| Key | Meaning | Example |
|---|---|---|
| `DATABASE_URL` | Postgres connection string from Vercel/Neon | `postgresql://u:p@ep-x.neon.tech/db?sslmode=require` |
| `OUTREACH_ACTOR` | This user's display name | `Ada Lovelace` |

Sourcing (in precedence order): process env → the app's Settings (persisted to
`~/.outreach/config.json`). The board-cli reads the same env (the MCP server
already inherits env and passes `OUTREACH_PROJECT`; it will also pass
`DATABASE_URL`/`OUTREACH_ACTOR` when set). When `DATABASE_URL` is empty/absent →
local SQLite, current behavior.

A small **Settings UI addition** (in the existing Properties→Settings view): two
fields — "Shared database URL" and "Your name" — writing to `~/.outreach/config.json`.
This is the "ready to add db string + user name" the user asked for.

## Data model

**Unchanged.** The §15 six-table schema (`actors`, `stages`, `leads`, `events`,
`board_config`, `rules`) ports as-is to Postgres with dialect-equivalent column
types (`text`→`text`, `int`→`int`, `events.seq` per Decision 4). No new tables,
no new columns. Multi-user is achieved entirely by (a) sharing the DB and (b)
sourcing the actor from config.

## Trust boundary (restated)

Gates (`needs-confirm`, `rule-blocked`, optimistic `version`, `retired-id-reuse`,
`dryRun`) live in each client's local `board.rs`/`board-cli`. With a shared DB and
no auth, clients are **trusted**. The optimistic-`version` gate still does real
work between honest clients (prevents lost updates). Impersonation/tamper
resistance does **not** exist and is out of scope by design.

## Testing strategy

- **Db seam unit tests:** the `Db` primitive methods against an in-memory SQLite
  (fast, no network) — proves the param-translation + rowget + savepoint behave.
- **Verb/gate tests:** the existing 42 crate tests keep running against
  `Db::Sqlite` (in-memory) — they are the regression guarantee that the port
  preserved every gate and reversibility property.
- **Postgres path:** a **feature-gated / env-gated integration test** (`OUTREACH_TEST_PG`
  set to a throwaway Postgres URL) that runs the §15.8 acceptance lifecycle against
  a real Postgres, plus a concurrency test (two `Db::Pg` clients: one moves a lead,
  the other's stale move returns `conflict:`). Skipped when the env var is absent so
  CI/local without Postgres stays green.
- **Race-safe seed test:** two connections seed concurrently → exactly 5 stages,
  one board_config (env-gated Postgres test).

## Rollout

1. Land the port with SQLite as default (all existing tests green) — **zero
   behavior change** for anyone without a DB string.
2. User provisions Neon via Vercel, drops the URL + name into Settings.
3. Team members do the same with the same URL → shared live board.

Backwards compatible at every step; the shared mode is purely additive.
