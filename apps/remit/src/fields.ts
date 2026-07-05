/**
 * Single source of truth for mapping a RemitDoc onto the form's text fields and
 * checkbox marks. BOTH the live preview (Preview.tsx) and the PDF exporter
 * (export.ts) consume these, so they can never drift apart.
 */
import type { FieldName, MarkName } from "./layout";
import {
  SENDER,
  formatAmount,
  formatDate,
  isForeignAmount,
  senderAccountNumber,
  type RemitDoc,
} from "./schema";

/** Which text field each doc value maps to. Empty strings are skipped downstream. */
export const textValues = (doc: RemitDoc): Partial<Record<FieldName, string>> => {
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
export const activeMarks = (doc: RemitDoc): MarkName[] => {
  const marks: MarkName[] = [("type" + doc.transferType) as MarkName];
  marks.push(
    doc.recipient.residency === "resident"
      ? "recipientResident"
      : "recipientNonResident",
  );
  marks.push(doc.charge === "SHA" ? "chargeSHA" : "chargeOUR");
  marks.push(("purpose" + doc.purpose) as MarkName);
  if (doc.checkDeclaration) marks.push("declaration");
  return marks;
};
