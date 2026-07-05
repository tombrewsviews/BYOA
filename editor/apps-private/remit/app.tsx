/**
 * Remit — private app self-registration.
 *
 * This is the overlay entry point the shell's `import.meta.glob` collects
 * (`editor/platform/apps.ts`). It bundles Remit's catalog manifest with
 * its Root component. The canvas plugin is registered separately, via the
 * canvas glob in `editor/canvas.ts` (see `./index.tsx`).
 *
 * Because this whole directory is git-ignored, a shared/distributed clone
 * has no `apps-private/remit/` — the glob finds nothing and Remit is
 * absent from the catalog with no dangling references.
 */
import type { PrivateApp } from "../../platform/apps";

const remit: PrivateApp = {
  manifest: {
    id: "remit",
    name: "Remit",
    blurb: "Auto-fill bank transfer forms",
    description:
      "Fill the Maybank remittance form from a small form panel instead of editing a PDF field by field. Your fixed sender details are baked in; enter the recipient, bank, and amount, and export a page-1 PDF that matches the bank's form, on white, with your signature stamped in.",
    creator: "altramanera",
    version: "0.1.0",
    tokens: 0,
    files: 8,
    loc: 1_100,
    rating: 0,
    ratingCount: 0,
    tags: ["forms", "pdf", "banking"],
    hue: 210,
    status: "available",
    launchable: true,
    releasedAt: "2026-07-03",
    sizeBytes: 1_500_000,
    category: "private",
    visibility: "private",
  },
};

export default remit;
