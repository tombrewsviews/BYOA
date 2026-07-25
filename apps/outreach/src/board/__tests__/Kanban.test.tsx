import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Kanban } from "../Kanban";
import type { Stage, Lead } from "../types";

const stages: Stage[] = [
  { id: "researching", label: "Researching", position: 0, color: null, retiredAt: null, version: 1 },
  { id: "contacted", label: "Contacted", position: 1, color: null, retiredAt: null, version: 1 },
  { id: "old", label: "Old", position: 2, color: null, retiredAt: "2026-01-01T00:00:00Z", version: 1 },
];
const leads: Lead[] = [
  { id: "l1", stage: "researching", name: "Ada Lovelace", org: "Analytical", version: 3 },
  { id: "l2", stage: "contacted", name: "Alan Turing", org: null, version: 1 },
  { id: "l3", stage: "ghost_stage", name: "Orphan Lead", org: null, version: 1 }, // stage not in list → Unsorted
];

const noop = () => {};
const baseProps = {
  onMove: noop,
  onSelect: noop,
  onAddLead: noop,
  onAddColumn: noop,
  selectedId: null,
};

describe("Kanban", () => {
  it("renders one column per non-retired stage, cards in the right column", () => {
    render(<Kanban {...baseProps} stages={stages} leads={leads} />);
    expect(screen.getByText("Researching")).toBeInTheDocument();
    expect(screen.getByText("Contacted")).toBeInTheDocument();
    // retired stage hidden
    expect(screen.queryByText("Old")).not.toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Alan Turing")).toBeInTheDocument();
  });

  it("puts a lead whose stage id is unknown into an Unsorted column (§15.5)", () => {
    render(<Kanban {...baseProps} stages={stages} leads={leads} />);
    expect(screen.getByText("Unsorted")).toBeInTheDocument();
    expect(screen.getByText("Orphan Lead")).toBeInTheDocument();
  });

  it("does not render Unsorted when every lead maps to a known stage", () => {
    const clean = leads.filter((l) => l.stage !== "ghost_stage");
    render(<Kanban {...baseProps} stages={stages} leads={clean} />);
    expect(screen.queryByText("Unsorted")).not.toBeInTheDocument();
  });
});
