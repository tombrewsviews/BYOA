import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Settings } from "../Settings";
import type { Stage } from "../../board/types";
import type { BoardConfig } from "../../board/api";

const stages: Stage[] = [
  { id: "researching", label: "Researching", position: 0, color: null, retiredAt: null, version: 1 },
  { id: "follow-up", label: "Follow up", position: 1, color: null, retiredAt: null, version: 1 },
];
const config: BoardConfig = { name: "My Board", createdBy: "local", version: 1 };

describe("Settings", () => {
  it("shows created_by and each stage's stable id", () => {
    render(<Settings stages={stages} config={config} onRename={() => {}} />);
    expect(screen.getByText(/local/)).toBeInTheDocument();
    expect(screen.getByText("researching")).toBeInTheDocument();  // stable id shown
    expect(screen.getByText("follow-up")).toBeInTheDocument();
  });
  it("calls onRename with the stage id and new label on Enter", () => {
    const onRename = vi.fn();
    render(<Settings stages={stages} config={config} onRename={onRename} />);
    const input = screen.getByDisplayValue("Researching");
    fireEvent.change(input, { target: { value: "Prospecting" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("researching", "Prospecting");
  });
});
