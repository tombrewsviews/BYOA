import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MentionField } from "../MentionField";
import type { Actor } from "../../board/api";

const actors: Actor[] = [
  { id: "ada-lovelace", label: "Ada Lovelace" },
  { id: "alan-turing", label: "Alan Turing" },
];

describe("MentionField", () => {
  // The field is controlled, so the test opens the menu the way the app does:
  // place the caret (setSelectionRange) then fire keyUp — the handler reads the
  // caret synchronously and, combined with the @-token in `value`, opens the menu.
  const openAt = (value: string, caret: number) => {
    render(<MentionField value={value} actors={actors} onChange={vi.fn()} />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    ta.setSelectionRange(caret, caret);
    fireEvent.keyUp(ta);
    return ta;
  };

  it("shows the @-mention menu filtered by query", () => {
    openAt("hey @ada", 8);
    expect(screen.getByText("@Ada Lovelace")).toBeInTheDocument();
    expect(screen.queryByText("@Alan Turing")).not.toBeInTheDocument();
  });

  it("inserts the full @label on pick", () => {
    const onChange = vi.fn();
    render(<MentionField value="hey @ada" actors={actors} onChange={onChange} />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    ta.setSelectionRange(8, 8);
    fireEvent.keyUp(ta);
    fireEvent.click(screen.getByText("@Ada Lovelace"));
    expect(onChange).toHaveBeenLastCalledWith("hey @Ada Lovelace ");
  });

  it("does not open a menu without an @ token", () => {
    openAt("just a plain note", 17);
    expect(screen.queryByText("@Ada Lovelace")).not.toBeInTheDocument();
  });
});
