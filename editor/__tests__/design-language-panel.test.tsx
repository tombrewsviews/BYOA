import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import { DesignLanguagePanel } from "../DesignLanguagePanel";

afterEach(() => document.documentElement.removeAttribute("style"));

describe("DesignLanguagePanel", () => {
  it("renders the 6 dials", () => {
    const { getByLabelText } = render(<DesignLanguagePanel />);
    for (const k of ["temperature","contrast","density","softness","character","weight"])
      expect(getByLabelText(k)).toBeTruthy();
  });
  it("moving a dial writes tokens onto :root", () => {
    const { getByLabelText } = render(<DesignLanguagePanel />);
    fireEvent.change(getByLabelText("softness"), { target: { value: "3" } });
    expect(document.documentElement.style.getPropertyValue("--radius")).not.toBe("");
  });
  it("applying a phrase updates dials (lexicon path)", () => {
    const { getByPlaceholderText, getByText, getByLabelText } = render(<DesignLanguagePanel />);
    fireEvent.change(getByPlaceholderText(/warmer/i), { target: { value: "airier" } });
    fireEvent.click(getByText(/apply phrase/i));
    expect((getByLabelText("density") as HTMLInputElement).value).toBe("-1");
  });
  it("selecting a preset snaps dials", () => {
    const { getByText, getByLabelText } = render(<DesignLanguagePanel />);
    fireEvent.click(getByText("editorial"));
    expect(Number((getByLabelText("density") as HTMLInputElement).value)).toBe(2);
  });
});
