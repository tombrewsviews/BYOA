import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Inspector } from "../Inspector";
import type { LeadDetail } from "../../board/api";

const lead: LeadDetail = {
  id: "l1", stage: "researching", name: "Ada Lovelace", org: "Analytical Engine Co",
  context: { facts: ["Met at conference", { note: "warm intro" }] },
  messages: ["Hi Ada, following up…"],
  transcripts: [{ raw: "long raw text", summary: "Discussed pilot in Q3" }],
  createdAt: "x", updatedAt: "y", version: 4,
};

describe("Inspector", () => {
  it("shows empty state when no lead", () => {
    render(<Inspector lead={null} />);
    expect(screen.getByText(/select a lead/i)).toBeInTheDocument();
  });
  it("renders name, context facts, messages, transcript summaries", () => {
    render(<Inspector lead={lead} />);
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Met at conference")).toBeInTheDocument();
    expect(screen.getByText(/warm intro/)).toBeInTheDocument();          // object fact JSON.stringify'd
    expect(screen.getByText(/following up/)).toBeInTheDocument();
    expect(screen.getByText("Discussed pilot in Q3")).toBeInTheDocument();
    expect(screen.queryByText("long raw text")).not.toBeInTheDocument();  // raw NOT shown, only summary
  });
});
