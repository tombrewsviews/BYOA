# BYOA: a pattern for apps where you bring your own agent

I built a desktop app called KineticType — a kinetic-typography video
editor. About halfway through, I realized I wasn't really shipping a
video editor. I was shipping a *substrate* for one. The interesting
part wasn't the timeline or the beat renderers; the interesting part
was that my agent (Claude Code, running in an embedded terminal) could
read the source, edit the state file the preview reloads from, and
collaborate with me on the work — using *my* Claude subscription, not
an API key the app paid for.

The pattern needs a name, and it already has half of one.

---

## From BYOK to BYOA

For the last few years there's been an acronym for the
adjacent pattern: **BYOK** — "Bring Your Own Key." The app provides
the interface and product logic, but the user supplies their own LLM
API credentials (OpenAI, Anthropic, etc.), so usage is billed
directly to the user's account rather than the app developer's. You
see it everywhere in dev tools and prosumer AI apps where margins on
inference would otherwise kill the business — Cursor's early days,
Cline, Continue, dozens of others. Related terms have floated around:
**BYO-LLM** or **BYOM** (Bring Your Own Model) for the broader version
that includes self-hosted endpoints; "user-provided keys" as the boring
enterprise phrasing; "pass-through billing" for the economic effect.

BYOK is often pitched as a clean cost-offload, but it's a real
conversion tax. Asking a non-technical user to generate an API key,
paste it into a settings page, and figure out which model to point
at is a brutal onboarding step — fine for developer tools, usually
fatal for consumer apps. The common compromise is "managed by default,
BYOK as an option for power users."

**BYOA — Bring Your Own Agent — is the next step up that stack.**
Instead of the user supplying an API key for the app to use on their
behalf, the user supplies *the agent itself*. The app provides the
interface, the domain knowledge, the state surface — but the agent
process belongs to the user and runs in a terminal embedded inside
the app's window. It uses whichever AI subscription the user already
pays for (Claude Pro, ChatGPT Plus, a local Ollama model, whatever).
The app dev never sees a key, never picks a model, never processes a
token bill.

The conversion tax shifts. You're no longer asking the user to paste
an API key; you're asking them to have an agent CLI installed
(`claude`, `codex`, `gemini` — increasingly common, and likely to be
standard on developer laptops within a year). That's still a tax for
true consumer apps, but it's a much smaller one for the
prosumer/creator audience where BYOK has worked.

This post explains how we got from "AI is a tab you alt-tab to" to
"BYOA is a viable distribution model," shows what's load-bearing
about the pattern, and uses KineticType as a worked open-source
example.

---

## How the agent UI got to "the agent IS the app"

It's worth pausing on how fast this changed.

**Phase 1 — The chat tab (2022–2023).** ChatGPT shipped as a
standalone web app. You alt-tabbed to it. The interaction model was:
copy your problem out of your real tool, paste it into the chat, copy
the answer back. Both Claude and ChatGPT settled on the same two-column
layout — conversation list on the left, chat on the right — and that
[became the standard pattern for the era][intuitionlabs].

**Phase 2 — The sidebar (2023–2024).** The browser sidebar pattern
emerged. AI was no longer a destination tab; it was a persistent panel
next to whatever you were doing. [OpenAI's Atlas browser shipped a
persistent AI sidebar with full context of the current page.][atlas-mention]
Dozens of Chrome extensions ([AiNBar][ainbar], various "AI Sidebar"
extensions) raced to bring ChatGPT/Claude/Gemini into the side panel of
every webpage. The chat was still a separate surface — but it had moved
*into* your tool instead of *next to* it.

**Phase 3 — The agent-native IDE (2024–2025).** Cursor and Claude Code
broke the sidebar pattern by collapsing the boundary entirely. The agent
could *read* your project directory, *execute* shell commands, *edit*
files, and *hold* persistent context across turns. The chat surface and
the work surface stopped being two things. [Builder.io's roundup put it
plainly][builder-ide]: the most effective agent tools converged on a
text-based sequential interaction model — the terminal — even though
Cursor, Codex, and Claude Code were built by competing organizations.

