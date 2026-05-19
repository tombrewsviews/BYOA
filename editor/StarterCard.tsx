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
import { isTauri } from "./runtime";
import { getActivePtyId } from "./terminal";
import type { Story } from "../src/kinetic/schema";

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
    if (isTauri()) {
      const ptyId = getActivePtyId();
      if (ptyId) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("pty_paste_prompt", { id: ptyId, text: prompt });
        setToast("Pasted into terminal");
        setTimeout(() => setToast(null), 1600);
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(prompt);
      setToast("Copied to clipboard");
      setTimeout(() => setToast(null), 1600);
    } catch {
      setToast("Copy failed");
      setTimeout(() => setToast(null), 1600);
    }
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
          border: "1px solid #2e2e3c",
          borderRadius: 12,
          padding: 18,
          maxWidth: 380,
          color: "#fafafa",
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
              background: "transparent",
              border: 0,
              color: "#6b6b80",
              cursor: "pointer",
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
        <div style={{ fontSize: 11, color: "#8b8b9a", lineHeight: 1.5 }}>
          Send a prompt to the agent in the terminal and it will write the
          story. Try this:
        </div>
        <div
          style={{
            background: "#08080c",
            border: "1px solid #232330",
            borderRadius: 6,
            padding: 10,
            fontSize: 11,
            color: "#e4e4ee",
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            lineHeight: 1.5,
          }}
        >
          {HEADLINE_PROMPT}
        </div>
        <button
          onClick={() => void copyPrompt(HEADLINE_PROMPT)}
          style={{
            background: "#7c5cff",
            border: 0,
            borderRadius: 6,
            color: "white",
            fontSize: 12,
            fontWeight: 600,
            padding: "8px 10px",
            cursor: "pointer",
          }}
        >
          Copy prompt
        </button>
        <div style={{ fontSize: 10, color: "#6b6b80", marginTop: 4 }}>
          Other ideas:
        </div>
        {ALT_PROMPTS.map((p, i) => (
          <button
            key={i}
            onClick={() => void copyPrompt(p)}
            style={{
              textAlign: "left",
              background: "transparent",
              border: "1px solid #2e2e3c",
              borderRadius: 6,
              color: "#8b8b9a",
              fontSize: 11,
              padding: "8px 10px",
              cursor: "pointer",
              lineHeight: 1.4,
            }}
          >
            {p}
          </button>
        ))}
        <div style={{ fontSize: 10, color: "#4b4b5a", marginTop: 6 }}>
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
            background: "#1c1c26",
            border: "1px solid #2e2e3c",
            color: "#fafafa",
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
