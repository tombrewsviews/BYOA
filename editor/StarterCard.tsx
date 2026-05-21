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
import { Button } from "@/components/ui/button";
import { X } from "./icons";

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
    // Absolutely positioned over the player — pointer-events:none on the
    // wrapper so clicks pass to the player UI, with the inner card
    // re-enabling pointer events.
    <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
      <div className="pointer-events-auto flex max-w-[380px] flex-col gap-2.5 rounded-xl border border-border bg-popover/95 p-[18px] text-foreground shadow-2xl backdrop-blur-md">
        <div className="flex items-start justify-between">
          <div className="text-[13px] font-bold">Start with a prompt</div>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={dismiss}
            aria-label="Dismiss"
            title="Dismiss"
          >
            <X />
          </Button>
        </div>
        <div className="text-[11px] leading-relaxed text-muted-foreground">
          Send a prompt to the agent in the terminal and it will write the
          story. Try this:
        </div>
        <div className="rounded-md border border-border bg-background p-2.5 font-mono text-[11px] leading-relaxed text-foreground">
          {HEADLINE_PROMPT}
        </div>
        <Button size="sm" onClick={() => void copyPrompt(HEADLINE_PROMPT)}>
          Copy prompt
        </Button>
        <div className="mt-1 text-[10px] text-muted-foreground">Other ideas:</div>
        {ALT_PROMPTS.map((p, i) => (
          <button
            key={i}
            onClick={() => void copyPrompt(p)}
            className="rounded-md border border-border bg-transparent px-2.5 py-2 text-left text-[11px] leading-snug text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {p}
          </button>
        ))}
        <div className="mt-1.5 text-[10px] text-muted-foreground/70">
          Or browse the prompt library tab (left panel) for techniques with
          live previews.
        </div>
      </div>
      {toast && (
        <div className="pointer-events-auto absolute bottom-6 left-1/2 -translate-x-1/2 rounded-md border border-border bg-secondary px-3 py-1.5 text-[11px] text-foreground">
          {toast}
        </div>
      )}
    </div>
  );
};
