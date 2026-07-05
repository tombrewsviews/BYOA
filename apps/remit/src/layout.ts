/**
 * Field coordinate map for the Maybank remittance form, page 1.
 *
 * Coordinates are in PDF points (A4 = 595 × 842), origin BOTTOM-LEFT — the
 * pdf-lib convention. `y` is the text BASELINE. Anchors were measured from the
 * blank template's own label boxes (see design spec); values are placed to the
 * right of / below their labels to match the filled examples.
 *
 * The preview renders the same points scaled to the 2× PNG (see Preview.tsx),
 * so preview and export share one source of truth.
 */

export const PAGE = { width: 595, height: 842 } as const;

export type Align = "left" | "center";

export type TextField = {
  x: number;
  /** Text baseline, PDF points from the bottom. */
  y: number;
  size: number;
  bold?: boolean;
  align?: Align;
  /** Wrap width in points; when set, text wraps into `lineHeight` rows downward. */
  maxWidth?: number;
  lineHeight?: number;
};

/** A checkbox "X" mark, centered on (x, y). */
export type Mark = { x: number; y: number; size: number };

/**
 * Text fields keyed by a logical name. RemitApp maps doc values onto these.
 * Multi-line addresses use maxWidth + lineHeight and wrap downward.
 */
export const FIELDS = {
  date: { x: 500, y: 748, size: 9 },

  // A. Sender (fixed values, but still drawn so the export is self-contained)
  senderAccount: { x: 82, y: 690, size: 9 },
  senderNameTop: { x: 399, y: 690, size: 9 },
  senderNameRep: { x: 24, y: 640, size: 9 },
  senderId: { x: 100, y: 604, size: 9 },
  senderAddress: { x: 336, y: 650, size: 9, maxWidth: 250, lineHeight: 12 },

  // B. Recipient (variable). Value baselines sit ~15pt below each label.
  recipientName: { x: 24, y: 554, size: 9 }, // label at y≈567
  recipientId: { x: 100, y: 531, size: 9 }, // on the "No. ID" label row (y≈531)
  recipientTel: { x: 58, y: 513, size: 9 }, // on the "No.Tel" label row (y≈513)
  recipientAddress: { x: 336, y: 560, size: 9, maxWidth: 250, lineHeight: 13 },
  recipientRepName: { x: 24, y: 466, size: 9 }, // rep label at y≈480

  // C. Recipient bank & transfer (variable)
  bankName: { x: 100, y: 421, size: 11, bold: true },
  bankAccount: { x: 175, y: 393, size: 11, bold: true },
  bankAddress: { x: 110, y: 374, size: 8, maxWidth: 200, lineHeight: 10 },
  bankTown: { x: 55, y: 336, size: 9 },
  bankCountry: { x: 180, y: 336, size: 9 },
  paymentDetails: { x: 336, y: 416, size: 10, maxWidth: 250, lineHeight: 12 },
  amountRM: { x: 358, y: 356, size: 11, bold: true }, // "In RM" slot
  amountForeign: { x: 448, y: 340, size: 11, bold: true }, // "In Foreign Currency" slot

  // D. Other payment (variable)
  swift: { x: 100, y: 300, size: 10 },
} satisfies Record<string, TextField>;

export type FieldName = keyof typeof FIELDS;

/**
 * Checkbox marks. Coordinates are the CENTER of each checkbox on the page.
 * Selected via the doc (residency, charge, purpose, transfer type, declaration).
 */
export const MARKS = {
  // Transfer type (top row checkboxes) — checkbox sits left of each label,
  // on the "Foreign Telegraphic Transfer (FTT)" row (y≈746).
  typeFTT: { x: 14, y: 746, size: 10 },
  typeRENTAS: { x: 160, y: 749, size: 10 },
  typeGIRO: { x: 212, y: 749, size: 10 },
  typeCHEQUE: { x: 255, y: 746, size: 10 },
  typeOTHER: { x: 341, y: 746, size: 10 },

  // Recipient residency — B section row (Resident/Non-Resident by the recipient
  // name), y≈587, boxes left of each label.
  recipientResident: { x: 180, y: 587, size: 9 },
  recipientNonResident: { x: 237, y: 587, size: 9 },
  // Recipient-representative residency row ("Isi bawah jika penerima
  // mewakili…"), y≈500, boxes far right (x≈476 / 525).
  repResident: { x: 476, y: 500, size: 9 },
  repNonResident: { x: 525, y: 500, size: 9 },

  // Charge SHA / OUR (Caj Ejen / Agent Fee row, y≈177)
  chargeSHA: { x: 90, y: 177, size: 9 },
  chargeOUR: { x: 129, y: 177, size: 9 },

  // Purpose of payment (section D right column). ALL checkboxes share the same
  // x (label left = 320 → box center ≈ 309); only Y differs per row.
  purposeGOODS: { x: 309, y: 285, size: 9 },
  purposeDERIVATIVES: { x: 309, y: 267, size: 9 },
  purposeSERVICES: { x: 309, y: 249, size: 9 },
  purposeOWN_FUNDS: { x: 309, y: 232, size: 9 },
  purposeCAPITAL: { x: 309, y: 213, size: 9 },
  purposeFOREX: { x: 309, y: 195, size: 9 },
  purposeOTHER: { x: 309, y: 178, size: 9 },

  // Declaration read (bottom, "Saya telah…"), box center ≈ (308, 34)
  declaration: { x: 308, y: 34, size: 9 },
} satisfies Record<string, Mark>;

export type MarkName = keyof typeof MARKS;

/** Signature stamp rect (bottom-left of the box), PDF points. Sits in the
 *  "Tandatangan Pengirim / Sender Signature" box, below its label (y≈105). */
export const SIGNATURE = { x: 420, y: 55, width: 160, height: 42 } as const;

/** Caption above the signature ("Signed digitally, sent by email by / Tomasz Parandyk"). */
export const SIGN_CAPTION = { x: 306, y: 78, size: 7, lineHeight: 8 } as const;