**Phase 4 — Agent UX as a discipline (2025–2026).** Once agents were
taking real actions, design caught up. The field [coalesced around five
patterns every enterprise agent needs][fuselab]: planning visibility,
tool-use disclosure, memory surfacing, multi-step workflow tracking,
and recovery routing. "Generative UI" emerged as a term of art: the
agent doesn't just *talk*, it *produces interface*. [CopilotKit's
2026 guide][copilotkit] taxonomized three flavors — static (frontend
owns the layout), declarative (agent returns a JSON UI spec), and
open-ended (agent returns a full surface, e.g. via MCP Apps).

**Phase 5 — Bring your own agent (2026).** Which is where BYOA lives.
The pattern is what I described above: the agent runs in a terminal
embedded in the app's window, the app exposes its own state and verbs
to the agent via a skill, the user's existing AI subscription pays for
the work.

Anthropic [shipped subscription auth in the Claude Agent SDK in
2026][claude-sdk-subs]: third-party apps can now authenticate against a
user's Claude Pro/Max plan instead of requiring an API key. That's the
piece that makes BYOA economically real for indie developers. Before,
every app that wanted "an AI inside" had to either eat API costs or
pass them through. Now the user pays once, to Anthropic, and that
single subscription powers their work across every BYOA app they use.

---

## What a BYOA app actually is

A BYOA app is a normal Tauri (or Electron, or whatever) desktop app
with four extra properties:

1. **An embedded terminal,** mounted persistently inside the app's
   window. The agent (Claude Code, Codex, or whichever CLI the user
   has installed) runs *here*, in the app's working directory, with
   the user's existing auth.

2. **A skill that ships with the app.** When the user opens a project,
   the app writes a `.claude/skills/<app-id>/SKILL.md` into the project
   root. The skill tells the agent: *you're running inside <app-name>;
   the state file is `story.json`; you have verbs A, B, C; here's how
   to think about the domain*. The agent reads the skill, the agent
   knows the app.

3. **One canonical state file** the app watches. When the agent edits
   it, the preview reloads in ~300ms. When the user drags a slider,
   the file gets re-written. Two writers, one ground truth, no UI/state
   drift.

4. **A handful of declared verbs** the agent can call as typed tools.
   `addBeat`, `setColor`, `selectThing`. The agent doesn't have to
   reason about your DOM or invent imperative API calls — it has a
   schema, it picks an op, it submits. The app applies the patch.

That's it. Three files plus an icon and a manifest is what an app dev
declares; the framework wires the rest.

---

## Why BYOA matters

The economics first.

When apps embed an agent the old way — through an API key the app
holds — three things happen:

- **The app pays per token.** Either it eats the cost (and goes
  bankrupt on power users) or it passes it through (and you pay twice,
  once for your ChatGPT subscription and once for the app's wrapper of
  it).
- **The app picks the model.** You're stuck with whichever LLM the dev
  wired in. If a better one ships, you wait for an update.
- **Your conversations live in the app's account.** They don't carry
  over to your other tools.

BYOK fixed the first one. BYOA fixes all three. The agent process is
*your* process. It uses *your* auth. Your Claude Pro subscription,
your Codex subscription, your local Ollama model — whatever you've
already chosen for your day-to-day work. The app dev never sees an API
key, never processes a payment for tokens, never picks a model on your
behalf.

For indie developers, this is enormous. Before: shipping an
AI-powered app meant either eating LLM costs (unsustainable),
charging users API-token markups (race to the bottom), or building
a subscription business on top (operational nightmare). After: ship
the app, charge nothing for AI, the user's existing subscription
pays. You compete on the *experience* of using your software with
an agent — not on infrastructure cost.

For users, it's similarly clean. The agent that knows you, has read
your memory, has your conversation history — *that's* the agent
that operates your tools. Not the small dumb one the app dev
bolted on to save money.

There's a second thing BYOA changes that goes beyond economics:
**the app dev no longer needs to be in the business of agent
quality.** When you embed an LLM via API, you're implicitly promising
the user that the model you picked is good enough for their work. If
it hallucinates, that's on you. With BYOA, the user picked the agent,
the user knows what it can do. The app's job is to make its surface
*legible* to whatever agent shows up — schema, verbs, skill — not to
guarantee a particular agent's output quality. That's a much smaller
promise to keep.

---

## The pattern at the code level

