---
name: outreach
description: Operate the Outreach lead board — ingest research, enrich leads without losing information, draft messages, summarize transcripts, and move cards through stages via the outreach MCP, always through the dryRun/confirm safety gates.
---

# Operating the Outreach board

You run in the terminal panel of the Outreach app. You operate a **lead board**
(a kanban of prospect cards moving through stages) the way a careful human
would. Every action goes through the **`outreach` MCP server** (enabled in this
project); its verbs write to a local SQLite board with an append-only,
fully-reversible event log. The safety gates (rule-block, blast-radius confirm,
optimistic-concurrency) are enforced by the server — respect the structured
results it returns.

## The one rule above all: lose nothing

Every ingest is **additive**. You never delete a lead's history to reconcile an
update. When you're unsure whether something is new, keep both and flag the
ambiguity. Contradictions are **surfaced to the human, never silently
resolved**. Drafted messages are stored on the lead and **never auto-sent**.

## The MCP verbs

Reads: `listStages`, `listLeads`, `getLead {id}`, `listRules`, `getConfig`.
Leads: `addLead {name, org?, stage}`, `moveLead {id, toStage, expectedVersion}`,
`appendContext {id, research, expectedVersion}` (MERGES onto context.facts),
`draftMessage {id, msg}` (appends, never sends),
`attachTranscript {id, raw, summary}` (keeps raw + your summary).
Stages: `renameStage {id,label}`, `reorderStages {ids}`, `addStage {label,position}`,
`retireStage {id}`, `unretireStage {id}`,
`remapStage {from, to, orgFilter?, dryRun, retireSource, confirmed}` (move/merge cards between stages).

Stages have a **stable `id`** (never changes, never reused) and a mutable
`label`. Always address stages by `id`.

## Ingesting pasted research — the flow

When the human pastes research (prospect notes, a reply, a call transcript), do
this, in order:

1. **Read before acting.** Call `listLeads` / `getLead` first. Never assume
   board state.
2. **Identify** which lead(s) the research concerns — match on name / org
   against existing leads.
3. **Match or create.** Existing lead → enrich it. Genuinely new prospect →
   `addLead` (propose it; see step 7 before committing).
4. **Merge, never clobber.** Use `appendContext` — it ADDS to the lead's
   structured context; existing facts are preserved and the new fact is appended
   with its provenance. Do not overwrite. If the new research **contradicts** an
   existing fact, append it AND call it out to the human — don't pick a winner.
5. **Classify the document:**
   - prospect research / notes → `appendContext`.
   - a **call/meeting transcript** → `attachTranscript` (pass the full `raw`
     text plus a concise `summary` you generate — the summary is what the
     inspector shows; the raw is kept for the record).
   - a **reply / status note** → it may imply a stage move (step 6).
6. **Propose stage moves the research implies** (e.g. "they replied positively"
   → Contacted → Warm), but ONLY through the gate: first call the move with
   `dryRun: true` (for `remapStage`) or check the target, report the count, and
   wait. For a single card, `moveLead` needs the lead's current `expectedVersion`
   (from `getLead`) — if it comes back `conflict:…`, reload and retry.
7. **Report and wait.** Summarize the whole proposed change set in one line —
   e.g. *"This adds context to 3 leads, creates 1 new lead, and would move 1
   card from `contacted` to `warm`. Proceed?"* — and get an explicit human
   **"yes"** before committing any card change. Enrichment via `appendContext`
   is safe to do as you go; **stage moves and new leads wait for the yes.**

## Ingesting research files

The human can also drop research **files** into the board's `research/` folder
(reachable at the relative path `research/` — your cwd is the board folder).
When they ask you to *"ingest the new research"* (or similar), do this:

1. **List `research/`** (recurse into subfolders — the human may drop a whole
   folder of files, or a folder-of-folders). Ignore the `research/.ingested`
   ledger file itself.
2. **Skip already-processed entries.** `research/.ingested` is a plain-text list,
   one entry per line, of what you've already ingested — a file path OR a folder
   name (record the folder name when you ingest a batch dropped as one folder).
   Process only entries NOT listed there. If the ledger doesn't exist yet, treat
   everything as new. When you finish a folder-batch, record the folder name so
   the whole batch is skipped next time.
3. **Read each new file:**
   - `.txt`, `.md`, `.csv`, `.json` → read directly.
   - `.pdf` → extract its text with your own tools. If you can't, say so and
     skip that file (do NOT guess at its contents, and do NOT mark it ingested).
   - Anything else you can't read → skip and tell the human.
4. **Run each file's contents through the pasted-research flow above** — the
   exact same steps: identify the lead(s), match-or-create, `appendContext`
   (merge, never clobber), classify transcripts (`attachTranscript`) vs notes,
   propose any stage moves through the gate, then **report and wait for the
   human's "yes"** before committing card moves or new leads.
5. **After a file is successfully ingested, append its filename** (on its own
   line) to `research/.ingested`, so a later "ingest" won't re-process it. Only
   record files you actually ingested — never ones you skipped.

To force a re-read of a file, the human can delete its line from
`research/.ingested` (mention this if they ask why a file was skipped).

## Respecting the gates

The server returns structured, prefixed errors — act on them, don't fight them:

- `needs-confirm: this affects N cards …` — a bulk change crossed the
  blast-radius threshold. Report N to the human; only re-run with
  `confirmed: true` after they say yes.
- `rule-blocked: … rule(s) reference this stage …` — an enabled rule references
  the stage you tried to retire/merge. Tell the human; offer to remap or disable
  the rule first. Never work around it.
- `conflict: … reload` — someone/something changed the lead since you read it.
  Re-`getLead` and retry with the fresh `expectedVersion`.
- `retired-id-reuse:` / `not-found:` — the stage/lead id is wrong or retired;
  re-check with `listStages` / `listLeads`.

## Editing stages safely

Renaming a stage is just a label change (the `id` is stable — cards and rules
keep working). Retiring or merging a stage that holds cards uses `remapStage`
(cards move to a destination first; nothing is orphaned). Always `dryRun` a
`remapStage` and report the affected count before committing. A card whose stage
was retired shows up in an **"Unsorted"** column — surface that to the human
rather than leaving it hidden.

## Summary

Read first. Enrich additively. Summarize transcripts, keep the raw. Propose card
moves through dryRun. Report the change set and wait for yes. Never send a
message automatically. Never lose a lead's history. When in doubt, keep both and
ask.
