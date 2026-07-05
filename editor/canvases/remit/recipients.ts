/**
 * Saved-recipients store. A "recipient" is the reusable slice of a transfer —
 * the recipient block plus their bank details — so picking one fills all those
 * fields at once instead of retyping them.
 *
 * Persisted user-wide via the `remit_recipients_load/save` Tauri commands
 * (~/.kinetic-studio/remit-recipients.json). The backend treats the array as
 * opaque JSON; the shape below is owned here.
 */
import { isTauri } from "../../runtime";
import type { AmountCurrency, RemitDoc } from "./schema";

export type SavedRecipient = {
  /** Stable id (also the dropdown key). */
  id: string;
  /** Display label, e.g. "Acme Ltd — USD". */
  label: string;
  recipient: RemitDoc["recipient"];
  bank: RemitDoc["bank"];
  /** Currency this record was saved for — restored on pick and shown in label. */
  currency: AmountCurrency;
};

/** Human label for a saved record: recipient name + the currency it's for. */
export const recipientLabel = (
  name: string,
  currency: AmountCurrency,
): string => `${name.trim() || "Untitled recipient"} — ${currency}`;

/**
 * Identity of a saved record. The SAME recipient paid in a different
 * currency or through a different bank account is a DIFFERENT record, so the
 * key includes currency + account + swift (not just the name).
 */
export const recipientKey = (r: SavedRecipient): string =>
  [
    r.recipient.name.trim().toLowerCase(),
    r.currency,
    r.bank.account.trim(),
    r.bank.swift.trim().toLowerCase(),
  ].join("|");

/** Extract the reusable slice from a doc into a saveable recipient. */
export const recipientFromDoc = (doc: RemitDoc, id: string): SavedRecipient => ({
  id,
  label: recipientLabel(doc.recipient.name, doc.amount.currency),
  recipient: { ...doc.recipient },
  bank: { ...doc.bank },
  currency: doc.amount.currency,
});

/** Apply a saved recipient onto a doc (recipient + bank + currency). */
export const applyRecipient = (doc: RemitDoc, r: SavedRecipient): RemitDoc => ({
  ...doc,
  recipient: { ...r.recipient },
  bank: { ...r.bank },
  amount: { ...doc.amount, currency: r.currency },
});

/** A stable-ish id without Date.now/Math.random reliance concerns in tests. */
export const newId = (existing: SavedRecipient[]): string => {
  let n = existing.length + 1;
  let id = `r${n}`;
  const taken = new Set(existing.map((x) => x.id));
  while (taken.has(id)) {
    n += 1;
    id = `r${n}`;
  }
  return id;
};

const parse = (raw: string): SavedRecipient[] => {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (x): x is SavedRecipient =>
          !!x && typeof x.id === "string" && !!x.recipient && !!x.bank,
      )
      .map((x) => {
        // Tolerate legacy records saved before `currency` existed.
        const currency: AmountCurrency = x.currency === "MYR" ? "MYR" : "USD";
        return {
          ...x,
          currency,
          label: x.label ?? recipientLabel(x.recipient.name, currency),
        };
      });
  } catch {
    return [];
  }
};

export const loadRecipients = async (): Promise<SavedRecipient[]> => {
  if (!isTauri()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<string>("remit_recipients_load").catch(() => "[]");
  return parse(raw);
};

export const saveRecipients = async (list: SavedRecipient[]): Promise<void> => {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("remit_recipients_save", { json: JSON.stringify(list, null, 2) });
};
