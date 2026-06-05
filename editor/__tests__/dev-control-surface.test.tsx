import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import { DevControlSurface } from "../DevControlSurface";

afterEach(() => {
  // clear any :root overrides a test left behind
  document.documentElement.removeAttribute("style");
});

describe("DevControlSurface (token-tier live proof)", () => {
  it("stays hidden by default", () => {
    const { container } = render(<DevControlSurface />);
    expect(container.firstChild).toBeNull();
  });

  it("mounts when forced open and lists the token tier", () => {
    const { getByLabelText, getByText } = render(<DevControlSurface defaultOpen />);
    fireEvent.click(getByText("tokens"));
    // a representative color token + the radius token are present
    expect(getByLabelText("--background hex")).toBeTruthy();
    expect(getByLabelText("--radius")).toBeTruthy();
  });

  it("writes an edited color straight onto :root (runtime binding)", () => {
    const { getByLabelText, getByText } = render(<DevControlSurface defaultOpen />);
    fireEvent.click(getByText("tokens"));
    const hex = getByLabelText("--primary hex") as HTMLInputElement;
    fireEvent.change(hex, { target: { value: "#ff0000" } });
    expect(
      document.documentElement.style.getPropertyValue("--primary"),
    ).toBe("#ff0000");
  });

  it("copy-diff input reflects only changed tokens (escape hatch)", () => {
    const { getByLabelText, getByText } = render(
      <DevControlSurface defaultOpen />,
    );
    fireEvent.click(getByText("tokens"));
    // nothing changed → copy diff disabled
    expect((getByText("copy diff") as HTMLButtonElement).disabled).toBe(true);

    const hex = getByLabelText("--accent hex") as HTMLInputElement;
    fireEvent.change(hex, { target: { value: "#123456" } });

    // now enabled (the "N changed" header text was removed with the tab switch)
    expect((getByText("copy diff") as HTMLButtonElement).disabled).toBe(false);
  });

  it("reset all removes :root overrides", () => {
    const { getByLabelText, getByText } = render(<DevControlSurface defaultOpen />);
    fireEvent.click(getByText("tokens"));
    fireEvent.change(getByLabelText("--border hex") as HTMLInputElement, {
      target: { value: "#abcdef" },
    });
    expect(
      document.documentElement.style.getPropertyValue("--border"),
    ).toBe("#abcdef");

    fireEvent.click(getByText("reset all"));
    expect(
      document.documentElement.style.getPropertyValue("--border"),
    ).toBe("");
  });
});
