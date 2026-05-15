/**
 * The kinetic story editor — app shell.
 *
 * Layout: <Player> live preview on the left, the design-properties Panel
 * on the right. Loads story.json, holds it in state, feeds it to the
 * Player as memoized inputProps, and POSTs it back to story.json on save
 * (via the dev-server plugin in vite.config.ts).
 *
 * Player best practices applied (remotion.dev/docs/player/best-practices):
 *  - inputProps is useMemo'd so panel edits don't thrash the Player tree
 *  - the <Player> is isolated in its own component from the panel
 *  - playback is driven via playerRef
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type PlayerRef } from "@remotion/player";
import { PlayerStage, Transport } from "./player";
import {
  storySchema,
  storyDurationInFrames,
  type Story,
} from "../src/kinetic/schema";
import { Panel } from "./panel";
import { Timeline } from "./timeline";
import { Terminal } from "./terminal";
import { isTauri } from "./runtime";
import { diffFields, applyFields, fieldLabel, readField, type FieldKey } from "./diff";
import { getActivePtyId } from "./terminal";

const FPS = 30;

export type Selection =
  | { kind: "story" }
  | { kind: "beat"; index: number };

export const App: React.FC = () => {
  const [story, setStory] = useState<Story | null>(null);
  const [savedJson, setSavedJson] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const playerRef = useRef<PlayerRef>(null);
  const [selection, setSelection] = useState<Selection>({ kind: "story" });

  const storyRef = useRef<typeof story>(null);
  const savedJsonRef = useRef("");

  useEffect(() => {
    storyRef.current = story;
  }, [story]);

  useEffect(() => {
    savedJsonRef.current = savedJson;
  }, [savedJson]);

  // load story.json on mount (served by Vite from the project root)
  useEffect(() => {
    const load = async () => {
      try {
        let raw: unknown;
        if (isTauri()) {
          const { invoke } = await import("@tauri-apps/api/core");
          const text = await invoke<string>("load_story");
          raw = JSON.parse(text);
        } else {
          const res = await fetch("/story.json");
          raw = await res.json();
        }
        const parsed = storySchema.parse(raw);
        setStory(parsed);
        setSavedJson(JSON.stringify(parsed));
      } catch (e) {
        setError(`Failed to load story.json: ${(e as Error).message}`);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: undefined | (() => void);

    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");
      const off = await listen<void>("story://changed", async () => {
        if (!storyRef.current) return;
        try {
          const text = await invoke<string>("load_story");
          const fresh = storySchema.parse(JSON.parse(text));
          const inMem = storyRef.current;
          const saved = JSON.parse(savedJsonRef.current) as typeof fresh;

          const userChanges = diffFields(saved, inMem);
          const agentChanges = diffFields(saved, fresh);

          if (userChanges.size === 0) {
            setStory(fresh);
            setSavedJson(JSON.stringify(fresh));
            return;
          }

          const conflicts = new Set<FieldKey>();
          const nonConflicting = new Set<FieldKey>();
          for (const f of userChanges) {
            if (agentChanges.has(f)) conflicts.add(f);
            else nonConflicting.add(f);
          }

          const merged = applyFields(fresh, inMem, nonConflicting);
          setStory(merged);

          // Flush merged result so non-conflicting user edits are on disk.
          const mergedJson = JSON.stringify(merged, null, 2);
          try {
            await invoke("save_story", { json: mergedJson });
            setSavedJson(JSON.stringify(merged));
          } catch (e) {
            setError(`Auto-merge save failed: ${(e as Error).message}`);
          }

          if (conflicts.size > 0) {
            const lines = [...conflicts].map((f) => {
              const a = JSON.stringify(readField(merged, f));
              const b = JSON.stringify(readField(inMem, f));
              return `  - ${fieldLabel(f)}: ${a} → ${b}`;
            });
            const prompt =
              "Apply my changes on top of yours:\n" + lines.join("\n") + "\n";

            const ptyId = getActivePtyId();
            if (ptyId) {
              await invoke("pty_paste_prompt", { id: ptyId, text: prompt });
            } else {
              setError(
                "Conflicts detected but terminal is not open — copy from console: " +
                  prompt,
              );
              console.warn("[merge] no active pty for prompt:", prompt);
            }
          }
        } catch (e) {
          setError(`External reload failed: ${(e as Error).message}`);
        }
      });
      unlisten = () => off();
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (!story) return;
    if (selection.kind === "beat" && selection.index >= story.beats.length) {
      setSelection({ kind: "story" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story]);

  const durationInFrames = useMemo(
    () => (story ? storyDurationInFrames(story, FPS) : 1),
    [story],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.matches("input, textarea, [contenteditable='true']") ||
          t.closest("[data-terminal-root]"))
      ) {
        return;
      }
      const p = playerRef.current;
      if (!p) return;
      const clamp = (f: number) =>
        Math.max(0, Math.min(durationInFrames - 1, f));
      if (e.code === "Space") {
        e.preventDefault();
        if (p.isPlaying()) p.pause();
        else
          p.play(
            // play() accepts SyntheticEvent | undefined; passing the
            // KeyboardEvent works at runtime and preserves user-gesture
            // context for autoplay rules.
            e as unknown as React.SyntheticEvent,
          );
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        p.seekTo(clamp(p.getCurrentFrame() - FPS));
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        p.seekTo(clamp(p.getCurrentFrame() + FPS));
      } else if (e.code === "Home") {
        e.preventDefault();
        p.seekTo(0);
      } else if (e.code === "End") {
        e.preventDefault();
        p.seekTo(clamp(durationInFrames - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [durationInFrames]);

  const dirty = useMemo(
    () => (story ? JSON.stringify(story) !== savedJson : false),
    [story, savedJson],
  );

  const handleSave = useCallback(async () => {
    if (!story) return;
    const json = JSON.stringify(story, null, 2);
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("save_story", { json });
      } else {
        const res = await fetch("/__save-story", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: json,
        });
        if (!res.ok) throw new Error(await res.text());
      }
      setSavedJson(JSON.stringify(story));
    } catch (e) {
      setError(`Save failed: ${(e as Error).message}`);
    }
  }, [story]);

  if (error) {
    return (
      <div style={{ ...fill, color: "#ff8b8b", padding: 40 }}>{error}</div>
    );
  }
  if (!story) {
    return <div style={{ ...fill, color: "#6b6b80", padding: 40 }}>Loading…</div>;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "360px 1fr 320px",
        gridTemplateRows: "1fr auto",
        width: "100vw",
        height: "100vh",
        background: "#08080c",
        color: "#e4e4ee",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {/* TERMINAL: left column, full height. */}
      <div
        style={{
          gridColumn: "1",
          gridRow: "1 / span 2",
          background: "#0a0a10",
          borderRight: "1px solid #232330",
          overflow: "hidden",
        }}
      >
        <Terminal />
      </div>

      {/* PREVIEW: center-top */}
      <div
        style={{
          gridColumn: "2",
          gridRow: "1",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 12,
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        <PlayerStage
          inputProps={story}
          durationInFrames={durationInFrames}
          fps={FPS}
          playerRef={playerRef}
        />
        <div style={{ fontSize: 11, color: "#4b4b5a" }}>
          {story.beats.length} beats ·{" "}
          {(durationInFrames / FPS).toFixed(1)}s · 1080×1920
        </div>
        <Transport
          playerRef={playerRef}
          durationInFrames={durationInFrames}
        />
      </div>

      {/* TIMELINE: center-bottom */}
      <div style={{ gridColumn: "2", gridRow: "2", minWidth: 0 }}>
        <Timeline
          story={story}
          selection={selection}
          onSelect={setSelection}
          playerRef={playerRef}
          durationInFrames={durationInFrames}
          fps={FPS}
        />
      </div>

      {/* PROPERTIES: right column, full height */}
      <div style={{ gridColumn: "3", gridRow: "1 / span 2", minWidth: 0 }}>
        <Panel
          story={story}
          selection={selection}
          onSelect={setSelection}
          onChange={setStory}
          dirty={dirty}
          onSave={handleSave}
        />
      </div>
    </div>
  );
};

const fill: React.CSSProperties = {
  width: "100vw",
  height: "100vh",
  margin: 0,
};
