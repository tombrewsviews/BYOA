import { describe, it, expect } from "vitest";
import {
  defaultDoc,
  exportFilename,
  formatAmount,
  formatDate,
  isForeignAmount,
  parseDoc,
  senderAccountNumber,
  SENDER_ACCOUNTS,
} from "../schema";

describe("remit schema", () => {
  it("maps sender account choice to the right number", () => {
    expect(senderAccountNumber({ ...defaultDoc(), senderAccount: "MYR" })).toBe(
      SENDER_ACCOUNTS.MYR,
    );
    expect(senderAccountNumber({ ...defaultDoc(), senderAccount: "USD" })).toBe(
      SENDER_ACCOUNTS.USD,
    );
  });

  it("formats ISO date as dd.mm.yyyy, empty on bad input", () => {
    expect(formatDate("2026-02-04")).toBe("04.02.2026");
    expect(formatDate("")).toBe("");
    expect(formatDate("nonsense")).toBe("");
  });

  it("routes amount to RM vs foreign by currency", () => {
    const myr = { ...defaultDoc(), senderAccount: "MYR" as const, amount: { value: "1,000" } };
    const usd = { ...defaultDoc(), senderAccount: "USD" as const, amount: { value: "1,000" } };
    expect(isForeignAmount(myr)).toBe(false);
    expect(isForeignAmount(usd)).toBe(true);
    expect(formatAmount(usd)).toBe("1,000 USD");
    expect(formatAmount(myr)).toBe("1,000 MYR");
    expect(formatAmount({ ...myr, amount: { value: "" } })).toBe("");
  });

  it("parses partial docs over defaults without throwing", () => {
    const d = parseDoc('{"recipient":{"name":"Acme"},"amount":{"value":"9.99"}}');
    expect(d.recipient.name).toBe("Acme");
    expect(d.amount.value).toBe("9.99");
    expect(d.senderAccount).toBe("MYR"); // default
  });

  it("falls back to defaults on invalid JSON", () => {
    expect(parseDoc("not json")).toEqual(defaultDoc());
  });

  it("clamps enum fields to valid values", () => {
    const d = parseDoc('{"transferType":"BOGUS","charge":"XXX","purpose":"NOPE"}');
    expect(d.transferType).toBe("FTT");
    expect(d.charge).toBe("OUR");
    expect(d.purpose).toBe("OTHER");
  });

  it("builds a safe export filename", () => {
    const name = exportFilename({
      ...defaultDoc(),
      date: "2026-07-03",
      recipient: { ...defaultDoc().recipient, name: "Acme/Ltd:X" },
    });
    expect(name).toBe("Transfer 2026-07-03 DDG - AcmeLtdX.pdf");
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });
});
