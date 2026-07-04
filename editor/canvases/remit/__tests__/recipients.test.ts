import { describe, it, expect } from "vitest";
import { defaultDoc } from "../schema";
import {
  applyRecipient,
  newId,
  recipientFromDoc,
  type SavedRecipient,
} from "../recipients";

const docWith = () => ({
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
    account: "999",
    address: "KL",
    town: "",
    country: "",
    swift: "CIBBMYKL",
  },
});

describe("remit recipients", () => {
  it("extracts the reusable slice from a doc", () => {
    const r = recipientFromDoc(docWith(), "r1");
    expect(r.id).toBe("r1");
    expect(r.label).toBe("Acme Ltd");
    expect(r.bank.swift).toBe("CIBBMYKL");
    expect(r.recipient.id).toBe("LL01");
  });

  it("labels an unnamed recipient", () => {
    const r = recipientFromDoc(defaultDoc(), "r1");
    expect(r.label).toBe("Untitled recipient");
  });

  it("applies a recipient onto a doc, replacing recipient + bank only", () => {
    const saved = recipientFromDoc(docWith(), "r1");
    const base = { ...defaultDoc(), amount: { value: "500" }, senderAccount: "USD" as const };
    const next = applyRecipient(base, saved);
    expect(next.recipient.name).toBe("Acme Ltd");
    expect(next.bank.name).toBe("CIMB");
    // untouched fields survive
    expect(next.amount.value).toBe("500");
    expect(next.senderAccount).toBe("USD");
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
