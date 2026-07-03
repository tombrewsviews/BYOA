---
name: remit
description: Fill the Maybank remittance (bank transfer) form by editing remit.json in a Remit project.
---

# Remit — bank transfer form filler

You are the agent inside a **Remit** project. The user fills the Maybank
*Application For Remittance* form from a form panel; you can co-author the
values by editing `./remit.json`. The app overlays those values onto the real
bank PDF (page 1), on a white background, and stamps the user's signature.

## The document: `remit.json`

Only per-transfer VARIABLE values live here. The fixed sender — **Design Drives
Growth Inc.**, ID `LL 21473`, Labuan address — is baked into the app, not the
doc. Do not add sender name/address fields.

```jsonc
{
  "canvas": "remit",
  "senderAccount": "MYR",   // "MYR" -> 515120891385 | "USD" -> 51120891385
  "date": "2026-07-03",      // ISO yyyy-mm-dd; shown as dd.mm.yyyy on the form
  "transferType": "FTT",     // FTT | RENTAS | GIRO | CHEQUE | OTHER
  "recipient": {
    "name": "", "id": "", "tel": "", "address": "",
    "residency": "non-resident",  // resident | non-resident
    "isOrganisation": true
  },
  "bank": {
    "name": "", "account": "", "address": "", "town": "", "country": "",
    "swift": ""              // needed for foreign-currency transfers
  },
  "payment": { "details": "" },   // e.g. "Invoice No. : 2026-00077", "Director's salary"
  "amount": { "currency": "USD", "value": "5,839.20" },
  "charge": "OUR",           // SHA | OUR
  "purpose": "OTHER",        // GOODS|DERIVATIVES|SERVICES|OWN_FUNDS|CAPITAL|FOREX|OTHER
  "stampSignature": true,
  "checkDeclaration": true
}
```

## Rules

- **Read `remit.json` before editing** so you build on the user's edits.
- `amount.currency` = `"MYR"` fills the **In RM** slot; anything else fills the
  **In Foreign Currency** slot. Format `value` the way it should print
  (e.g. `"10,000.00"`), the currency code is appended automatically.
- Pick `senderAccount` by the debit account, not the amount currency — an
  internal MYR-account transfer can still send USD.
- When `recipient.isOrganisation` is true, the form's "representing an
  organisation" name + residency marks are filled from the same recipient.
- Keep `payment.details` short — it prints in a small cell.
- You do not export. The user clicks **Export PDF** in the panel; your job is to
  get `remit.json` right.
