/**
 * KineticApp — the kinetic-studio application's root.
 *
 * The platform mounts this when the user opens the Kinetic Studio
 * card from The Square. The platform owns the window chrome OUTSIDE
 * this component (mac traffic lights, the "Kinetic Studio" titlebar
 * label) but otherwise this component owns the whole window: project
 * lifecycle, first-run picker, projects home, editor view.
 *
 * The platform passes `onExit` for the app to use if it wants its
 * own back-to-the-marketplace affordance somewhere. The Kinetic app
 * doesn't — the platform's title bar already has that button — but
 * the prop stays in the signature to match the manifest's Root type.
 *
 * Domain knowledge: NONE in the shell layout itself. Every kinetic-
 * typography concern (beats, easings, the Player, the Panel, the
 * Timeline, the conflict labels) lives behind `activeCanvas`
 * (see editor/canvas.ts). This file is "the kinetic app" because it
 * wires the kinetic project layout, not because it knows the schema.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type PlayerRef } from "@remotion/player";
import { Transport } from "../../player";
import { Terminal, focusActiveTerminal, getActivePtyId } from "../../terminal";
import { ShellActionsContext, type ShellActions } from "../../shell";
import { perf, PerfOverlay } from "../../PerfOverlay";
import { isTauri } from "../../runtime";
import { beginColumnDrag, usePersistedColumnWidth } from "../../resize";
import { ProjectsView, type ProjectMeta } from "./ProjectsView";
import { useHistory } from "./history";
import { UndoMenu } from "../../UndoMenu";
import { FirstRun } from "../../FirstRun";
import { activeCanvas } from "../../canvas";
import type { Story } from "../../../src/kinetic/schema";
import type { Selection } from "../../selection";
import { color, focusRing, font, secondaryBtn, tabBtn } from "../../platform/theme";

const FPS = 30;

type Doc = Story;
const canvas = activeCanvas as unknown as import("../../canvas").CanvasPlugin<Doc>;

const fill: React.CSSProperties = {
  width: "100%",
  height: "100%",
  margin: 0,
};

const EditorView: React.FC<{
  project: ProjectMeta;
  onCloseProject: () => void;
}> = ({ project, onCloseProject }) => {
  const history = useHistory();
  const doc = history.story as Doc | null;
  const [savedJson, setSavedJson] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const playerRef = useRef<PlayerRef>(null);
  const [selection, setSelection] = useState<Selection>({ kind: "story" });
  const [leftTab, setLeftTab] = useState<"terminal" | "secondary">("terminal");

  const loopKey = `studio.loop.${project.path}`;
  const [loop, setLoop] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(loopKey);
      return raw === null ? true : raw === "1";
    } catch {
      return true;
    }
  });
  const onLoopChange = useCallback(
    (next: boolean) => {
      setLoop(next);
      try {
        localStorage.setItem(loopKey, next ? "1" : "0");
      } catch {
        /* ignore */
      }
    },
    [loopKey],
  );

  const setDoc = useCallback(
    (value: Doc | ((prev: Doc) => Doc)) => {
      perf.bumpStory();
      history.setStory(value as Story | ((prev: Story) => Story));
    },
    [history],
  );

  const docRef = useRef<Doc | null>(null);
  const savedJsonRef = useRef("");

  usePersistedColumnWidth({
    side: "left",
    storageKey: "studio.col.terminal",
    cssVar: "--col-terminal",
    defaultPx: 360,
    minPx: 200,
    maxPx: 800,
  });
  usePersistedColumnWidth({
    side: "right",
    storageKey: "studio.col.properties",
    cssVar: "--col-properties",
    defaultPx: 320,
    minPx: 200,
    maxPx: 600,
  });

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  useEffect(() => {
    savedJsonRef.current = savedJson;
  }, [savedJson]);

  useEffect(() => {
    const load = async () => {
      try {
        let raw: unknown;
        if (isTauri()) {
          const { invoke } = await import("@tauri-apps/api/core");
          const text = await invoke<string>("load_doc");
          raw = JSON.parse(text);
        } else {
          const res = await fetch("/" + canvas.docFilename);
          raw = await res.json();
        }
        const parsed = canvas.parse(raw);
        history.resetTo(parsed as Story);
        setSavedJson(JSON.stringify(parsed));
      } catch (e) {
        setError(`Failed to load ${canvas.docFilename}: ${(e as Error).message}`);
      }
    };
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: undefined | (() => void);
    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");
      const off = await listen<void>("doc://changed", async () => {
        if (!docRef.current) return;
        try {
          const text = await invoke<string>("load_doc");
          const fresh = canvas.parse(JSON.parse(text)) as Doc;
          setError(null);
          // Self-echo shortcut: if the disk content equals what we
          // last saved, this watcher event is just our own autosave
          // bouncing back. Don't run resolveConflict — the user's
          // in-memory state IS the latest truth, and merging against
          // a stale `saved` snapshot can revert in-flight edits when
          // the user starts a second drag before this event lands.
          if (JSON.stringify(fresh) === savedJsonRef.current) return;
          const inMem = docRef.current;
          const saved = JSON.parse(savedJsonRef.current) as Doc;
          const { merged, prompt } = canvas.resolveConflict(saved, fresh, inMem);
          setDoc(merged);
          const mergedJson = JSON.stringify(merged, null, 2);
          try {
            await invoke("save_doc", { json: mergedJson });
            setSavedJson(JSON.stringify(merged));
          } catch (e) {
            setError(`Auto-merge save failed: ${(e as Error).message}`);
          }
          if (prompt) {
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
    if (!doc) return;
    const pruned = canvas.pruneSelection(doc, selection);
    if (pruned !== selection) setSelection(pruned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  useEffect(() => {
    if (!isTauri()) return;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_selection", {
          index:
            selection.kind === "beat" && selection.indices.length > 0
              ? selection.indices[0]
              : null,
        });
      } catch {
        /* best-effort */
      }
    })();
  }, [selection]);

  useEffect(() => {
    if (selection.kind !== "beat") return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest("[data-selection-zone]")) return;
      setSelection({ kind: "story" });
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [selection]);

  const durationInFrames = useMemo(
    () => (doc ? canvas.durationInFrames(doc, FPS) : 1),
    [doc],
  );

  useEffect(() => {
    // App-owned shortcuts that win over whoever currently has focus,
    // INCLUDING xterm. Capture phase + stopImmediatePropagation
    // ensures xterm's own keydown listener never sees these keys.
    //
    // Bindings (modifier is Option / Alt on macOS):
    //   Opt+Space       — play / pause playback. Option avoids the
    //                     Ctrl+Space input-method conflict on macOS
    //                     and the SIGINT collision with Ctrl+C.
    //   ←/→/Home/End    — scrub the playhead. Skipped when the user
    //                     is typing in a real input.
    //   Delete/Backspace— delete selected beat(s). Only when focus is
    //                     outside the terminal (otherwise we'd hijack
    //                     normal prompt editing).
    //   Opt+C           — jump focus to the terminal. Works from
    //                     inside any panel including the terminal
    //                     (re-focus is a no-op there but harmless),
    //                     and DOESN'T collide with terminal Ctrl+C
    //                     SIGINT.
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inInput = !!(
        t && t.matches("input, textarea, [contenteditable='true']")
      );
      const inTerminal = !!t?.closest("[data-terminal-root]");

      // GLOBAL shortcuts — Opt+C and Opt+Space. These fire from
      // ANYWHERE, including inside the terminal, a number input, or
      // a color picker. The Option modifier means they never collide
      // with normal typing, so it's safe to run them unconditionally.
      // Both call stopImmediatePropagation so downstream consumers
      // (xterm, native inputs) never see them.

      // Opt+C — jump focus to the terminal.
      if (
        e.code === "KeyC" &&
        e.altKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setLeftTab("terminal");
        requestAnimationFrame(() => focusActiveTerminal());
        return;
      }

      // Opt+Space — play / pause.
      if (
        e.code === "Space" &&
        e.altKey &&
        !e.metaKey &&
        !e.shiftKey &&
        !e.ctrlKey
      ) {
        const p = playerRef.current;
        if (!p) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (p.isPlaying()) p.pause();
        else p.play(e as unknown as React.SyntheticEvent);
        return;
      }

      // Everything below is FOCUS-AWARE — these shortcuts use bare
      // keys (Arrows, Home, End, Delete, Backspace) that collide
      // with normal text editing. Skip them when focus is in an
      // input.
      if (inInput) return;

      // Delete / Backspace — only when a beat is selected AND focus
      // is not inside the terminal.
      if (
        (e.code === "Delete" || e.code === "Backspace") &&
        selection.kind === "beat" &&
        !inTerminal &&
        doc
      ) {
        e.preventDefault();
        const toRemove = new Set(selection.indices);
        const label =
          toRemove.size === 1
            ? `Delete "${doc.beats[selection.indices[0]]?.text ?? "beat"}"`
            : `Delete ${toRemove.size} beats`;
        const nextBeats = doc.beats.filter((_, i) => !toRemove.has(i));
        history.setStory({ ...doc, beats: nextBeats }, label);
        setSelection({ kind: "story" });
        return;
      }

      const isScrub =
        e.code === "ArrowLeft" ||
        e.code === "ArrowRight" ||
        e.code === "Home" ||
        e.code === "End";
      if (!isScrub) return;

      const p = playerRef.current;
      if (!p) return;
      e.preventDefault();
      e.stopImmediatePropagation();

      const clamp = (f: number) =>
        Math.max(0, Math.min(durationInFrames - 1, f));
      if (e.code === "ArrowLeft") {
        p.seekTo(clamp(p.getCurrentFrame() - FPS));
      } else if (e.code === "ArrowRight") {
        p.seekTo(clamp(p.getCurrentFrame() + FPS));
      } else if (e.code === "Home") {
        p.seekTo(0);
      } else if (e.code === "End") {
        p.seekTo(clamp(durationInFrames - 1));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [durationInFrames, selection, doc, history]);

  // Focus tracker. The platform doesn't force-focus the terminal —
  // we let users click into any panel and stay there. To make focus
  // visible, we highlight whichever panel currently contains it.
  // Zones: "terminal" | "panel" | "timeline" | null (none).
  const [focusedZone, setFocusedZone] = useState<
    "terminal" | "panel" | "timeline" | null
  >(null);
  useEffect(() => {
    const update = () => {
      const a = document.activeElement as HTMLElement | null;
      if (!a) {
        setFocusedZone(null);
        return;
      }
      if (a.closest("[data-terminal-root]")) {
        setFocusedZone("terminal");
        return;
      }
      const zone = a.closest("[data-selection-zone]");
      const kind = zone?.getAttribute("data-selection-zone");
      if (kind === "panel") setFocusedZone("panel");
      else if (kind === "timeline") setFocusedZone("timeline");
      else setFocusedZone(null);
    };
    update();
    window.addEventListener("focusin", update);
    window.addEventListener("focusout", update);
    return () => {
      window.removeEventListener("focusin", update);
      window.removeEventListener("focusout", update);
    };
  }, []);


  useEffect(() => {
    if (!doc) return;
    const json = JSON.stringify(doc, null, 2);
    const flat = JSON.stringify(doc);
    if (flat === savedJson) return;
    const timer = window.setTimeout(async () => {
      try {
        if (isTauri()) {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("save_doc", { json });
        } else {
          const res = await fetch("/__save-story", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: json,
          });
          if (!res.ok) throw new Error(await res.text());
        }
        setSavedJson(flat);
      } catch (e) {
        setError(`Save failed: ${(e as Error).message}`);
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [doc, savedJson]);

  const shellActions = useMemo<ShellActions>(
    () => ({
      focusTerminal: () => {
        setLeftTab("terminal");
        requestAnimationFrame(() => focusActiveTerminal());
      },
    }),
    [],
  );

  if (!doc && error) {
    return <div style={{ ...fill, color: color.danger.text, padding: 40 }}>{error}</div>;
  }
  if (!doc) {
    return <div style={{ ...fill, color: color.text.dim, padding: 40 }}>Loading…</div>;
  }

  const LeftPrelude = canvas.LeftColumnPrelude;
  const SecondaryTab = canvas.LeftColumnSecondaryTab;
  const RendererOverlay = canvas.RendererOverlay;

  return (
    <ShellActionsContext.Provider value={shellActions}>
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
        <PerfOverlay playerRef={playerRef} />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            background: color.bg.surface,
            borderBottom: `1px solid ${color.border.line}`,
            fontSize: font.size.md,
            color: color.text.muted,
            fontFamily: font.family,
            flex: "0 0 auto",
          }}
        >
          <button onClick={onCloseProject} style={secondaryBtn()}>← Projects</button>
          <UndoMenu history={history} />
          <span style={{ color: color.text.primary, fontWeight: 600 }}>{project.name}</span>
          <span
            style={{
              marginLeft: "auto",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {project.path}
          </span>
        </div>
        {error && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              padding: "8px 12px",
              background: color.danger.bg,
              borderBottom: `1px solid ${color.danger.border}`,
              color: color.danger.text,
              fontSize: font.size.sm,
              lineHeight: 1.4,
              flex: "0 0 auto",
            }}
          >
            <span style={{ fontWeight: 700 }}>⚠</span>
            <span style={{ flex: 1 }}>{error}</span>
            <button
              onClick={() => setError(null)}
              style={{
                background: "transparent",
                border: 0,
                color: color.danger.text,
                cursor: "pointer",
                fontSize: 14,
                lineHeight: 1,
                padding: 0,
              }}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "var(--col-terminal, 360px) 1fr var(--col-properties, 320px)",
            gridTemplateRows: "1fr auto",
            flex: 1,
            minHeight: 0,
            background: color.bg.canvas,
            color: color.text.secondary,
            fontFamily: font.family,
          }}
        >
          <div
            style={{
              gridColumn: "1",
              gridRow: "1 / span 2",
              background: color.bg.surface,
              borderRight: `1px solid ${color.border.line}`,
              overflow: "hidden",
              position: "relative",
              display: "flex",
              flexDirection: "column",
              boxShadow:
                focusedZone === "terminal"
                  ? focusRing
                  : "none",
              transition: "box-shadow 120ms ease",
            }}
          >
            <div
              onMouseDown={(e) =>
                beginColumnDrag(e, {
                  side: "left",
                  storageKey: "studio.col.terminal",
                  cssVar: "--col-terminal",
                  defaultPx: 360,
                  minPx: 200,
                  maxPx: 800,
                })
              }
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                right: -2,
                width: 4,
                cursor: "col-resize",
                zIndex: 10,
              }}
            />
            {LeftPrelude && <LeftPrelude />}
            {SecondaryTab && (
              <div
                style={{
                  display: "flex",
                  gap: 2,
                  padding: "4px 4px 0",
                  borderBottom: `1px solid ${color.border.line}`,
                  background: color.bg.canvas,
                  flex: "0 0 auto",
                }}
              >
                {(["terminal", "secondary"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setLeftTab(t)}
                    title={t === "terminal" ? "Focus from anywhere: Option+C" : undefined}
                    style={tabBtn(leftTab === t)}
                  >
                    {t === "secondary" ? (
                      SecondaryTab.label
                    ) : (
                      <>
                        terminal
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 600,
                            letterSpacing: 0.3,
                            color: leftTab === "terminal" ? color.text.muted : color.text.faint,
                            border: `1px solid ${leftTab === "terminal" ? color.border.strong : color.border.faint}`,
                            borderRadius: 3,
                            padding: "1px 4px",
                            textTransform: "none",
                          }}
                        >
                          ⌥C
                        </span>
                      </>
                    )}
                  </button>
                ))}
              </div>
            )}
            <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: leftTab === "terminal" || !SecondaryTab ? "block" : "none",
                }}
              >
                <Terminal />
              </div>
              {SecondaryTab && leftTab === "secondary" && (
                <div style={{ position: "absolute", inset: 0 }}>
                  <SecondaryTab.Component />
                </div>
              )}
            </div>
          </div>

          <div
            data-selection-zone="preview"
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
            <div style={{ position: "relative" }}>
              <canvas.Renderer
                doc={doc}
                durationInFrames={durationInFrames}
                fps={FPS}
                playerRef={playerRef}
                selection={selection}
                onChange={setDoc}
                loop={loop}
              />
              {RendererOverlay && (
                <RendererOverlay doc={doc} projectPath={project.path} />
              )}
            </div>
            <div style={{ fontSize: 11, color: color.text.faint }}>
              {doc.beats.length} beats · {(durationInFrames / FPS).toFixed(1)}s · 1080×1920
            </div>
            <Transport playerRef={playerRef} loop={loop} onLoopChange={onLoopChange} />
          </div>

          <div
            data-selection-zone="timeline"
            style={{
              gridColumn: "2",
              gridRow: "2",
              minWidth: 0,
              boxShadow:
                focusedZone === "timeline"
                  ? focusRing
                  : "none",
              transition: "box-shadow 120ms ease",
            }}
          >
            {canvas.Timeline && (
              <canvas.Timeline
                doc={doc}
                selection={selection}
                onSelect={setSelection}
                onChange={setDoc}
                playerRef={playerRef}
                durationInFrames={durationInFrames}
                fps={FPS}
              />
            )}
          </div>

          <div
            data-selection-zone="panel"
            style={{
              gridColumn: "3",
              gridRow: "1 / span 2",
              minWidth: 0,
              position: "relative",
              boxShadow:
                focusedZone === "panel"
                  ? focusRing
                  : "none",
              transition: "box-shadow 120ms ease",
            }}
          >
            <div
              onMouseDown={(e) =>
                beginColumnDrag(e, {
                  side: "right",
                  storageKey: "studio.col.properties",
                  cssVar: "--col-properties",
                  defaultPx: 320,
                  minPx: 200,
                  maxPx: 600,
                })
              }
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: -2,
                width: 4,
                cursor: "col-resize",
                zIndex: 10,
              }}
            />
            <canvas.Inspector
              doc={doc}
              selection={selection}
              onSelect={setSelection}
              onChange={setDoc}
            />
          </div>
        </div>
      </div>
    </ShellActionsContext.Provider>
  );
};

