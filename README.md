# BYOA — Bring Your Own Agent

A desktop-app pattern (and an emerging framework spec) for apps where
the agent is a first-class user. Instead of the app embedding an LLM
behind an API key it owns, the user brings their own agent — Claude
Code, Codex, Gemini CLI, a local Ollama model — and it runs in a
terminal embedded inside the app's window. The app exposes its
state and verbs to the agent via a skill. The user's existing AI
subscription pays for the work.

> **TL;DR.** BYOA is the next step up from BYOK (Bring Your Own Key)
> — the user supplies the agent itself, not just credentials. The
> app dev never sees a token bill, never picks a model, never owns
> conversation history.

**This repo contains:**

1. **The BYOA spec** — `docs/superpowers/specs/2026-05-19-byoa-spike-design.md`. A research-spike manifesto that defines what BYOA is, the four pillars (Observe / Act / State / Identity), the three-file canvas-plugin contract, and the audit showing how much of the framework is already extracted in-place inside KineticType.
2. **KineticType** — the first reference app, built around BYOA from the ground up. A kinetic-typography video editor where the agent edits `story.json` and the preview hot-reloads in ~300ms. **Open source under MIT.**

**The framework is not yet a package.** There is no `npm install
byoa` to run. There's a spec, an audit showing what the seams look
like in a real codebase, and one working reference implementation
(KineticType, which you can build and run today). **Contributions
that extract the framework are very much wanted** — see
[CONTRIBUTING.md](./CONTRIBUTING.md).

If you want the long-form pitch, read the blog post:
[`docs/blog/2026-05-19-byoa-pattern.md`](./docs/blog/2026-05-19-byoa-pattern.md).

---

## The pattern in 30 seconds

A BYOA app is a desktop app with four properties:

1. **An embedded terminal.** The user's agent (whichever CLI they
   have installed) runs *here*, in the app's working directory,
   with the user's existing auth.
2. **A skill that ships with the app.** When a project opens, the
   app writes `.claude/skills/<app-id>/SKILL.md` into the project
   root. The skill tells the agent the schema, the verbs, the
   domain. The agent reads it once per turn.
3. **One canonical state file** the app watches. The agent edits
   it; the preview hot-reloads. The user drags a slider; the file
   gets rewritten. Two writers, one ground truth.
4. **Declared verbs the agent calls as typed tools.** `addBeat`,
   `setColor`, `selectThing`. The framework wires them as agent
   tools with arg validation.

The spec walks all four in detail. The repo's source ships *with*
the binary, so the agent can read the codebase and propose
changes — open source as a runtime property, not a release strategy.

---

## Get started — building KineticType

KineticType is the buildable artifact. It's a kinetic-typography
video editor (illustration-into-text reveal, beat sequencing,
variable-font axes) that demonstrates every property of BYOA on
real data.

### Requirements

