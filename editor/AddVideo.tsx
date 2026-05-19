/**
 * "+ Video" button + popover. Two options:
 *   - Pick a file...   → Tauri file dialog → import_local_video
 *   - YouTube URL...    → text input → download_youtube
 *
 * On success, calls onImported(absolutePath) — the caller (Timeline)
 * adds a videoClip beat referencing that path.
 *
 * Progress for YouTube downloads streams via `video://yt-progress`
 * events. We show the most recent line in the popover so the user
 * sees yt-dlp doing something.
 */
import React, { useEffect, useRef, useState } from "react";
import { isTauri } from "./runtime";

type Props = {
  onImported: (absolutePath: string) => void;
};

export const AddVideo: React.FC<Props> = ({ onImported }) => {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "youtube">("menu");
  const [url, setUrl] = useState("");
  // recent yt-dlp output lines, newest LAST. We keep ~6 so the user
  // sees the rolling progress without the popover growing unboundedly.
  const [logLines, setLogLines] = useState<string[]>([]);
  // Parsed percent from [download] lines, -1 if unknown.
  const [percent, setPercent] = useState<number>(-1);
  // Phase label: "starting" | "downloading" | "merging" | "done"
  const [phase, setPhase] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const activeJobRef = useRef<string | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        if (!busy) {
          setOpen(false);
          setMode("menu");
        }
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, busy]);

  // Subscribe to yt-dlp progress events once.
  useEffect(() => {
    if (!isTauri()) return;
    let off: undefined | (() => void);
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unProg = await listen<{ id: string; line: string }>(
        "video://yt-progress",
        (e) => {
          if (!activeJobRef.current || e.payload.id !== activeJobRef.current) {
            return;
          }
          const line = e.payload.line;
          // Try to extract the percent from "[download]  42.3% of 12.5MiB at 1.2MiB/s ETA 00:08"
          const pctMatch = line.match(/\[download\]\s+([\d.]+)%/);
          if (pctMatch) {
            setPercent(parseFloat(pctMatch[1]));
            setPhase("downloading");
          } else if (/^\[Merger\]/.test(line) || /Merging formats/.test(line)) {
            setPhase("merging");
          } else if (/^\[ExtractAudio\]/.test(line)) {
            setPhase("extracting audio");
          } else if (/^\[info\]/.test(line)) {
            setPhase("starting");
          }
          setLogLines((prev) => {
            const next = [...prev, line];
            return next.slice(-6);
          });
        },
      );
      const unDone = await listen<{ id: string; path: string }>(
        "video://yt-done",
        (e) => {
          if (activeJobRef.current === e.payload.id) {
            activeJobRef.current = null;
            setBusy(false);
            setPercent(-1);
            setPhase("");
            setLogLines([]);
            setOpen(false);
            setMode("menu");
            setUrl("");
            onImported(e.payload.path);
          }
        },
      );
      const unErr = await listen<{ id: string; line: string }>(
        "video://yt-error",
        (e) => {
          if (activeJobRef.current === e.payload.id) {
            activeJobRef.current = null;
            setBusy(false);
            setError(e.payload.line);
          }
        },
      );
      off = () => {
        unProg();
        unDone();
        unErr();
      };
    })();
    return () => {
      if (off) off();
    };
  }, [onImported]);

  const pickFile = async () => {
    setError(null);
    if (!isTauri()) {
      setError("File picker only works in the desktop app.");
      return;
    }
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const picked = await openDialog({
        directory: false,
        multiple: false,
        filters: [
          { name: "Video", extensions: ["mp4", "mov", "m4v", "webm"] },
        ],
      });
      if (typeof picked !== "string") return;
      setBusy(true);
      const { invoke } = await import("@tauri-apps/api/core");
      const dest = await invoke<string>("import_local_video", {
        source: picked,
      });
      setBusy(false);
      setOpen(false);
      setMode("menu");
      onImported(dest);
    } catch (e) {
      setBusy(false);
      setError(`Import failed: ${(e as Error).message ?? e}`);
    }
  };

  const startYoutube = async () => {
    setError(null);
    if (!url.trim()) {
      setError("Paste a YouTube URL first.");
      return;
    }
    if (!isTauri()) {
      setError("YouTube import only works in the desktop app.");
      return;
    }
    try {
      setBusy(true);
      setPercent(-1);
      setPhase("starting");
      setLogLines([]);
      const { invoke } = await import("@tauri-apps/api/core");
      const id = await invoke<string>("download_youtube", { url: url.trim() });
      activeJobRef.current = id;
    } catch (e) {
      setBusy(false);
      setError(`Start failed: ${(e as Error).message ?? e}`);
    }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <style>{`
        @keyframes ytdlp-pulse {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(333%); }
        }
      `}</style>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Add video"
        style={{
          padding: "4px 12px",
          fontSize: 11,
          borderRadius: 4,
          border: "1px dashed #3a3a4c",
          background: "transparent",
          color: "#8b8b9a",
          cursor: "pointer",
        }}
      >
        + Video
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            left: 0,
            marginBottom: 6,
            background: "#0a0a10",
            border: "1px solid #2e2e3c",
            borderRadius: 6,
            padding: 12,
            minWidth: 280,
            zIndex: 100,
            boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
            color: "#e4e4ee",
            fontSize: 11,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {mode === "menu" && (
            <>
              <button
                onClick={() => void pickFile()}
                disabled={busy}
                style={menuBtn(busy)}
              >
                Pick a file…
              </button>
              <button
                onClick={() => setMode("youtube")}
                disabled={busy}
                style={menuBtn(busy)}
              >
                Paste YouTube URL…
              </button>
              {error && <div style={errorStyle}>{error}</div>}
            </>
          )}
          {mode === "youtube" && (
            <>
              <div style={{ fontWeight: 600, color: "#fafafa" }}>
                Paste a YouTube URL
              </div>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={busy}
                placeholder="https://www.youtube.com/watch?v=…"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy) void startYoutube();
                }}
                style={{
                  background: "#1c1c26",
                  border: "1px solid #2e2e3c",
                  borderRadius: 5,
                  color: "#e4e4ee",
                  fontSize: 11,
                  padding: "5px 8px",
                  outline: "none",
                }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => void startYoutube()}
                  disabled={busy}
                  style={{
                    flex: 1,
                    background: busy ? "#232330" : "#7c5cff",
                    color: busy ? "#6b6b80" : "white",
                    border: 0,
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "5px 8px",
                    cursor: busy ? "default" : "pointer",
                  }}
                >
                  {busy ? "Downloading…" : "Download"}
                </button>
                <button
                  onClick={() => {
                    if (!busy) {
                      setMode("menu");
                      setError(null);
                    }
                  }}
                  disabled={busy}
                  style={{
                    background: "transparent",
                    border: "1px solid #2e2e3c",
                    color: "#8b8b9a",
                    borderRadius: 4,
                    fontSize: 11,
                    padding: "5px 8px",
                    cursor: busy ? "default" : "pointer",
                  }}
                >
                  Back
                </button>
              </div>
              {busy && (
                <>
                  {/* Phase + percent header */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: 10,
                      color: "#8b8b9a",
                    }}
                  >
                    <span style={{ textTransform: "capitalize" }}>
                      {phase || "working"}
                    </span>
                    <span>
                      {percent >= 0 ? `${percent.toFixed(1)}%` : "…"}
                    </span>
                  </div>
                  {/* Progress bar — width based on percent if known,
                      else an indeterminate-style stripe. */}
                  <div
                    style={{
                      height: 4,
                      background: "#1c1c26",
                      borderRadius: 2,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: percent >= 0 ? `${percent}%` : "30%",
                        background: "#7c5cff",
                        transition:
                          percent >= 0
                            ? "width 200ms ease-out"
                            : undefined,
                        animation:
                          percent < 0
                            ? "ytdlp-pulse 1.2s linear infinite"
                            : undefined,
                      }}
                    />
                  </div>
                  {/* Rolling log tail — last 6 lines so the user can
                      see what yt-dlp is doing without the popover
                      growing unboundedly. */}
                  {logLines.length > 0 && (
                    <div
                      style={{
                        color: "#6b6b80",
                        fontFamily: "ui-monospace, monospace",
                        fontSize: 9.5,
                        lineHeight: 1.4,
                        maxHeight: 90,
                        overflow: "auto",
                        background: "#08080c",
                        border: "1px solid #1c1c26",
                        borderRadius: 4,
                        padding: 6,
                      }}
                    >
                      {logLines.map((l, i) => (
                        <div
                          key={i}
                          style={{
                            wordBreak: "break-all",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {l}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {error && <div style={errorStyle}>{error}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
};

const menuBtn = (disabled: boolean): React.CSSProperties => ({
  background: "transparent",
  border: "1px solid #2e2e3c",
  color: "#e4e4ee",
  borderRadius: 4,
  fontSize: 11,
  padding: "6px 10px",
  textAlign: "left",
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.5 : 1,
});

const errorStyle: React.CSSProperties = {
  color: "#ff8b8b",
  background: "#3a1414",
  border: "1px solid #5a2020",
  borderRadius: 4,
  padding: "5px 8px",
  fontSize: 10,
  lineHeight: 1.4,
};