A BYOA app is three files:

```
my-app/
├── byoa.manifest.ts         # what this app is — schema, verbs, routes
├── preview.tsx              # one React component the framework mounts
├── runtime.ts               # how verbs translate to state changes
└── icon.png
```

The manifest declares the state schema (a Zod object — the framework
auto-derives TypeScript types AND generates JSON-shaped agent tools
from it), declares the verbs (`addThing`, `setColor`), and declares
what `observe.snapshot()` should return to the agent (current
selection, current route, what's on screen).

The framework reads the manifest at project-open time and writes the
skill. The skeleton of every routing skill looks the same across every
app — only the verbs and schema vary. So an agent that's worked inside
one BYOA app already knows how to work inside the next one.

State writes go through RFC 6902 JSON Patches, not full-document
rewrites. Agents are bad at rewriting whole documents; they're good at
producing small diffs. The framework writes accepted patches to an
append-only content-addressed log under `.byoa/history/`, so the
agent can branch, revert, diff. Nothing the agent does is irreversible.

---

## The status: a spec, plus one reference app

**Important caveat before anyone goes looking for `npm install byoa`:
the framework doesn't exist yet.** What exists today is a spec, an
audit showing what the seams look like in a real codebase, and one
working reference app.

The spec lives in this repo at
[`docs/superpowers/specs/2026-05-19-byoa-spike-design.md`][spec]
(named after the framework's working title during the spike — the
acronym BYOA stuck only after the spike validated the bet). It
describes the contract in full: how an app dev declares its manifest,
how the four pillars (Observe, Act, State, Identity) work, how the
launcher screen ("the Square") relates to standalone .app bundles,
what the framework deliberately doesn't do.

The first reference app is **KineticType** — released as open source
alongside this post. It's a kinetic-typography video editor, the kind
of motion graphics you'd see in a Netflix opening title.
Illustration-into-text reveal, beat sequencing, variable-font axes.
The agent reads a skill that ships with the app, edits a `story.json`
in the project root, and the preview hot-reloads. Two collaborators,
one ground truth.

A typical session looks like this. The user types into the embedded
terminal:

> "make me a 15-second piece where a heart shape morphs into the word
> 'love' in a soft script, then dissolves to scatter into the next
> word 'always'"

…and the agent reads the skill, reads the schema, writes a `story.json`
with the right beats arranged on the right tracks with the right
timings. The user drags a slider to nudge a color; the file rewrites;
the agent sees the change on its next read.

KineticType isn't a *demo* of BYOA — it's the codebase the spike was
extracted from, and the place the seams were proven in. The spec's
audit (§5) shows that roughly 60% of the framework is already
extracted in-place inside KineticType — the canvas-plugin pattern,
the watcher, the per-project skill installer, the embedded PTY pool.
The remaining work isn't *invention*; it's *separation*. Whoever
finishes that separation ships the framework.

Source ships *with* the binary; the agent can read why something
behaves a particular way and propose patches. Users become contributors
the moment they say *"why does it do that — change it."* This last
bit — open source as a runtime property, not a release strategy — is
the part I find most surprising. The next prompt can reshape the tool.
The user is no longer just a user.

---

## What's deliberately not in v1

It's worth being honest about what BYOA *isn't* yet:

- **The framework itself isn't a package.** It's a pattern, a spec,
  and a reference implementation living inside KineticType. There's
  no `npm install byoa` to run. Someone has to do the extraction
  before that exists.
- **No cloud agent.** The agent runs locally, in your terminal, with
  your auth. If you want to run Claude Code on a remote box and tunnel
  in, fine — but the framework doesn't host anything.
- **No app store with reviews and payments.** The hub (the launcher
  screen, called "the Square") would be a thin registry: it points at
  where apps live, but apps host themselves on GitHub Releases or
  wherever.
- **No multi-user collaboration.** Single user, single machine, no
  CRDTs. The agent and the user are the only two writers.
- **Only one pillar built so far.** The spec describes four pillars —
  Observe (see preview + read logs), Act (verbs + nav primitives),
  State (patches + history), Identity (auto-skill + memory). The
  research spike validated the State pillar end-to-end. The others
  are spec'd but not yet implemented.

The point of this v1 isn't completeness. The point is to prove that
the pattern works on real data and is worth committing to. KineticType
is the proof.

---

## Contributions wanted

This is the part of the post where I'd normally say "stay tuned for
v1 of the framework." I'm not going to, because **the most useful
thing that could happen next is someone else helping extract it.**

Concretely, the help that would move BYOA forward the fastest:

1. **Build a second BYOA app.** Fork KineticType, gut the kinetic
   parts, replace them with a different domain (a markdown slide
   deck, a vector logo animator, a prompt-music sketcher, a 3D scene
   editor — anything where state-as-a-file makes sense). The spec's
   §7.4 validation criterion #2 is satisfied on paper; doing it in
   code is the real test.
2. **Help extract the framework.** The spec's §5 audit labels every
   file in KineticType as `shell` (would be in the framework) or
   `app` (kinetic-specific) or `split` (needs surgery). The
   shell-labelled files are roughly ready to lift into a separate
   package; the split-labelled files need to be cut along the lines
   the audit describes.
3. **Implement the other three pillars.** Phase C of the spike
   shipped Pillar 3 (State — JSON Patch writes + history log) as a
   working tracer. Pillars 1 (Observe — preview snapshot + logs +
   network capture), 2 (Act — verbs + nav primitives), and 4
   (Identity — auto-skill + memory + introspection) are spec'd in
   §2 of the spec but not built.
4. **Stress-test the BYOK→BYOA conversion-tax claim.** Try BYOA with
   non-developer users. Does "install Claude Code first" feel
   manageable, or does it kill onboarding? The honest answer
   determines whether BYOA is a developer-tool-only pattern or
   something broader.

The full repo (KineticType plus the BYOA spec, plan, and validation
docs) is open source at
[github.com/tombrewsviews/BYOA](https://github.com/tombrewsviews/BYOA).
Issues and PRs welcome. The spec is the contract; the audit is the
map; the rest is execution.

---

## Where this goes next

If you're an indie dev considering shipping a desktop app with an AI
inside, the question I'd ask is: *do you actually want to own the
agent, or do you want to own the surface around it?*

If you want to own the agent — pick a model, manage prompts, eat token
costs, build memory — that's the old pattern. BYOK helps with the
token costs but leaves you holding the model-selection bag. It works,
it's expensive, it ties your roadmap to LLM API changes.

If you want to own the surface — the schema, the verbs, the preview,
the domain expertise the agent needs in a skill — that's BYOA. The
user brings the brain. You bring the world it acts on.

I think BYOA is going to look obvious in two years and weird right now.
That's usually a good sign.

---

**Sources / further reading:**

- [Comparing Conversational AI Tool User Interfaces — IntuitionLabs (2025)][intuitionlabs] — the sidebar-and-two-columns era.
- [AiNBar — Native AI in Browser Sidebar][ainbar] — representative of the Phase 2 pattern.
- [The Best Agentic IDEs Heading Into 2026 — Builder.io][builder-ide] — why terminal-based agents converged across competing teams.
- [Agent UX: Designing UI for AI Agents in 2026 — Fuselab][fuselab] — the five patterns every enterprise agent needs.
- [The Developer's Guide to Generative UI in 2026 — CopilotKit][copilotkit] — taxonomy of static / declarative / open-ended generative UI.
- [Use the Claude Agent SDK with your Claude Plan — Anthropic][claude-sdk-subs] — the subscription-auth capability that makes BYOA economically real.
- [Agent Skills — Microsoft Open Source][ms-skills] — skills as the modular-expertise pattern.

[intuitionlabs]: https://intuitionlabs.ai/articles/conversational-ai-ui-comparison-2025
[atlas-mention]: https://intuitionlabs.ai/articles/conversational-ai-ui-comparison-2025
[ainbar]: https://ainbar.com/
[builder-ide]: https://www.builder.io/blog/agentic-ide
[fuselab]: https://fuselabcreative.com/ui-design-for-ai-agents/
[copilotkit]: https://www.copilotkit.ai/blog/the-developer-s-guide-to-generative-ui-in-2026
[claude-sdk-subs]: https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
[ms-skills]: https://microsoft.github.io/skills/
[spec]: ../superpowers/specs/2026-05-19-byoa-spike-design.md
