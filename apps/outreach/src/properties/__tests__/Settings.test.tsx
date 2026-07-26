import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Settings } from "../Settings";
import type { Stage } from "../../board/types";
import { openResearchFolder, type BoardConfig } from "../../board/api";

vi.mock("../../board/api", () => ({ openResearchFolder: vi.fn(() => Promise.resolve()) }));

const stages: Stage[] = [
  { id: "researching", label: "Researching", position: 0, color: null, retiredAt: null, version: 1 },
  { id: "follow-up", label: "Follow up", position: 1, color: null, retiredAt: null, version: 1 },
];
const config: BoardConfig = { name: "My Board", createdBy: "local", version: 1 };

const noop = () => {};

describe("Settings", () => {
  it("shows created_by and each stage's stable id", () => {
    render(
      <Settings
        stages={stages}
        config={config}
        onReorder={noop}
        onAddStage={noop}
        onRemoveStage={noop}
        onRename={noop}
        onSaveActor={noop}
        onSaveDbUrl={noop}
      />,
    );
    expect(screen.getByText(/Created by local/)).toBeInTheDocument();
    expect(screen.getByText("researching")).toBeInTheDocument();  // stable id shown
    expect(screen.getByText("follow-up")).toBeInTheDocument();
  });
  it("calls onRename with the stage id and new label on Enter", () => {
    const onRename = vi.fn();
    render(
      <Settings
        stages={stages}
        config={config}
        onReorder={noop}
        onAddStage={noop}
        onRemoveStage={noop}
        onRename={onRename}
        onSaveActor={noop}
        onSaveDbUrl={noop}
      />,
    );
    const input = screen.getByDisplayValue("Researching");
    fireEvent.change(input, { target: { value: "Prospecting" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("researching", "Prospecting");
  });
  it("opens the research folder when the button is clicked", () => {
    render(
      <Settings
        stages={stages}
        config={config}
        onReorder={noop}
        onAddStage={noop}
        onRemoveStage={noop}
        onRename={noop}
        onSaveActor={noop}
        onSaveDbUrl={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open research folder/i }));
    expect(openResearchFolder).toHaveBeenCalledTimes(1);
  });
  it("renders sharing fields and saves name + db url", () => {
    const onSaveActor = vi.fn();
    const onSaveDbUrl = vi.fn();
    render(
      <Settings
        stages={stages}
        config={config}
        onReorder={noop}
        onAddStage={noop}
        onRemoveStage={noop}
        actorName="Ada"
        databaseUrl="postgres://x"
        onRename={() => {}}
        onSaveActor={onSaveActor}
        onSaveDbUrl={onSaveDbUrl}
      />,
    );
    expect(screen.getByText("Your name")).toBeInTheDocument();
    expect(screen.getByText("Shared database URL")).toBeInTheDocument();
    const name = screen.getByDisplayValue("Ada");
    fireEvent.change(name, { target: { value: "Grace" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(onSaveActor).toHaveBeenCalledWith("Grace");
  });
});
