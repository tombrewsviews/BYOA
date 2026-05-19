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
 * Pasting into the terminal: when running inside Tauri we use the
 * pty_paste_prompt command (same path the merge-conflict flow uses) so
 * the prompt lands in the agent's terminal directly. In the browser we
 * fall back to clipboard.writeText().
 */
import React, { useMemo, useState } from "react";
import { isTauri } from "./runtime";
import { getActivePtyId } from "./terminal";
import { useShellActions } from "./shell";
import { ENTRIES, type LibraryEntry } from "./library/entries";

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

export const Library: React.FC<{ onCopy?: (prompt: string) => void }> = ({
  onCopy,
}) => {
  const [filter, setFilter] = useState<LibraryEntry["category"] | "All">("All");
  const [focused, setFocused] = useState<LibraryEntry | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const { focusTerminal } = useShellActions();

  const filtered = useMemo(
    () => (filter === "All" ? ENTRIES : ENTRIES.filter((e) => e.category === filter)),
    [filter],
  );

  const copyPrompt = async (entry: LibraryEntry) => {
    onCopy?.(entry.prompt);
    if (isTauri()) {
      const ptyId = getActivePtyId();
      if (ptyId) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("pty_paste_prompt", { id: ptyId, text: entry.prompt });
        // Hand keyboard control back: switch to the terminal tab and
        // focus xterm so the user can hit Enter immediately.
        focusTerminal();
        setToast("Pasted into terminal");
        setTimeout(() => setToast(null), 1600);
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(entry.prompt);
      setToast("Copied to clipboard");
      setTimeout(() => setToast(null), 1600);
    } catch {
      setToast("Copy failed — select the prompt manually");
      setTimeout(() => setToast(null), 2400);
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "#0a0a10",
        color: "#e4e4ee",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header + category filter */}
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid #232330",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          flex: "0 0 auto",
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: "#fafafa" }}>
          Prompt library
        </div>
        <div style={{ fontSize: 10, color: "#6b6b80", lineHeight: 1.4 }}>
          Click any card to copy a prompt — it pastes straight into the
          terminal.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
          {(["All", ...CATEGORIES] as const).map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              style={{
                padding: "3px 8px",
                fontSize: 10,
                borderRadius: 12,
                border: "1px solid",
                borderColor: filter === c ? "#7c5cff" : "#2e2e3c",
                background: filter === c ? "#7c5cff" : "transparent",
                color: filter === c ? "white" : "#8b8b9a",
                cursor: "pointer",
              }}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Card grid */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: 10,
          display: "grid",
          gridTemplateColumns: "1fr",
          // gridAutoRows: max-content keeps each row at the card's natural
          // height. alignContent: start packs them at the top so a filtered
          // list of 1-2 entries doesn't expand vertically to fill the column
          // (the bug visible in the earlier screenshot).
          gridAutoRows: "max-content",
          gap: 10,
          alignContent: "start",
          alignItems: "start",
        }}
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
          <div style={{ fontSize: 11, color: "#6b6b80", textAlign: "center", padding: 24 }}>
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
        <div
          style={{
            position: "absolute",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#1c1c26",
            border: "1px solid #2e2e3c",
            color: "#fafafa",
            fontSize: 11,
            padding: "6px 12px",
            borderRadius: 6,
            boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
            zIndex: 20,
          }}
        >
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
    <div
      style={{
        background: "#14141c",
        border: "1px solid #232330",
        borderRadius: 8,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}
    >
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
        style={{
          width: "100%",
          height: 140,
          flexShrink: 0,
          background: "#000",
          cursor: "pointer",
          overflow: "hidden",
          position: "relative",
        }}
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
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              objectFit: "cover",
              pointerEvents: "none",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#4b4b5a",
              fontSize: 10,
              padding: 8,
              textAlign: "center",
            }}
          >
            (no preview)
          </div>
        )}
      </div>
      <div
        style={{
          padding: "8px 10px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#fafafa" }}>
            {entry.title}
          </div>
          <span
            style={{
              fontSize: 9,
              color: "#8b8b9a",
              padding: "1px 6px",
              borderRadius: 8,
              border: "1px solid #2e2e3c",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {entry.category}
          </span>
        </div>
        <div style={{ fontSize: 10, color: "#6b6b80", lineHeight: 1.4 }}>
          {entry.blurb}
        </div>
        <button
          onClick={onCopy}
          style={{
            marginTop: 4,
            background: "#7c5cff",
            border: 0,
            borderRadius: 6,
            color: "white",
            fontSize: 11,
            fontWeight: 600,
            padding: "6px 8px",
            cursor: "pointer",
          }}
        >
          Copy prompt
        </button>
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
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.85)",
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          background: "#14141c",
          border: "1px solid #2e2e3c",
          borderRadius: 10,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {url && (
          <video
            src={url}
            autoPlay
            loop
            muted
            playsInline
            style={{
              maxHeight: "55vh",
              objectFit: "contain",
              background: "#000",
            }}
          />
        )}
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#fafafa" }}>
            {entry.title}
          </div>
          <div style={{ fontSize: 11, color: "#8b8b9a", lineHeight: 1.5 }}>
            {entry.blurb}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "#e4e4ee",
              background: "#08080c",
              border: "1px solid #232330",
              borderRadius: 6,
              padding: 10,
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              lineHeight: 1.5,
              maxHeight: 160,
              overflow: "auto",
            }}
          >
            {entry.prompt}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={onCopy}
              style={{
                flex: 1,
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
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "1px solid #2e2e3c",
                borderRadius: 6,
                color: "#e4e4ee",
                fontSize: 12,
                padding: "8px 10px",
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
