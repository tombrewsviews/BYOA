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

  // B. Recipient (variable)
  recipientName: { x: 24, y: 551, size: 9 }, // row under B header
  recipientId: { x: 100, y: 517, size: 9 },
  recipientTel: { x: 58, y: 507, size: 9 },
  recipientAddress: { x: 336, y: 560, size: 9, maxWidth: 250, lineHeight: 13 },
  recipientRepName: { x: 24, y: 455, size: 8 },

  // C. Recipient bank & transfer (variable)
  bankName: { x: 100, y: 421, size: 11, bold: true },
  bankAccount: { x: 175, y: 393, size: 11, bold: true },
  bankAddress: { x: 110, y: 374, size: 9, maxWidth: 240, lineHeight: 11 },
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

  // Recipient residency (B header row, y≈500)
  recipientResident: { x: 476, y: 500, size: 10 },
  recipientNonResident: { x: 526, y: 500, size: 10 },
  // Recipient-representative residency row (y≈464 area)
  repResident: { x: 476, y: 464, size: 10 },
  repNonResident: { x: 526, y: 464, size: 10 },

  // Charge SHA / OUR (Caj Ejen / Agent Fee row, y≈177)
  chargeSHA: { x: 83, y: 177, size: 10 },
  chargeOUR: { x: 122, y: 177, size: 10 },

  // Purpose of payment (section D). Checkbox sits left of each label.
  purposeGOODS: { x: 342, y: 285, size: 10 },
  purposeDERIVATIVES: { x: 336, y: 267, size: 10 },
  purposeSERVICES: { x: 357, y: 249, size: 10 },
  purposeOWN_FUNDS: { x: 401, y: 232, size: 10 },
  purposeCAPITAL: { x: 367, y: 213, size: 10 },
  purposeFOREX: { x: 404, y: 195, size: 10 },
  purposeOTHER: { x: 374, y: 178, size: 10 },

  // Declaration read (bottom, "Saya telah…")
  declaration: { x: 306, y: 34, size: 9 },
} satisfies Record<string, Mark>;

export type MarkName = keyof typeof MARKS;

/** Signature stamp rect (bottom-left of the box), PDF points. Sits in the
 *  "Tandatangan Pengirim / Sender Signature" box, below its label (y≈105). */
export const SIGNATURE = { x: 420, y: 55, width: 160, height: 42 } as const;

/** Caption above the signature ("Signed digitally, sent by email by / Tomasz Parandyk"). */
export const SIGN_CAPTION = { x: 306, y: 78, size: 7, lineHeight: 8 } as const;
