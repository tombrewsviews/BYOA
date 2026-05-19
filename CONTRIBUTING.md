# Contributing to BYOA / KineticType

Thanks for your interest. This repo is the spec for the BYOA
framework + KineticType, the first reference app. **The framework
itself is not yet a package** — extracting it from KineticType
is one of the things we're hoping contributors help with.

## What needs doing

In rough order of how much they'd move the project forward:

### 1. Build a second BYOA app

The single highest-value contribution. Fork the repo, gut the
kinetic parts (everything under `editor/canvases/kinetic/`,
`src-tauri/src/canvases/kinetic.rs`, `src/kinetic/`, the kinetic
skill at `src-tauri/skills/kinetic/`), and replace them with a
different domain. Possible second canvases:

- **Markdown Slide Deck** — already paragraph-spec'd in
  [`docs/superpowers/specs/2026-05-19-second-canvas-validation.md`](./docs/superpowers/specs/2026-05-19-second-canvas-validation.md).
- **Vector logo animator** — single shape, prompt-driven, exports
  to MP4 + SVG.
- **Prompt-music sketcher** — short loops, parametric, agent
  arranges sections.
- **3D scene editor** — a Three.js preview with the agent placing
  primitives.

If your domain doesn't fit the manifest contract (§3 of the spec)
without inventing new fields, that's data — open an issue
describing what was missing.

### 2. Help extract the framework

Section 5 of the spec ([`docs/superpowers/specs/2026-05-19-byoa-spike-design.md`](./docs/superpowers/specs/2026-05-19-byoa-spike-design.md))
labels every file in KineticType as `shell` (would be in the
framework), `app` (kinetic-specific), or `split` (needs surgery).
Phase B of the spike already moved most `app`-labelled files into
`canvases/kinetic/`. The remaining work:

- Move the still-at-shell-level kinetic UI files (`panel.tsx`,
  `timeline.tsx`, `player.tsx`, `controls.tsx`, `Library.tsx`,
  `library/`, `StarterCard.tsx`, `AddImage.tsx`, `AddVideo.tsx`)
  into `editor/canvases/kinetic/`. Pure relocation; the audit
  predicts ~1 hour of import-path fixing.
- Lift the shell-labelled code into a separate npm package
  (working name: `byoa`). The seams are already named —
  `editor/canvas.ts`, `editor/shell.ts`, `src-tauri/src/canvas.rs`.
- Decide the package boundary for the Rust crate (a `byoa-rs`
  alongside `byoa`, or one combined?).

### 3. Implement the other three pillars

The State pillar (#3) shipped as a working tracer in commit
`de32189` + follow-ups. The other three are spec'd in §2 of the
spec but not built:

- **Pillar 1 — Observe.** `observe.snapshot()`, `observe.logs()`,
  `observe.network()`. Captures from the preview iframe via
  instrumentation that runs before app code.
- **Pillar 2 — Act.** Declared verbs (already partly modeled in
  Remotion-style `inputProps` schemas) plus the nav primitives
  (`route`, `click`, `fill`, `read`, `workflow`) using
  `useStableId()`.
- **Pillar 4 — Identity.** Auto-generated routing skill (replaces
  the hand-written one at `src-tauri/skills/kinetic/SKILL.md`),
  `introspect.capabilities()`, per-app memory.

Each pillar is a self-contained chunk of work; you can do one
without touching the others.

### 4. Stress-test the BYOK→BYOA conversion-tax claim

The blog post claims BYOA's onboarding cost ("install Claude
Code") is lower than BYOK's ("paste an API key"). That's a real
empirical question. If you run user tests, write up findings,
PR them under `docs/research/`.

## Dev setup

See the [README](./README.md#requirements) for prerequisites
(Node 20+, Rust + Cargo, an agent CLI).

```bash
git clone git@github.com:tombrewsviews/BYOA.git
cd BYOA
npm install
npm run tauri:dev          # start the studio in dev mode
```

Quick sanity checks before submitting a PR:

```bash
npx tsc --noEmit -p tsconfig.json                    # TS compile
cargo test --manifest-path src-tauri/Cargo.toml      # Rust tests
cargo check --manifest-path src-tauri/Cargo.toml     # Rust compile
```

If you're modifying the preview pipeline, the kinetic timeline, or
anything else user-visible, manually exercise the affected feature
in `npm run tauri:dev` before opening the PR. Type checkers don't
catch UI regressions.

## Branch + commit conventions

- **Branches:** `feat/<short-description>`, `fix/<short>`,
  `refactor/<short>`, `docs/<short>`. Don't work on `master`
  directly.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/)
  shape — `feat(scope): short subject`. Scopes commonly used here:
  `editor`, `panel`, `timeline`, `player`, `doc`, `history`,
  `skill`, `canvas`, `kinetic`, `tauri`, `deps`, `docs`.
- **Subject line:** under 70 characters, imperative mood, no
  trailing period.
- **Body:** explain the *why*, not the *what*. The diff shows
  what changed. Wrap at 72 columns.
- **Co-authors:** if an AI agent helped, add a
  `Co-Authored-By: …` trailer.

Example (recent real commit from this repo):

```
refactor(skill): split generator from kinetic bundle

skill.rs now owns only the SkillBundle struct and install machinery.
The kinetic-specific include_str! payload and CLAUDE_MD literal move
to canvases/kinetic.rs, exposed via Canvas::skill_bundle(). Adding
a second canvas later is mechanical — define another bundle, return
it from that canvas's trait impl.
```

## Pull request flow

1. **Open an issue first** for non-trivial changes (anything
   beyond a typo or single-file fix). Lets us check the direction
   matches the spec before you sink time into it.
2. **Keep PRs focused.** One concern per PR. A new canvas plugin,
   a pillar implementation, a refactor — each is its own PR.
3. **Cite the spec section your change targets.** If your PR
   implements Pillar 1, say so in the description.
4. **Tests:** new Rust modules need unit tests (see
   `src-tauri/src/history.rs::tests` for the pattern). TypeScript
   modules can be lighter — manual verification is fine for UI
   changes, but the Rust side enforces test discipline.
5. **Don't break the spike's success criteria.** §7.4 of the
   spec lists three criteria the spike validates; PRs shouldn't
   regress any of them.

## Code style

- **TypeScript:** strict mode. No `any` unless genuinely
  unavoidable (and then with a `// eslint-disable-next-line` and
  a reason). Prefer `unknown` and narrow.
- **Rust:** stable channel, clippy-clean (`cargo clippy
  --manifest-path src-tauri/Cargo.toml`). Doc-comments on every
  `pub` item.
- **Comments:** by default, none. Add one only when the *why* is
  non-obvious — a hidden constraint, an invariant, a workaround
  for a known bug. Don't explain *what* the code does; the names
  should do that.

## Security

If you find a security issue (a leaked secret, an unsafe IPC
boundary, a way to escape the project sandbox), please **email**
the maintainer instead of opening a public issue. Contact info
is in the git history.

## License

By contributing, you agree your contributions are licensed under
the same MIT license as the rest of the project. See
[LICENSE](./LICENSE).