type Settings = {
  defaultAgent: string | null;
  onboarded: boolean;
};

// onExit is part of the platform's app contract — the back-to-The-
// Square button lives in the platform title bar (App.tsx). Kinetic
// doesn't render its own exit affordance, so the prop is unused here.
// We keep it in the signature so the manifest's Root type still
// matches.
export const KineticApp: React.FC<{ onExit: () => void }> = () => {
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      setOnboarded(true);
      return;
    }
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const s = await invoke<Settings>("get_settings");
        setOnboarded(s.onboarded);
      } catch {
        setOnboarded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let off: undefined | (() => void);
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unOpened = await listen<ProjectMeta>("project://opened", (e) => {
        setProject(e.payload);
      });
      const unClosed = await listen<null>("project://closed", () => {
        setProject(null);
      });
      off = () => {
        unOpened();
        unClosed();
      };
    })();
    return () => {
      if (off) off();
    };
  }, []);

  // Persist window size + position (debounced).
  useEffect(() => {
    if (!isTauri()) return;
    let off: undefined | (() => void);
    let timer: number | undefined;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const { invoke } = await import("@tauri-apps/api/core");
      const win = getCurrentWindow();
      const save = () => {
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(async () => {
          try {
            const maximized = await win.isMaximized();
            const size = await win.outerSize();
            const pos = await win.outerPosition();
            const factor = await win.scaleFactor();
            await invoke("save_window_state", {
              width: size.width / factor,
              height: size.height / factor,
              x: pos.x / factor,
              y: pos.y / factor,
              maximized,
            });
          } catch {
            /* best-effort */
          }
        }, 400);
      };
      const unResize = await win.onResized(save);
      const unMove = await win.onMoved(save);
      off = () => {
        unResize();
        unMove();
        if (timer) window.clearTimeout(timer);
      };
    })();
    return () => {
      if (off) off();
    };
  }, []);

  if (!isTauri()) {
    return (
      <EditorView
        project={{
          name: "Browser dev",
          path: "(browser mode)",
          beats: 0,
          lastOpened: new Date().toISOString(),
        }}
        onCloseProject={() => undefined}
      />
    );
  }

  if (onboarded === null) {
    return <div style={{ ...fill, color: color.text.dim, padding: 40 }}>Loading…</div>;
  }

  if (!onboarded) {
    return <FirstRun onDone={() => setOnboarded(true)} />;
  }

  if (project) {
    return (
      <EditorView
        key={project.path}
        project={project}
        onCloseProject={async () => {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("project_close");
        }}
      />
    );
  }
  return <ProjectsView />;
};
