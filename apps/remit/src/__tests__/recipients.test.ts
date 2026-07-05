import { describe, it, expect } from "vitest";
import { defaultDoc, type AmountCurrency } from "../schema";
import {
  applyRecipient,
  newId,
  recipientFromDoc,
  recipientKey,
  recipientLabel,
  type SavedRecipient,
} from "../recipients";

const docWith = (currency: AmountCurrency = "USD", account = "999") => ({
  ...defaultDoc(),
  recipient: {
    name: "Acme Ltd",
    id: "LL01",
    tel: "123",
    address: "1 St",
    residency: "non-resident" as const,
    isOrganisation: true,
  },
  bank: {
    name: "CIMB",
    account,
    address: "KL",
    town: "",
    country: "",
    swift: "CIBBMYKL",
  },
  amount: { currency, value: "10" },
});

describe("remit recipients", () => {
  it("extracts the reusable slice from a doc, labeled with currency", () => {
    const r = recipientFromDoc(docWith("USD"), "r1");
    expect(r.id).toBe("r1");
    expect(r.label).toBe("Acme Ltd — USD");
    expect(r.currency).toBe("USD");
    expect(r.bank.swift).toBe("CIBBMYKL");
    expect(r.recipient.id).toBe("LL01");
  });

  it("labels an unnamed recipient", () => {
    expect(recipientLabel("", "MYR")).toBe("Untitled recipient — MYR");
  });

  it("applies a recipient onto a doc — recipient + bank + currency", () => {
    const saved = recipientFromDoc(docWith("MYR"), "r1");
    const base = {
      ...defaultDoc(),
      amount: { currency: "USD" as const, value: "500" },
      senderAccount: "USD" as const,
    };
    const next = applyRecipient(base, saved);
    expect(next.recipient.name).toBe("Acme Ltd");
    expect(next.bank.name).toBe("CIMB");
    expect(next.amount.currency).toBe("MYR"); // restored from the record
    // untouched fields survive
    expect(next.amount.value).toBe("500");
    expect(next.senderAccount).toBe("USD");
  });

  it("treats different currency/account as a different record (distinct key)", () => {
    const usd = recipientFromDoc(docWith("USD", "999"), "r1");
    const myr = recipientFromDoc(docWith("MYR", "999"), "r2");
    const usdOtherAcct = recipientFromDoc(docWith("USD", "888"), "r3");
    expect(recipientKey(usd)).not.toBe(recipientKey(myr)); // currency differs
    expect(recipientKey(usd)).not.toBe(recipientKey(usdOtherAcct)); // account differs
    // Same name + currency + account + swift => same key.
    expect(recipientKey(usd)).toBe(recipientKey(recipientFromDoc(docWith("USD", "999"), "rX")));
  });

  it("generates non-colliding ids", () => {
    const existing: SavedRecipient[] = [
      recipientFromDoc(docWith(), "r1"),
      recipientFromDoc(docWith(), "r2"),
    ];
    expect(newId(existing)).toBe("r3");
    expect(newId([])).toBe("r1");
  });
});
