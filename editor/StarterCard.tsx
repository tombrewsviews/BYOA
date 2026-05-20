/**
 * The starter card — the first thing a new project shows on the canvas.
 *
 * Trigger: the story looks "untouched" — exactly one beat with placeholder
 * text. As soon as the user (or the agent) changes anything substantial,
 * the card hides itself. It can also be manually dismissed (per project,
 * remembered in localStorage so it doesn't reappear next session).
 *
 * The card surfaces:
 *  - one headline example prompt with a Copy button
 *  - two alternate prompts as one-liners
 *  - a "browse the prompt library" pointer
 *
 * The aim: a new user opens the app and immediately sees something they
 * can copy → paste → run, instead of an empty canvas with no clue what
 * to type.
 */
import React, { useState } from "react";
import { useShellActions } from "./shell";
import type { Story } from "../src/kinetic/schema";
import { color, primaryBtn, ghostBtn } from "./platform/theme";

const HEADLINE_PROMPT =
  "Animate the words 'launch your idea' as a 3-beat sequence — each word lands vertically with a small overshoot, holds readable for a beat, then exits rotating gently.";

const ALT_PROMPTS = [
  "Make the word 'momentum' enter as a slot-machine roll, oscillate while held with a weight pulse, then scatter on exit.",
  "Show 'every story grows' across 3 beats with per-letter palette colours, soft glow, and a shape morphing into the first letter of 'every'.",
];

const seemsUntouched = (story: Story): boolean => story.beats.length === 0;

const dismissKey = (projectPath: string) =>
  `studio.starter.dismissed.${projectPath}`;

export const StarterCard: React.FC<{
  story: Story;
  projectPath: string;
}> = ({ story, projectPath }) => {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(dismissKey(projectPath)) === "1";
    } catch {
      return false;
    }
  });
  const [toast, setToast] = useState<string | null>(null);
  // Hook must run before any early return below.
  const { copyPromptToAgent } = useShellActions();

  if (dismissed) return null;
  if (!seemsUntouched(story)) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(dismissKey(projectPath), "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  const copyPrompt = async (prompt: string) => {
    // The shell routes to chat composer / terminal / clipboard by mode.
    const where = await copyPromptToAgent(prompt);
    const msg =
      where === "chat"
        ? "Added to chat"
        : where === "terminal"
          ? "Pasted into terminal"
          : where === "clipboard"
            ? "Copied to clipboard"
            : "Copy failed";
    setToast(msg);
    setTimeout(() => setToast(null), 1600);
  };

  return (
    <div
      // Absolutely positioned over the player — pointer-events:none on the
      // wrapper so clicks pass to the player UI, with the inner card
      // re-enabling pointer events.
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      <div
        style={{
          pointerEvents: "auto",
          background: "rgba(20, 20, 28, 0.92)",
          border: `1px solid ${color.border.strong}`,
          borderRadius: 12,
          padding: 18,
          maxWidth: 380,
          color: color.text.primary,
          boxShadow: "0 16px 64px rgba(0,0,0,0.6)",
          backdropFilter: "blur(8px)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            Start with a prompt
          </div>
          <button
            onClick={dismiss}
            style={{
              ...ghostBtn(),
              fontSize: 16,
              lineHeight: 1,
              padding: 0,
            }}
            aria-label="Dismiss"
            title="Dismiss"
          >
            ×
          </button>
        </div>
        <div style={{ fontSize: 11, color: color.text.muted, lineHeight: 1.5 }}>
          Send a prompt to the agent in the terminal and it will write the
          story. Try this:
        </div>
        <div
          style={{
            background: color.bg.canvas,
            border: `1px solid ${color.border.line}`,
            borderRadius: 6,
            padding: 10,
            fontSize: 11,
            color: color.text.secondary,
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            lineHeight: 1.5,
          }}
        >
          {HEADLINE_PROMPT}
        </div>
        <button
          onClick={() => void copyPrompt(HEADLINE_PROMPT)}
          style={{
            ...primaryBtn({ size: "sm" }),
          }}
        >
          Copy prompt
        </button>
        <div style={{ fontSize: 10, color: color.text.dim, marginTop: 4 }}>
          Other ideas:
        </div>
        {ALT_PROMPTS.map((p, i) => (
          <button
            key={i}
            onClick={() => void copyPrompt(p)}
            style={{
              textAlign: "left",
              background: "transparent",
              border: `1px solid ${color.border.strong}`,
              borderRadius: 6,
              color: color.text.muted,
              fontSize: 11,
              padding: "8px 10px",
              cursor: "pointer",
              lineHeight: 1.4,
            }}
          >
            {p}
          </button>
        ))}
        <div style={{ fontSize: 10, color: color.text.faint, marginTop: 6 }}>
          Or browse the prompt library tab (left panel) for techniques with
          live previews.
        </div>
      </div>
      {toast && (
        <div
          style={{
            position: "absolute",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: color.bg.selected,
            border: `1px solid ${color.border.strong}`,
            color: color.text.primary,
            fontSize: 11,
            padding: "6px 12px",
            borderRadius: 6,
            pointerEvents: "auto",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
};
