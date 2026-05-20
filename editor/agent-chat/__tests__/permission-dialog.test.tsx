import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PermissionDialog } from "../PermissionDialog";

describe("PermissionDialog", () => {
  const pending = {
    promptId: "p1",
    tool: "Edit",
    args: { file_path: "/x/story.json" },
    scope: "file",
  };

  it("renders tool name and args summary", () => {
    render(<PermissionDialog pending={pending} onDecide={() => {}} />);
    expect(screen.getByText(/Edit/)).toBeInTheDocument();
    expect(screen.getByText(/story\.json/)).toBeInTheDocument();
  });

  it("calls onDecide('allow') when Allow once is clicked", () => {
    const onDecide = vi.fn();
    render(<PermissionDialog pending={pending} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole("button", { name: /allow once/i }));
    expect(onDecide).toHaveBeenCalledWith("p1", "allow");
  });

  it("calls onDecide('allow-always') when Allow always is clicked", () => {
    const onDecide = vi.fn();
    render(<PermissionDialog pending={pending} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole("button", { name: /allow always/i }));
    expect(onDecide).toHaveBeenCalledWith("p1", "allow-always");
  });

  it("calls onDecide('deny') when Deny is clicked", () => {
    const onDecide = vi.fn();
    render(<PermissionDialog pending={pending} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole("button", { name: /deny/i }));
    expect(onDecide).toHaveBeenCalledWith("p1", "deny");
  });

  it("treats Escape as Deny", () => {
    const onDecide = vi.fn();
    render(<PermissionDialog pending={pending} onDecide={onDecide} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDecide).toHaveBeenCalledWith("p1", "deny");
  });
});
