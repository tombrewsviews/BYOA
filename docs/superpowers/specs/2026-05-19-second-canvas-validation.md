# Second-canvas validation (Markdown Slide Deck)

This doc validates §7.4 criterion #2 of the KeepDiggin spike spec:
"a hypothetical second canvas plugin is describable in one paragraph
against the contract in §3 without inventing new fields." If this
doc is internally consistent and the cross-reference table at the
bottom is filled in entirely from spec fields, the criterion is
satisfied.

## The paragraph

Markdown Slide Deck is a KeepDiggin app for building presentations.
Its canonical state file is `slides.json`, a Zod-validated array of
`{ markdown: string, theme: "light" | "dark" | "highContrast",
notes?: string }`. The preview renders one slide at a time as a
paginated Markdown surface (re-using `react-markdown` from the app
dev's deps); arrow keys advance. Verbs are `addSlide({ at?: int,
markdown: string })`, `setTheme({ index: int, theme })`,
`reorderSlide({ from: int, to: int })`, `deleteSlide({ index: int })`,
and `setNotes({ index: int, notes: string })`. Routes are `deck`
(the slide view) and `outline` (a vertical list of slide thumbnails
with re-orderable rows). The manifest's `snapshot()` returns
`{ currentSlideIndex, slideCount, theme: currentSlide.theme,
currentRoute }`. Memory keys are `defaultTheme` (a user's
preferred theme for new decks) and `lastEditedSlideIndex` (so
re-open lands the user where they left off). No native extension
needed — everything is pure TypeScript.

## Cross-reference: every paragraph fact maps to a §3 field

| Fact in paragraph | §3.1 manifest field |
|---|---|
| `slides.json` canonical filename | `state.file` |
| Zod schema for `{ markdown, theme, notes? }` | `state.schema` |
| schema migration (not exercised here) | `state.migrate` |
| empty state (e.g. `{ slides: [] }`) | `state.initial` |
| five verbs with typed args | `verbs.*` |
| `deck` and `outline` routes with descriptions | `routes.*` |
| snapshot returning `{ currentSlideIndex, ... }` | `snapshot` |
| `defaultTheme` + `lastEditedSlideIndex` keys | `memory.keys` |
| Markdown render component | `preview` (lazy import) |
| verb handlers translating to patches | `runtime` (lazy import) |
| app id, name, version, icon | `id`, `name`, `version`, `icon` |
| no native extension | (§3.5 — optional, absent) |

Every paragraph fact lands in a declared spec field. Nothing in the
paragraph requires a field the spec doesn't already have.

## Things the spec does NOT cover for this canvas

While writing this, the following came up and were resolved without
inventing new fields:

1. **Arrow-key navigation between slides** — this is preview-internal
   UI, not a contract concern. The app's preview component handles
   key events. Spec is silent (correctly).
2. **react-markdown as a dependency** — app devs bring their own
   deps. Spec is silent (correctly).
3. **Slide thumbnails in the outline route** — preview-internal.
   Spec is silent (correctly).

These omissions are evidence the contract is appropriately scoped:
it covers the agent/app interface and leaves preview-internal
decisions to the app dev.

## Conclusion

The contract in §3 holds for Markdown Slide Deck without addition
or modification. §7.4 criterion #2 is satisfied.