- **Node.js** 20 or newer
- **Rust** + Cargo — install via [rustup](https://rustup.rs/)
- **macOS Command Line Tools** (`xcode-select --install`) on macOS;
  the appropriate platform toolchain on Windows/Linux
- An **agent CLI** — `claude` (Claude Code) is the primary target;
  `codex` and `gemini` are also supported via PTY

### Install + run

```bash
git clone git@github.com:tombrewsviews/BYOA.git
cd BYOA
npm install
npm run tauri:dev      # opens Kinetic Studio.app loading the Vite UI
```

The first launch lands on **the Square** — the launcher home
screen. Click `+ New project` to create a project under
`~/KineticStudio/<slug>/`, or open an existing folder containing a
`story.json`.

Once inside a project, you'll see a three-column layout: the
embedded terminal on the left, the preview + timeline in the
center, and a properties panel on the right. Type `claude` (or
`codex`, etc.) in the terminal to start your agent. The agent will
auto-discover the skill at
`.claude/skills/kinetic-studio/SKILL.md` and you're ready to
prompt:

> "make me a 15-second piece where a heart shape morphs into the
> word 'love' in a soft script, then dissolves to scatter into the
> next word 'always'"

The agent reads the schema, writes a `story.json`, and the preview
hot-reloads.

### Build distributables

```bash
npm run tauri:build              # full bundle (.app + .dmg on macOS)
npm run tauri build -- --bundles app   # just the .app, skip DMG step
```

⚠️ The default `tauri build` may fail at the DMG step on macOS due
to a long-standing `hdiutil` quirk. Using `--bundles app` produces
just the `.app`, which is what you want for personal use.

---

## Get started — reading the BYOA spec

If you want to build a *different* BYOA app (or help extract the
framework), the spec is the starting point.

**Read in this order:**

1. [`docs/superpowers/specs/2026-05-19-byoa-spike-design.md`](./docs/superpowers/specs/2026-05-19-byoa-spike-design.md)
   — the manifesto + the contract + the file-by-file audit of
   KineticType. Sections 1–4 are the pitch and design; §5 is the
   audit; §7 lists locked decisions and explicit non-goals.
2. [`docs/superpowers/plans/2026-05-19-byoa-spike.md`](./docs/superpowers/plans/2026-05-19-byoa-spike.md)
   — the implementation plan that validated the spike (Phase A
   paragraph-spec, Phase B audit-driven refactor, Phase C Pillar 3
   tracer).
3. The three validation docs in `docs/superpowers/specs/`:
   - `2026-05-19-second-canvas-validation.md` — paragraph-spec
     proof that the contract holds for a hypothetical Markdown
     Slide Deck app.
   - `2026-05-19-audit-verification.md` — Phase B refactor
     confirms the audit's labels match on-disk reality.
   - `2026-05-19-pillar3-validation.md` — Phase C tracer
     (JSON-Patch writes + content-addressed history log) proven
     end-to-end against KineticType's real `story.json` data.

---

## Architecture overview

The substrate that BYOA-ifies KineticType is roughly 60% extracted
already, living behind two seams:

- **`src-tauri/src/canvas.rs`** — the `Canvas` Rust trait. Each
  app declares its document filename, seed bytes, project
  summary, and skill bundle. The kinetic implementation is in
  `src-tauri/src/canvases/kinetic.rs`.
- **`editor/canvas.ts`** — the TypeScript canvas plugin seam.
  Each app declares its preview component, inspector component,
  conflict-reconciliation function. The kinetic implementation is
  in `editor/canvases/kinetic/`.

### The four pillars (status)

| Pillar | What it is | Built? |
|---|---|---|
| **Observe** | `observe.snapshot()` + `observe.logs()` + `observe.network()` give the agent a structured view of the running preview | Spec only |
| **Act** | Declared verbs + low-level nav primitives (`route`, `click`, `fill`, `read`, `workflow`) | Spec only |
| **State** | `state.write({ patch })` (RFC 6902 JSON Patch) + content-addressed history log | ✅ Tracer shipped, validated against KineticType data |
| **Identity** | Auto-generated routing skill + `introspect.capabilities()` + per-project memory | Hand-written skill exists; auto-generation spec'd only |

The spike validated Pillar 3 (the highest-risk one). The other
three are spec'd in §2 of the design doc but not yet built — see
[Contributing](#contributing).

### Project layout

```
docs/
├── blog/                              The BYOA blog post.
├── fixes/                             Engineering postmortems.
└── superpowers/
    ├── specs/                         The BYOA spec + validation docs.
    └── plans/                         Implementation plans (the spike).

editor/                                The studio UI (React 19 + Vite).
├── App.tsx                            Platform router (Square ↔ active app).
├── platform/                          The Square + app manifest schema.
│   ├── Square.tsx                     Launcher home screen.
│   └── apps.ts                        App registry / manifest type.
├── canvases/kinetic/                  Kinetic canvas plugin (the app).
├── canvas.ts / shell.ts               The TS canvas-plugin seam.
├── terminal.tsx                       Embedded xterm + Tauri PTY bridge.
└── state.ts                           Pillar 3 tracer client.

src-tauri/                             The Rust backend (Tauri 2).
├── src/
│   ├── pty.rs / watch.rs / projects.rs   Substrate.
│   ├── doc.rs                         save_doc / load_doc / apply_patch.
│   ├── history.rs                     Content-addressed history log.
│   ├── skill.rs                       Per-project skill installer (generic).
│   ├── canvas.rs                      The `Canvas` trait.
│   └── canvases/kinetic.rs            Kinetic skill bundle.
└── skills/kinetic/                    Six markdown files: typography,
                                       motion, color, render, layers,
                                       routing.

src/                                   Remotion compositions.
├── kinetic/                           Kinetic typography engine.
└── typography/                        Reusable text-animation primitives.

scripts/                               The `kinetic` CLI + bench tooling.
```

---

## Development

```bash
npm run editor          # Browser-only studio (Vite dev server, port 5174).
                        # Terminal pane shows a stub — no PTY in browser.

npm run tauri:dev       # The real studio — desktop app with embedded PTY.

npm run studio          # Legacy Remotion Studio (props-driven editing).

npm run render          # CLI rendering: `npx remotion render <Comp> out.mp4`

npm run kinetic         # The kinetic CLI (provider benchmarks; see below).
```

### Type checking + tests

```bash
npx tsc --noEmit -p tsconfig.json                       # TypeScript
cargo test --manifest-path src-tauri/Cargo.toml         # Rust tests
cargo check --manifest-path src-tauri/Cargo.toml        # Quick compile check
```

---

## The legacy bits (still work)

KineticType started life as a Remotion playground; some of that
substrate is still here and still useful.

### Remotion Studio (props-driven editing)

Open `npm run studio` and pick a composition. Studio auto-generates
UI controls from the Zod schema in `src/kinetic/schema.ts` — sliders
for `.min().max()` numbers, color pickers for `zColor()`, dropdowns
for `z.enum()`. Good for tweaking *parameters* without touching the
sequence.

### The `kinetic` CLI (vector-provider benchmarks)

`src/kinetic/providers/` is a plugin layer turning the project into a
vector-model benchmark harness. Each provider (Recraft API, Claude
API, local Ollama model, hand-written) implements `VectorProvider`
and returns a normalized 0..100 `d` path plus benchmark metrics
(node count, latency, cost).

```bash
cp .env.example .env       # then fill in the keys you have
npm run kinetic providers                       # which are ready
npm run kinetic gen recraft "a sprout"           # generate one shape
npm run kinetic benchmark "a circle->letter"     # all providers, same prompt
```

⚠️ **`ANTHROPIC_API_KEY` here is NOT the same as Claude Code
auth.** The provider benchmark uses the Anthropic REST API
(billed separately); Claude Code via the terminal uses your
Claude Pro/Max subscription. BYOA in this repo refers to the
Claude-Code-via-terminal path, NOT the API-key provider path.

### Typography primitives

`src/typography/` ports portfolio-grade text animations
(line-reveal, scatter, width-reveal) into frame-accurate Remotion
components. Independent of the kinetic-storytelling layer; usable in
any Remotion composition.

---

## Contributing

The most useful things that could happen next:

1. **Build a second BYOA app.** Fork this repo, gut the kinetic
   parts, replace them with a different domain (a markdown slide
   deck, a vector logo animator, a prompt-music sketcher, a 3D
   scene editor — anything where state-as-a-file makes sense). The
   spec's §7.4 validation criterion #2 is satisfied on paper;
   doing it in code is the real test.
2. **Help extract the framework.** The spec's §5 audit labels every
   file as `shell` (would be in the framework) or `app`
   (kinetic-specific) or `split` (needs surgery). The shell-labelled
   files are mostly ready to lift into a separate package.
3. **Implement the other three pillars.** Pillar 3 (State) shipped
   as a working tracer. Pillars 1 (Observe), 2 (Act), and 4
   (Identity) are spec'd in §2 of the spec but not built.
4. **Stress-test the BYOK→BYOA conversion-tax claim.** Try BYOA
   with non-developer users. Does "install Claude Code first"
   feel manageable, or does it kill onboarding?

See [CONTRIBUTING.md](./CONTRIBUTING.md) for dev setup, branch
naming, commit-message convention, and review expectations.

---

## License

MIT — see [LICENSE](./LICENSE).

Copyright © 2026 Tom Brews Views and contributors.

---

## Further reading

- **The blog post:** [docs/blog/2026-05-19-byoa-pattern.md](./docs/blog/2026-05-19-byoa-pattern.md)
  — how the agent UI evolved from chat tab → sidebar → agent-native
  IDE → BYOA, and what makes BYOA economically real now that
  Anthropic ships subscription auth in the Claude Agent SDK.
- **The spec:** [docs/superpowers/specs/2026-05-19-byoa-spike-design.md](./docs/superpowers/specs/2026-05-19-byoa-spike-design.md)
  — the framework's design contract.
- **The plan + validation docs:** in
  [docs/superpowers/](./docs/superpowers/) — the GSD-style
  research-spike process that validated the bet.
- **External:** Tauri 2 ([tauri.app](https://tauri.app)), Remotion
  ([remotion.dev](https://remotion.dev)), Claude Code
  ([claude.com/code](https://claude.com/code)).
