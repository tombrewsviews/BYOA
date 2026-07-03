# Remit — Bank Transfer Form Filler (design spec)

**Date:** 2026-07-03
**Branch:** `feat/remit-transfer-form`
**Status:** approved-in-principle; user directed "just implement the plan" (no further questions).

## Problem

Filling the Maybank *Permohonan Untuk Kiriman Wang / Application For Remittance*
form by hand in a PDF editor, field by field, for every outgoing transfer, is
slow and error-prone. The sender block (Design Drives Growth Inc.) is fixed;
only the recipient, recipient bank, amount, payment details, date, and the
sender's own account number change per transfer.

## Goal

A new KineticType canvas app ("Remit") where you enter the per-transfer values
in a form panel and get a filled, export-ready PDF of **page 1** that matches
the bank's real form, on a **white** background, with the signature stamped in.

## Non-goals

- Pages 2–4 of the form (guide/declaration back pages). Only page 1.
- OCR / parsing existing filled PDFs. Values are typed, not imported.
- True AcroForm field editing. We overlay a text layer and flatten.

## Canonical inputs (verified on disk)

- **Blank template:** `/Users/parandykt/Invoices/Lebuan/2026/Bank/New Remittance Form01062025.pdf`
  — pristine (no baked values, `formtype: 0`), page size 595×842 pt (A4),
  page background is a solid yellow `RGB(255,246,161)`.
- **Signature:** `/Users/parandykt/Invoices/Lebuan/Signature.jpg` (726×190, blue script).
- **Filled examples** (drive the coordinate map + which fields vary):
  - `Transfer 4Feb2026 MYR-USD.pdf` — USD amount, internal transfer, MYR sender acct.
  - `Transfer 4Feb2026 DDG - CST.pdf` — USD amount, CIMB recipient, SWIFT, OUR.
  - `Transfer 18Mar2026 DDG - TP.pdf` — MYR amount, individual recipient.

Both the blank template and the filled examples render **identically** except
for the filled values, so coordinate overlays land correctly.

## Architecture

Follows the existing canvas-plugin pattern (`data`/Lens is the closest analog:
a real parsed doc + form/inspector panel + preview + export).

```
Blank template PDF (bundled, recolored white)
      │  rendered to a page-1 background image (build-time asset)
      ▼
Form panel (left)  ──edits──►  remit.json (per-project doc)
      │                              │
      ▼                              ▼
Live preview (center): white page image + absolutely-positioned
      HTML text layer at mapped coordinates + signature image
      │
      ▼
Export: pdf-lib opens the white template PDF, draws each field's text
      at its mapped point on page 1, embeds the signature JPG, keeps
      only page 1, writes filled PDF to the project folder.
```

### Why overlay-on-real-PDF (not HTML recreation)

The exact bank PDF exists; a bank submission needs pixel fidelity; recreating
the dense bilingual Maybank form in HTML would drift. Overlay guarantees a
match. `pdf-lib` is pure JS (no new Rust dep, no headless Chromium).

### Why a white background, and how

The yellow is baked into the page. We produce a **white version of the template
once, at build time**, and bundle it as the app's background asset. Recoloring
recipe (validated): for pixels where `R>180 && G>170 && B < G-30` (the yellow
page fill), set `B = min(R,G)` — lifts pale yellow to white while leaving black
text, grey section headers, blue/black logo, and checkbox outlines untouched.
Produces both:
- `remit-template-white.pdf` (page 1 only) — export background for pdf-lib.
- `remit-template-white.png` (2× page 1) — preview background image.

## Components / files

Frontend (`editor/canvases/remit/`):
- `RemitApp.tsx` — app Root: sessions list + editor (mirrors `DataApp.tsx`).
- `FormPanel.tsx` — grouped inputs (Sender / Recipient / Bank / Amount / Options).
- `Preview.tsx` — white page image + text-layer overlay + signature.
- `layout.ts` — the field coordinate map (x/y in PDF points, font size, align).
- `schema.ts` — `RemitDoc` type + parse/defaults.
- `export.ts` — pdf-lib fill + flatten + save.
- `index.tsx` — `CanvasPlugin` registration (like brainstorm/data index.tsx).
- `__tests__/schema.test.ts`, `__tests__/export.test.ts`.

