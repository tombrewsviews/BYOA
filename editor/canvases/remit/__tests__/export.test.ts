import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { buildFilledPdf } from "../export";
import { defaultDoc, type RemitDoc } from "../schema";

// Relative to the repo root (vitest's cwd), not import.meta.url — which vitest
// rewrites to a non-file scheme.
const assetsDir = path.resolve("editor/canvases/remit/assets") + "/";

// The app hands buildFilledPdf bytes from fetch().arrayBuffer(). Under vitest's
// sandbox, cross-realm ArrayBuffer/Buffer fails pdf-lib's instanceof checks, so
// copy into a Uint8Array constructed with this file's own realm global.
const readBytes = async (p: string): Promise<Uint8Array> => {
  const buf = await readFile(p);
  return Uint8Array.from(buf);
};

const sampleDoc = (): RemitDoc => ({
  ...defaultDoc(),
  senderAccount: "USD", // USD account → amount lands in the foreign-currency slot
  date: "2026-02-04",
  transferType: "FTT",
  recipient: {
    name: "Corporate Services Trust Co Ltd",
    id: "LL07796",
    tel: "6(087) 419 100",
    address: "Unit B, Lot 49, 1st Floor, Labuan, Malaysia.",
    residency: "non-resident",
    isOrganisation: true,
  },
  bank: {
    name: "CIMB Bank Berhad",
    account: "8009 0171 5840",
    address: "Menara CIMB, KL Sentral, Kuala Lumpur, Malaysia",
    town: "",
    country: "",
    swift: "CIBBMYKL",
  },
  payment: { details: "Invoice No. : 2026-00077" },
  amount: { currency: "USD", value: "5,839.20" },
  charge: "OUR",
  purpose: "OTHER",
  stampSignature: true,
  checkDeclaration: true,
});

describe("buildFilledPdf", () => {
  it("produces a single-page PDF from the template", async () => {
    const tpl = await readBytes(assetsDir + "remit-template-white.pdf");
    const sig = await readBytes(assetsDir + "signature.png");
    const bytes = await buildFilledPdf(sampleDoc(), tpl, sig);
    expect(bytes.byteLength).toBeGreaterThan(1000);

    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1);
    const { width, height } = out.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
  });

  it("works without a signature when stampSignature is off", async () => {
    const tpl = await readBytes(assetsDir + "remit-template-white.pdf");
    const doc = { ...sampleDoc(), stampSignature: false };
    const bytes = await buildFilledPdf(doc, tpl, null);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1);
  });
});
