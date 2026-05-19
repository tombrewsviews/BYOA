---
name: kinetic-studio
description: Use whenever you are running inside the Kinetic Studio desktop editor (KINETIC_STUDIO=1, or CWD contains a story.json next to a .kinetic-studio/ folder). Edits a single story.json in the project root; the studio watches it and refreshes preview + timeline automatically. Do NOT write standalone Remotion .tsx files — they will not show up in the preview.
---

# Kinetic Studio — agent operating manual

You are running inside the Kinetic Studio desktop app. The user
launched you from the studio's embedded terminal so you can change
**the one** `story.json` in this directory. The studio's Player and
Timeline read from `story.json` and refresh automatically within
~300 ms of every save — you do not need to tell the user to refresh.

This is the **routing skill**. It contains the hard rules every turn
must obey. For domain knowledge, load whichever of these sibling
files matches what the user asked for:

- [`typography-system.md`](./typography-system.md) — fonts, axes,
  per-letter palettes, font-family choice.
- [`motion-design.md`](./motion-design.md) — easings, enter/exit
  kinds, dynamics, stagger, beat kinds (reveal/morph/cinema/etc).
- [`color-system.md`](./color-system.md) — palette fields, gradients,
  glow, shadows, accent harmonies.
- [`render-pipeline.md`](./render-pipeline.md) — what the studio
  renders, what you control, what you do NOT touch.
- [`layer-composition.md`](./layer-composition.md) — beats array,
  tracks, timing, illustration→text pattern, video/image clips.

You do not have to read all five. Pick the one the user's request
maps to. If they ask "make the colors more contrasty", read
`color-system.md`. If they ask "add a word that bounces in", read
`motion-design.md`. If they ask "compose a 15-second piece about
launching a product", read `layer-composition.md` (and probably
`motion-design.md`).

## Hard rules (every turn)

- **Read `./.kinetic-studio/prompt-mode` AND
  `./.kinetic-studio/selection` FIRST on every turn.** Both are single-
  line files. `prompt-mode` is one of `replace | append | insert`
  (default `append` if missing). `selection` is either the literal
  `none` or an integer line — the index of the currently-selected beat
  in `story.beats` (default `none` if missing or unparseable).
  Combine them to decide what to do:

    - `append` (DEFAULT) — preserve every existing beat, add new beats
      at the end of the array. Ignore selection.

    - `replace`:
        • selection is `none` → wipe `story.beats` entirely, write the
          new sequence from scratch. Preserve story-level fields
          (palette, background, fontFamily) unless the user explicitly
          asks to change them.
        • selection is an integer `i` → delete beats[i] only, splice
          your new beat(s) into the array at position `i`. Preserve
          the deleted beat's `startSeconds` and `track` on your first
          new beat so it lands in the same time slot. Don't touch any
          other beats.

    - `insert`:
        • selection is `none` → identical to append (insert at end).
        • selection is an integer `i` → insert your new beat(s)
          immediately AFTER beats[i] on the SAME track. Your first new
          beat's `startSeconds` = `beats[i].startSeconds + beats[i].
          durationInSeconds`. For every existing beat j > i on the
          SAME track (`beats[j].track === beats[i].track`), bump
          `beats[j].startSeconds` forward by the total duration of
          your new beats so nothing overlaps. Beats on OTHER tracks
          stay put.

  Never replace the whole story unless `prompt-mode` says `replace`
  with `selection` = `none`, or the user is explicit.
- **The story file is `./story.json` in the CWD. Edit it directly
  with the Write tool.** Read it first if you need to preserve
  fields you're not changing.
- **NEVER create sibling `.tsx`, `.jsx`, or new Remotion component
  files.** The studio composition is fixed and reads `story.json`.
  Creating new files is a no-op — the user will not see them in the
  preview. If you find yourself about to write `MyAnimation.tsx`,
  stop and write `story.json` instead.
- **Do not invoke `remotion-best-practices`, `superpowers:*`, or
  general Remotion skills.** This skill replaces them for kinetic-
  typography work. The studio's composition handles all timing,
  rendering, fonts and Remotion lifecycle for you.
- **Do not ask the user to clarify** unless the request is genuinely
  ambiguous against the schema. "Make the background yellow" means
  edit `bgColor` and probably `bgColor2`. "Animate the words X Y Z"
  means write three beats. Just do it.
- **Finish with a one-line summary** of what changed. No long
  explanations.

## How edits reach the UI

The studio watches `story.json`. The instant you write it:
1. The watcher fires `doc://changed`.
2. The editor re-reads the file and re-parses it through Zod.
3. The Player remounts with the new inputProps and the Timeline
   shows the new beats.

So your only job is: write `story.json`. Don't tell the user to
press refresh, don't start a render, don't suggest CLI commands
unless they explicitly ask.

## Conflict prompts

If the user pastes:

```
Apply my changes on top of yours:
  - story.bgColor: "#2a1a05" → "#ffaa00"
  - beats[2].dynamics: 0.5 → 0.85
```

...they edited the same fields you did while you were working.
Apply their listed values on top of the current `story.json`.
Their values win.

## Things that AREN'T your job

- Running `npm run …` or `remotion render` — the studio does that.
- Telling the user to `cd` somewhere — you're already in the right CWD.
- Asking permission to edit `story.json` — that's literally the only
  file you should be editing here.
- Writing tests, docs, or new components.
