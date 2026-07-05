/**
 * Remit document schema.
 *
 * `remit.json` holds only the per-transfer VARIABLE values plus a few choices
 * (which sender account, which amount currency). The fixed sender block —
 * Design Drives Growth Inc. and its Labuan details — never changes, so it
 * lives here as a constant rather than in the doc.
 *
 * See docs/superpowers/specs/2026-07-03-remit-transfer-form-design.md.
 */

export type Residency = "resident" | "non-resident";
export type TransferType = "FTT" | "RENTAS" | "GIRO" | "CHEQUE" | "OTHER";
export type Charge = "SHA" | "OUR";
/** Section-D "Purpose of Payment (select one)" checkbox. */
export type Purpose =
  | "GOODS"
  | "DERIVATIVES"
  | "SERVICES"
  | "OWN_FUNDS"
  | "CAPITAL"
  | "FOREX"
  | "OTHER";
/** Which sender account funds the transfer — sets the "From Bank Account No." */
export type SenderAccount = "MYR" | "USD";
/**
 * The currency the amount is paid IN — independent of the sender account.
 * "MYR" fills the "Dalam RM / In RM" slot; anything else fills the
 * "In Foreign Currency" slot.
 */
export type AmountCurrency = "MYR" | "USD";

export type RemitDoc = {
  canvas: "remit";
  senderAccount: SenderAccount;
  /** ISO yyyy-mm-dd; rendered as dd.mm.yyyy on the form. */
  date: string;
  transferType: TransferType;
  recipient: {
    name: string;
    id: string;
    tel: string;
    address: string;
    residency: Residency;
    isOrganisation: boolean;
  };
  bank: {
    name: string;
    account: string;
    address: string;
    town: string;
    country: string;
    swift: string;
  };
  payment: { details: string };
  /** Amount value + the currency it's paid in (independent of senderAccount). */
  amount: { currency: AmountCurrency; value: string };
  charge: Charge;
  purpose: Purpose;
  stampSignature: boolean;
  checkDeclaration: boolean;
};

/** The fixed sender — Design Drives Growth Inc. Never edited via the form. */
export const SENDER = {
  name: "Design Drives Growth Inc.",
  idNo: "LL 21473",
  address: [
    "Unit B, Lot 49, 1st Floor",
    "Block F, Lazenda Warehouse 3",
    "Jalan Ranca-Ranca",
    "87000 F.T. Labuan,Malaysia",
  ],
  signedByCaption: ["Signed digitally, sent by email by", "Tomasz Parandyk"],
} as const;

/** The two real sender bank accounts (confirmed by the user). */
export const SENDER_ACCOUNTS: Record<SenderAccount, string> = {
  MYR: "515120891385",
  USD: "51120891385",
};

/** Resolve the "From Bank Account No." digits for the chosen sender account. */
export const senderAccountNumber = (doc: RemitDoc): string =>
  SENDER_ACCOUNTS[doc.senderAccount];

/** Format an ISO date (yyyy-mm-dd) as the form's dd.mm.yyyy. Empty on bad input. */
export const formatDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
};

/** The amount string as it appears on the form, e.g. "10,000.00 USD". The
 *  currency code is the amount currency (what you pay in). */
export const formatAmount = (doc: RemitDoc): string => {
  const v = doc.amount.value.trim();
  if (!v) return "";
  return `${v} ${doc.amount.currency}`;
};

/** True when the amount goes in the "In Foreign Currency" slot — i.e. paid in a
 *  non-MYR currency. MYR goes in the "In RM" slot. */
export const isForeignAmount = (doc: RemitDoc): boolean =>
  doc.amount.currency !== "MYR";

export const defaultDoc = (): RemitDoc => ({
  canvas: "remit",
  senderAccount: "MYR",
  date: "",
  transferType: "FTT",
  recipient: {
    name: "",
    id: "",
    tel: "",
    address: "",
    residency: "non-resident",
    isOrganisation: true,
  },
  bank: { name: "", account: "", address: "", town: "", country: "", swift: "" },
  payment: { details: "" },
  amount: { currency: "USD", value: "" },
  charge: "OUR",
  purpose: "OTHER",
  stampSignature: true,
  checkDeclaration: true,
});

/**
 * Parse remit.json, tolerating partial/legacy docs by merging over defaults.
 * Never throws on missing fields — the form should always have something to edit.
 */
export const parseDoc = (raw: string): RemitDoc => {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return defaultDoc();
  }
  const d = defaultDoc();
  const o = (obj ?? {}) as Record<string, unknown>;
  const r = (o.recipient ?? {}) as Record<string, unknown>;
  const b = (o.bank ?? {}) as Record<string, unknown>;
  const p = (o.payment ?? {}) as Record<string, unknown>;
  const a = (o.amount ?? {}) as Record<string, unknown>;
  const str = (v: unknown, fallback: string): string =>
    typeof v === "string" ? v : fallback;
  const bool = (v: unknown, fallback: boolean): boolean =>
    typeof v === "boolean" ? v : fallback;
  return {
    canvas: "remit",
    senderAccount: o.senderAccount === "USD" ? "USD" : "MYR",
    date: str(o.date, d.date),
    transferType: (["FTT", "RENTAS", "GIRO", "CHEQUE", "OTHER"] as const).includes(
      o.transferType as TransferType,
    )
      ? (o.transferType as TransferType)
      : d.transferType,
    recipient: {
      name: str(r.name, d.recipient.name),
      id: str(r.id, d.recipient.id),
      tel: str(r.tel, d.recipient.tel),
      address: str(r.address, d.recipient.address),
      residency: r.residency === "resident" ? "resident" : "non-resident",
      isOrganisation: bool(r.isOrganisation, d.recipient.isOrganisation),
    },
    bank: {
      name: str(b.name, d.bank.name),
      account: str(b.account, d.bank.account),
      address: str(b.address, d.bank.address),
      town: str(b.town, d.bank.town),
      country: str(b.country, d.bank.country),
      swift: str(b.swift, d.bank.swift),
    },
    payment: { details: str(p.details, d.payment.details) },
    amount: {
      currency: a.currency === "MYR" ? "MYR" : "USD",
      value: str(a.value, d.amount.value),
    },
    charge: o.charge === "SHA" ? "SHA" : "OUR",
    purpose: (
      ["GOODS", "DERIVATIVES", "SERVICES", "OWN_FUNDS", "CAPITAL", "FOREX", "OTHER"] as const
    ).includes(o.purpose as Purpose)
      ? (o.purpose as Purpose)
      : d.purpose,
    stampSignature: bool(o.stampSignature, d.stampSignature),
    checkDeclaration: bool(o.checkDeclaration, d.checkDeclaration),
  };
};

/** Suggested export filename, e.g. "Transfer 2026-07-03 DDG - Acme Ltd.pdf". */
export const exportFilename = (doc: RemitDoc): string => {
  const who = (doc.recipient.name || "recipient").replace(/[\\/:*?"<>|]/g, "").trim();
  const date = doc.date || "undated";
  return `Transfer ${date} DDG - ${who}.pdf`;
};
