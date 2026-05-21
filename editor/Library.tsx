/**
 * The prompt library — a grid of cards showing things the agent can build.
 *
 * Each card has:
 *   • a looping muted video preview (the rendered MP4 for this entry)
 *   • a title + one-line blurb + category badge
 *   • a "Copy prompt" button that copies the example prompt to the clipboard
 *
 * Cards are grouped by category. Clicking the preview opens a fullscreen-ish
 * overlay with the preview playing at a larger size and the prompt visible
 * in full — keeps the grid scannable while supporting "tell me more."
 *
 * The library is data-driven from editor/library/entries.ts. To add an
 * entry, edit that file and run `npm run library:previews`.
 *
 * Copy prompt routing: handled by the shell's `copyPromptToAgent` — it
 * lands in the chat composer in chat view, the terminal pty in terminal
 * view, or the clipboard in the browser, and reveals the target panel.
 */
import React, { useMemo, useState } from "react";
import { useShellActions } from "./shell";
import { ENTRIES, type LibraryEntry } from "./library/entries";
import { Button } from "@/components/ui/button";

const CATEGORIES: LibraryEntry["category"][] = [
  "Entry",
  "Exit",
  "Variable font",
  "Effects",
  "Layering",
  "Shapes",
];

/** Each preview MP4 ships under editor/library/previews/<slug>.mp4. Vite
 *  rewrites these imports to URLs. We use the URL-glob form so the file
 *  set is statically discoverable. */
