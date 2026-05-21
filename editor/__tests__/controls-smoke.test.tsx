import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { Dropdown, Slider, ColorControl, TextInput } from "../controls";

describe("controls smoke (Base UI wrappers mount)", () => {
  it("Dropdown mounts with options", () => {
    const { container } = render(
      <Dropdown value="a" options={["a", "b"]} onChange={() => {}} />,
    );
    expect(container.querySelector("button")).toBeTruthy();
  });
  it("Slider mounts", () => {
    const { container } = render(
      <Slider value={5} min={0} max={10} step={1} onChange={() => {}} />,
    );
    // number readout input present
    expect(container.querySelector("input[type=number]")).toBeTruthy();
  });
  it("ColorControl + TextInput mount", () => {
    const { container: c1 } = render(
      <ColorControl value="#fafafa" onChange={() => {}} />,
    );
    expect(c1.querySelector("input[type=color]")).toBeTruthy();
    const { container: c2 } = render(
      <TextInput value="hi" onChange={() => {}} />,
    );
    expect(c2.querySelector("input")).toBeTruthy();
  });
});
