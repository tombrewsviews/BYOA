/**
 * Fill the white Maybank template with the doc's values and produce a
 * single-page PDF (Uint8Array). Pure pdf-lib; used by both the export button
 * and (indirectly) shares its coordinate map with the live preview.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  FIELDS,
  MARKS,
  SIGNATURE,
  SIGN_CAPTION,
  type FieldName,
  type MarkName,
  type TextField,
} from "./layout";
import {
  SENDER,
  formatAmount,
  formatDate,
  isForeignAmount,
  senderAccountNumber,
  type RemitDoc,
} from "./schema";

const INK = rgb(0.05, 0.05, 0.05);

/** Which text field each doc value maps to. Empty strings are skipped. */
const textValues = (doc: RemitDoc): Partial<Record<FieldName, string>> => {
  const foreign = isForeignAmount(doc);
  const amount = formatAmount(doc);
  return {
    date: formatDate(doc.date),
    senderAccount: senderAccountNumber(doc),
    senderNameTop: SENDER.name,
    senderNameRep: SENDER.name,
    senderId: SENDER.idNo,
    senderAddress: SENDER.address.join("\n"),
    recipientName: doc.recipient.name,
    recipientId: doc.recipient.id,
    recipientTel: doc.recipient.tel,
    recipientAddress: doc.recipient.address,
    recipientRepName: doc.recipient.isOrganisation ? doc.recipient.name : "",
    bankName: doc.bank.name,
    bankAccount: doc.bank.account,
    bankAddress: doc.bank.address,
    bankTown: doc.bank.town,
    bankCountry: doc.bank.country,
    paymentDetails: doc.payment.details,
    amountRM: foreign ? "" : amount,
    amountForeign: foreign ? amount : "",
    swift: doc.bank.swift,
  };
};

/** Which checkbox marks are on for this doc. */
const activeMarks = (doc: RemitDoc): MarkName[] => {
  const marks: MarkName[] = [];
  marks.push(("type" + doc.transferType) as MarkName);
  marks.push(
    doc.recipient.residency === "resident"
      ? "recipientResident"
      : "recipientNonResident",
  );
  if (doc.recipient.isOrganisation) {
    marks.push(
      doc.recipient.residency === "resident" ? "repResident" : "repNonResident",
    );
  }
  marks.push(doc.charge === "SHA" ? "chargeSHA" : "chargeOUR");
  marks.push(("purpose" + doc.purpose) as MarkName);
  if (doc.checkDeclaration) marks.push("declaration");
  return marks;
};

/** Break `text` into lines that fit `maxWidth` at `size`, honoring existing \n. */
const wrapLines = (
  text: string,
  font: PDFFont,
  size: number,
  maxWidth?: number,
): string[] => {
  const paras = text.split("\n");
  if (!maxWidth) return paras;
  const out: string[] = [];
  for (const para of paras) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const trial = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) > maxWidth && line) {
        out.push(line);
        line = w;
      } else {
        line = trial;
      }
    }
    out.push(line);
  }
  return out;
};

const drawTextField = (
  page: PDFPage,
  spec: TextField,
  value: string,
  font: PDFFont,
  bold: PDFFont,
): void => {
  if (!value) return;
  const f = spec.bold ? bold : font;
  const lines = wrapLines(value, f, spec.size, spec.maxWidth);
  const lh = spec.lineHeight ?? spec.size * 1.2;
  lines.forEach((line, i) => {
    let x = spec.x;
    if (spec.align === "center") {
      x = spec.x - f.widthOfTextAtSize(line, spec.size) / 2;
    }
    page.drawText(line, { x, y: spec.y - i * lh, size: spec.size, font: f, color: INK });
  });
};

/**
 * Build the filled PDF bytes.
 * @param templateBytes the bundled white template PDF (page 1).
 * @param signatureBytes the signature PNG (used when doc.stampSignature).
 */
export const buildFilledPdf = async (
  doc: RemitDoc,
  templateBytes: Uint8Array | ArrayBuffer,
  signatureBytes: Uint8Array | ArrayBuffer | null,
): Promise<Uint8Array> => {
  const pdf = await PDFDocument.load(templateBytes);
  // Keep only page 1.
  while (pdf.getPageCount() > 1) pdf.removePage(1);
  const page = pdf.getPage(0);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const values = textValues(doc);
  (Object.keys(values) as FieldName[]).forEach((name) => {
    drawTextField(page, FIELDS[name], values[name] ?? "", font, bold);
  });

  for (const name of activeMarks(doc)) {
    const m = MARKS[name];
    const w = bold.widthOfTextAtSize("X", m.size);
    page.drawText("X", {
      x: m.x - w / 2,
      y: m.y - m.size / 2,
      size: m.size,
      font: bold,
      color: INK,
    });
  }

  if (doc.stampSignature) {
    // Caption above the signature.
    SENDER.signedByCaption.forEach((line, i) => {
      page.drawText(line, {
        x: SIGN_CAPTION.x,
        y: SIGN_CAPTION.y - i * SIGN_CAPTION.lineHeight,
        size: SIGN_CAPTION.size,
        font,
        color: INK,
      });
    });
    if (signatureBytes) {
      const png = await pdf.embedPng(signatureBytes);
      const scale = Math.min(
        SIGNATURE.width / png.width,
        SIGNATURE.height / png.height,
      );
      page.drawImage(png, {
        x: SIGNATURE.x,
        y: SIGNATURE.y,
        width: png.width * scale,
        height: png.height * scale,
      });
    }
  }

  return pdf.save();
};
