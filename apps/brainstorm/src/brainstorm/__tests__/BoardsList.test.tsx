import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BoardsList } from "../BoardsList";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

const BOARDS = [
  { name: "Payments architecture", path: "/p/brainstorm-session-6" },
  { name: "brainstorm-session", path: "/p/brainstorm-session" },
];

/** `isTauri()` keys off this; without it BoardsList renders an empty list. */
const fakeTauri = () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
};

beforeEach(() => {
  fakeTauri();
  invoke.mockReset();
  invoke.mockImplementation((cmd: string) => {
    if (cmd === "projects_list") return Promise.resolve(BOARDS);
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

/**
 * Open the 3-dot menu for a board and wait for the items to mount. Radix opens
 * the dropdown on pointerdown (not click) and requires a real PointerEvent with
 * `button: 0` / a non-touch `pointerType` — see the polyfill in vitest.setup.ts.
 */
const openMenu = async (name: string) => {
  const trigger = await screen.findByRole("button", { name: `Options for ${name}` });
  fireEvent(
    trigger,
    new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerType: "mouse",
    }),
  );
  await screen.findByRole("menuitem", { name: /rename/i });
};

describe("BoardsList", () => {
  it("lists boards by their display name", async () => {
    render(<BoardsList onOpen={() => {}} />);
    expect(await screen.findByText("Payments architecture")).toBeInTheDocument();
    expect(screen.getByText("brainstorm-session")).toBeInTheDocument();
  });

  it("opens a board via project_open", async () => {
    const onOpen = vi.fn();
    render(<BoardsList onOpen={onOpen} />);
    fireEvent.click(await screen.findByText("Payments architecture"));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("project_open", {
        path: "/p/brainstorm-session-6",
      }),
    );
    expect(onOpen).toHaveBeenCalledWith(BOARDS[0]);
  });

  it("renames via the menu, prefilling the current name", async () => {
    render(<BoardsList onOpen={() => {}} />);
    await openMenu("Payments architecture");
    fireEvent.click(screen.getByRole("menuitem", { name: /rename/i }));

    const input = await screen.findByLabelText("Board name");
    expect(input).toHaveValue("Payments architecture");

    fireEvent.change(input, { target: { value: "Billing redesign" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("project_rename", {
        path: "/p/brainstorm-session-6",
        name: "Billing redesign",
      }),
    );
    // Refreshed so the new name shows without leaving the screen.
    expect(invoke.mock.calls.filter((c) => c[0] === "projects_list").length).toBe(2);
  });

  it("does not allow saving a blank rename", async () => {
    render(<BoardsList onOpen={() => {}} />);
    await openMenu("Payments architecture");
    fireEvent.click(screen.getByRole("menuitem", { name: /rename/i }));

    fireEvent.change(await screen.findByLabelText("Board name"), {
      target: { value: "   " },
    });
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("cancelling a rename invokes nothing", async () => {
    render(<BoardsList onOpen={() => {}} />);
    await openMenu("Payments architecture");
    fireEvent.click(screen.getByRole("menuitem", { name: /rename/i }));
    fireEvent.change(await screen.findByLabelText("Board name"), {
      target: { value: "Nope" },
    });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(screen.queryByLabelText("Board name")).not.toBeInTheDocument(),
    );
    expect(invoke).not.toHaveBeenCalledWith("project_rename", expect.anything());
  });

  it("deleting asks for confirmation first, then deletes", async () => {
    render(<BoardsList onOpen={() => {}} />);
    await openMenu("Payments architecture");
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));

    // Confirmation names the board and says where it goes.
    expect(await screen.findByText(/moved to the Trash/i)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("project_delete", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: /delete board/i }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("project_delete", {
        path: "/p/brainstorm-session-6",
      }),
    );
  });

  it("cancelling a delete invokes nothing", async () => {
    render(<BoardsList onOpen={() => {}} />);
    await openMenu("Payments architecture");
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(screen.queryByText(/moved to the Trash/i)).not.toBeInTheDocument(),
    );
    expect(invoke).not.toHaveBeenCalledWith("project_delete", expect.anything());
  });

  it("surfaces a rename failure instead of silently swallowing it", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "projects_list") return Promise.resolve(BOARDS);
      if (cmd === "project_rename") return Promise.reject(new Error("disk full"));
      return Promise.resolve(undefined);
    });
    render(<BoardsList onOpen={() => {}} />);
    await openMenu("Payments architecture");
    fireEvent.click(screen.getByRole("menuitem", { name: /rename/i }));
    fireEvent.change(await screen.findByLabelText("Board name"), {
      target: { value: "New" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/Rename failed: disk full/)).toBeInTheDocument();
  });
});