Assets (`editor/canvases/remit/assets/` or `public/`):
- `remit-template-white.pdf`, `remit-template-white.png`, `signature.png`.

Backend (Rust):
- `src-tauri/src/canvas.rs` — add `RemitCanvas` (doc `remit.json`, seed bytes),
  register in `by_id` and `for_project`.
- `src-tauri/src/canvases/remit.rs` — skill bundle + CLAUDE.md.
- `src-tauri/src/canvases/mod.rs` — `pub mod remit;`.
- `src-tauri/templates/seed-remit.json` — seed doc.
- `src-tauri/skills/remit/SKILL.md` — agent routing skill.

Platform:
- `editor/platform/apps.ts` — add the `remit` manifest (Root = RemitApp).

## Data model — `remit.json`

```jsonc
{
  "canvas": "remit",
  "senderAccount": "MYR",            // "MYR" -> 515120891385, "USD" -> 51120891385
  "date": "2026-07-03",
  "transferType": "FTT",             // FTT | RENTAS | GIRO | CHEQUE | OTHER
  "recipient": {
    "name": "", "id": "", "tel": "", "address": "",
    "residency": "non-resident",     // resident | non-resident
    "isOrganisation": true
  },
  "bank": {
    "name": "", "account": "", "address": "", "town": "", "country": "",
    "swift": ""                      // shown/used for foreign-currency transfers
  },
  "payment": { "details": "" },
  "amount": { "currency": "USD", "value": "" }, // currency: MYR -> "In RM", else "In Foreign Currency"
  "charge": "OUR",                   // SHA | OUR
  "purpose": "OTHER",                // maps to the section-D checkbox
  "stampSignature": true,
  "checkDeclaration": true
}
```

Fixed sender block (Design Drives Growth Inc., LL 21473, Labuan address) lives
as a constant in `schema.ts`, not in the doc — it never changes.

**Account numbers (confirmed by user):** MYR `515120891385`, USD `51120891385`.

## Field coordinate map (`layout.ts`)

Each variable field → `{ x, y, size, maxWidth?, align?, lines? }` in PDF points
(origin bottom-left, A4 595×842). Derived from the rendered template and the
filled examples. Multi-line fields (addresses) wrap across mapped line slots.
Checkbox marks (residency, charge SHA/OUR, purpose, declaration, transfer type)
are drawn as an "X" glyph at mapped points. Coordinates are the fiddly part and
will be nudged against the real examples during implementation (calibration
pass), comparing overlay output to the filled PDFs.

## Export flow

1. Load bundled `remit-template-white.pdf`, take page 1.
2. Embed Helvetica (+ bold where the examples are bold, e.g. amount, bank name).
3. For each field in the doc, look up `layout.ts` and `drawText` at the point;
   draw "X" marks for the checkbox fields.
4. If `stampSignature`, embed `signature.png` in the "Tandatangan Pengirim /
   Sender Signature" box at its mapped rect.
5. Save single-page filled PDF to the project folder (Tauri fs), filename
   derived from recipient + date (e.g. `Transfer 2026-07-03 DDG - <recipient>.pdf`).

Preview uses the same `layout.ts` points scaled to the PNG, so what you see is
what exports.

## Testing

- `schema.test.ts` — parse/defaults, sender-account → number mapping,
  currency → RM-vs-foreign slotting.
- `export.test.ts` — given a doc, pdf-lib produces a 1-page PDF whose extracted
  text contains the expected values at expected fields (smoke-level).
- Manual calibration check: overlay vs the three filled example PDFs.

## Open items resolved by default (no user questions per directive)

- Signature: **auto-stamped** (toggle `stampSignature`, default on).
- Declaration checkbox (bottom-right X): **auto-checked** (default on).
- "Signed digitally, sent by email by Tomasz Parandyk" caption: included above
  the signature, matching the MYR-USD example.