const PREVIEW_URLS = import.meta.glob("./library/previews/*.mp4", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const previewUrl = (slug: string): string | undefined =>
  PREVIEW_URLS[`./library/previews/${slug}.mp4`];

export const Library: React.FC = () => {
  const [filter, setFilter] = useState<LibraryEntry["category"] | "All">("All");
  const [focused, setFocused] = useState<LibraryEntry | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const { copyPromptToAgent } = useShellActions();

  const filtered = useMemo(
    () => (filter === "All" ? ENTRIES : ENTRIES.filter((e) => e.category === filter)),
    [filter],
  );

  const copyPrompt = async (entry: LibraryEntry) => {
    // The shell decides where it lands (chat composer / terminal /
    // clipboard) based on the current view mode, and reveals the panel.
    const where = await copyPromptToAgent(entry.prompt);
    if (where === "chat") {
      setToast("Added to chat");
      setTimeout(() => setToast(null), 1600);
      return;
    }
    if (where === "terminal") {
      setToast("Pasted into terminal");
      setTimeout(() => setToast(null), 1600);
      return;
    }
    if (where === "clipboard") {
      setToast("Copied to clipboard");
      setTimeout(() => setToast(null), 1600);
    } else {
      setToast("Copy failed — select the prompt manually");
      setTimeout(() => setToast(null), 2400);
    }
  };

  return (
    <div className="absolute inset-0 flex flex-col bg-card text-muted-foreground">
      {/* Header + category filter */}
      <div className="flex flex-none flex-col gap-1.5 border-b border-border px-3 py-2.5">
        <div className="text-xs font-semibold text-foreground">
          Prompt library
        </div>
        <div className="text-[10px] leading-snug text-muted-foreground">
          Click any card to copy a prompt — it pastes straight into the
          terminal.
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {(["All", ...CATEGORIES] as const).map((c) => (
            <Button
              key={c}
              size="xs"
              variant={filter === c ? "secondary" : "ghost"}
              onClick={() => setFilter(c)}
              className="rounded-full"
            >
              {c}
            </Button>
          ))}
        </div>
      </div>

      {/* Card grid */}
      <div
        className="min-h-0 flex-1 grid grid-cols-1 gap-2.5 overflow-y-auto p-2.5"
        // gridAutoRows: max-content keeps each row at the card's natural
        // height. alignContent: start packs them at the top so a filtered
        // list of 1-2 entries doesn't expand vertically to fill the column.
        style={{ gridAutoRows: "max-content", alignContent: "start", alignItems: "start" }}
      >
        {filtered.map((entry) => (
          <Card
            key={entry.slug}
            entry={entry}
            onCopy={() => void copyPrompt(entry)}
            onOpen={() => setFocused(entry)}
          />
        ))}
        {filtered.length === 0 && (
          <div className="p-6 text-center text-[11px] text-muted-foreground">
            No entries in this category yet.
          </div>
        )}
      </div>

      {/* Focused overlay */}
      {focused && (
        <FocusedView
          entry={focused}
          onClose={() => setFocused(null)}
          onCopy={() => void copyPrompt(focused)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-md border border-border bg-secondary px-3 py-1.5 text-[11px] text-foreground shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

const Card: React.FC<{
  entry: LibraryEntry;
  onCopy: () => void;
  onOpen: () => void;
}> = ({ entry, onCopy, onOpen }) => {
  const url = previewUrl(entry.slug);
  const videoRef = React.useRef<HTMLVideoElement>(null);

  // Play on hover, pause + seek to frame 0 on leave. WebKit honours
  // <video preload="metadata"> + a seekTo(0) on loadedmetadata to draw
  // the first frame as a still while the video is idle, which gives us
  // a free "poster" without rendering a separate image.
  const onEnter = () => {
    const v = videoRef.current;
    if (!v) return;
    void v.play().catch(() => {
      /* autoplay policies — silent */
    });
  };
  const onLeave = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    try {
      v.currentTime = 0;
    } catch {
      /* ignore */
    }
  };

  // NOTE: the preview region is a plain <div> not a <button>. WebKit (the
  // Tauri webview on macOS) renders <button> with absolute-positioned
  // children unpredictably — buttons collapse to 0 height in some flex
  // contexts. A div with role=button + tabIndex behaves consistently.
  return (
    <div className="flex shrink-0 flex-col overflow-hidden rounded-md border border-border bg-secondary">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        aria-label={`Open ${entry.title}`}
        className="relative h-[140px] w-full shrink-0 cursor-pointer overflow-hidden bg-black"
      >
        {url ? (
          <video
            ref={videoRef}
            src={url}
            loop
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              // Force the first frame to paint as a still while paused.
              try {
                (e.currentTarget as HTMLVideoElement).currentTime = 0;
              } catch {
                /* ignore */
              }
            }}
            className="pointer-events-none block h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-2 text-center text-[10px] text-muted-foreground">
            (no preview)
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 px-2.5 pb-2.5 pt-2">
        <div className="flex justify-between gap-1.5">
          <div className="text-[11px] font-semibold text-foreground">
            {entry.title}
          </div>
          <span className="shrink-0 whitespace-nowrap rounded-full border border-border px-1.5 py-px text-[9px] text-muted-foreground">
            {entry.category}
          </span>
        </div>
        <div className="text-[10px] leading-snug text-muted-foreground">
          {entry.blurb}
        </div>
        <Button size="sm" onClick={onCopy} className="mt-1">
          Copy prompt
        </Button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Focused view — bigger preview + full prompt
// ---------------------------------------------------------------------------

const FocusedView: React.FC<{
  entry: LibraryEntry;
  onClose: () => void;
  onCopy: () => void;
}> = ({ entry, onClose, onCopy }) => {
  const url = previewUrl(entry.slug);
  return (
    <div
      onClick={onClose}
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/85 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full max-w-full flex-col overflow-hidden rounded-lg border border-border bg-secondary"
      >
        {url && (
          <video
            src={url}
            autoPlay
            loop
            muted
            playsInline
            className="bg-black object-contain"
            style={{ maxHeight: "55vh" }}
          />
        )}
        <div className="flex flex-col gap-2 p-3.5">
          <div className="text-[13px] font-semibold text-foreground">
            {entry.title}
          </div>
          <div className="text-[11px] leading-relaxed text-muted-foreground">
            {entry.blurb}
          </div>
          <div className="max-h-40 overflow-auto rounded-md border border-border bg-background p-2.5 font-mono text-[11px] leading-relaxed text-foreground">
            {entry.prompt}
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" onClick={onCopy} className="flex-1">
              Copy prompt
            </Button>
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
