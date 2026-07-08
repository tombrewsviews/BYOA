import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Composer } from "../Composer";
import {
  queueChatPrompt,
  __resetComposerModuleStateForTesting,
} from "../Composer";

beforeEach(() => {
  __resetComposerModuleStateForTesting();
});

const noopProps = {
  disabled: false,
  onSubmit: () => {},
  onStop: () => {},
  running: false,
  permissionMode: "full" as const,
  onPermissionModeChange: () => {},
};

const textarea = () =>
  screen.getByPlaceholderText(/message your agent/i) as HTMLTextAreaElement;

describe("queueChatPrompt", () => {
  it("appends into a mounted composer", () => {
    render(<Composer {...noopProps} />);
    act(() => queueChatPrompt("hello from library"));
    expect(textarea().value).toBe("hello from library");
  });

  it("buffers when no composer is mounted, drains on next mount", () => {
    // This is the regression: copying from the Library tab unmounts the
    // composer, so the prompt must survive until the chat panel remounts.
    queueChatPrompt("queued while away");
    // No composer mounted yet → nothing rendered, no throw.
    render(<Composer {...noopProps} />);
    expect(textarea().value).toBe("queued while away");
  });

  it("does not double-deliver a drained prompt on a later mount", () => {
    queueChatPrompt("once only");
    const first = render(<Composer {...noopProps} />);
    expect(textarea().value).toBe("once only");
    first.unmount();
    // Remounting must NOT re-inject the already-drained prompt.
    render(<Composer {...noopProps} />);
    expect(textarea().value).toBe("");
  });

  it("appends to an existing draft rather than replacing it", () => {
    render(<Composer {...noopProps} />);
    act(() => queueChatPrompt("first"));
    act(() => queueChatPrompt("second"));
    expect(textarea().value).toBe("first\nsecond");
  });
});
