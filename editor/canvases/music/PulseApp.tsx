import React, { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "../../runtime";
import { Terminal } from "../../terminal";
import { musicCanvas } from "./index";
import { seedProject, type PulseProject } from "../../../src/pulse/schema";
import type { Analysis } from "../../../src/pulse/analysis";
import { runAnalysis } from "./import";
import { Renderer } from "./Renderer";
import { Inspector } from "./Inspector";
import { Timeline } from "./Timeline";
import { MixPanel } from "./MixPanel";
import { useAudioEngine } from "./useAudioEngine";
import { blendDecks, shapeCurve } from "../../../src/pulse/transitions";
import { Button } from "@/components/ui/button";
import { Folder, Play, Pause } from "../../icons";
import type { Selection } from "../../selection";

type ProjectMeta = { name: string; path: string };
type ImportedStem = { id: string; file: string; sourceName: string };

const STORY_SELECTION: Selection = { kind: "story" };

// Fire a Tauri event (best-effort) so the stage window mirrors the main one.
async function emit(name: string, payload?: unknown) {
  if (!isTauri()) return;
  try {
    const { emit } = await import("@tauri-apps/api/event");
    await emit(name, payload);
  } catch {
    /* stage window may not be open */
  }
}

const PulseEditor: React.FC<{ project: ProjectMeta }> = ({ project }) => {
  const [doc, setDoc] = useState<PulseProject | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [convert, setConvert] = useState<((p: string) => string) | null>(null);
  const [status, setStatus] = useState<string>("");
  const [loop, setLoop] = useState(true); // loop ON by default
  const [isPlaying, setIsPlaying] = useState(false);
  const [leftW, setLeftW] = useState(300); // terminal panel width (drag right edge)
  const [rightW, setRightW] = useState(380); // properties panel width (drag left edge)
  const savedRef = useRef("");
  const docRef = useRef<PulseProject | null>(null);
  docRef.current = doc;

  // Resolve convertFileSrc once (URLs for stems/analysis).
  useEffect(() => {
    void (async () => {
      if (!isTauri()) {
        setConvert(() => (p: string) => p);
        return;
      }
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      setConvert(() => (p: string) => convertFileSrc(p));
    })();
  }, []);

  // Load existing project.json + analysis.json if present.
  useEffect(() => {
    void (async () => {
      if (!isTauri()) {
        setDoc(seedProject("(browser)"));
        return;
      }
      const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
      try {
        const text = await invoke<string>("load_doc");
        const parsed = musicCanvas.parse(JSON.parse(text));
        setDoc(parsed);
        savedRef.current = JSON.stringify(parsed);
        try {
          const ares = await fetch(convertFileSrc(`${project.path}/analysis.json`));
          if (ares.ok) setAnalysis((await ares.json()) as Analysis);
        } catch {
          /* no analysis yet */
        }
      } catch {
        setDoc(seedProject(""));
      }
    })();
  }, [project.path]);

  // Audio engine: one gain-per-stem graph, gains synced to live volumes.
  const urlFor = useCallback(
    (file: string) => (convert ? convert(`${project.path}/stems/${file}`) : ""),
    [convert, project.path],
  );
  const engine = useAudioEngine(doc?.stems ?? [], urlFor);

  // Apply loop state to the engine (and when a fresh engine is created).
  useEffect(() => {
    engine?.setLoop(loop);
  }, [engine, loop]);

  const toggleLoop = useCallback(() => {
    setLoop((on) => {
      const next = !on;
      engine?.setLoop(next);
      return next;
    });
  }, [engine]);

  // Autosave project.json (debounced) + mirror to the stage window.
  useEffect(() => {
    if (!doc || !isTauri()) return;
    const flat = JSON.stringify(doc);
    if (flat === savedRef.current) return;
    void emit("pulse://doc", doc);
    const t = window.setTimeout(async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("save_doc", { json: JSON.stringify(doc, null, 2) });
        savedRef.current = flat;
      } catch {
        /* quiet for the slice */
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [doc]);

  // Transition animation loop. "Send Bench → Preview" snapshots Deck A into
  // `pendingB` and transitions the preview's Deck B from its old look to that
  // snapshot over mix.durationSec. The bench (Deck A) is never altered. We
  // push the interpolated Deck B to the preview window each frame via
  // `pulse://doc`. At t=1, Deck B becomes the snapshot.
  const pendingBRef = useRef<PulseProject["decks"]["B"] | null>(null);
  const oldBRef = useRef<PulseProject["decks"]["B"] | null>(null);
  useEffect(() => {
    if (doc?.mix.active !== "transitioning") return;
    let last = -1;
    let raf = 0;
    const tick = (ts: number) => {
      const cur = docRef.current;
      if (!cur || cur.mix.active !== "transitioning") return;
      if (last < 0) last = ts;
      const dt = (ts - last) / 1000;
      last = ts;
      const step = dt / Math.max(0.2, cur.mix.durationSec);
      const next = cur.mix.progress + step;
      const target = pendingBRef.current ?? cur.decks.A;
      const oldB = oldBRef.current ?? { effects: [] };
      if (next >= 1) {
        // Preview's Deck B is now the snapshot; transition done.
        setDoc((p) => (p ? { ...p, decks: { ...p.decks, B: target }, mix: { ...p.mix, active: "A", progress: 0 } } : p));
        pendingBRef.current = null;
        oldBRef.current = null;
        return;
      }
      const blended = blendDecks(oldB, target, shapeCurve(next, cur.mix.curve), cur.mix.template);
      setDoc((p) => (p ? { ...p, decks: { ...p.decks, B: blended }, mix: { ...p.mix, progress: next } } : p));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [doc?.mix.active]);

  const pickAndImport = useCallback(async () => {
    if (!isTauri()) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const folder = await open({ directory: true, title: "Choose a folder of stems" });
    if (!folder || typeof folder !== "string") return;
    const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
    setStatus("Importing stems…");
    const imported = await invoke<ImportedStem[]>("pulse_import", {
      projectPath: project.path,
      folder,
    });
    setStatus("Analyzing…");
    const { analysis: result } = await runAnalysis((p) => convertFileSrc(p), project.path, imported);
    await invoke("pulse_write_analysis", {
      projectPath: project.path,
      json: JSON.stringify(result),
    });
    setDoc((prev): PulseProject => {
      const base = prev ?? seedProject(folder);
      const firstStemId = result.stems[0]?.id ?? "master";
      return {
        ...base,
        song: { ...base.song, sourceFolder: folder, durationSec: result.durationSec },
        stems: result.stems.map((s) => ({
          id: s.id,
          file: s.file,
          label: imported.find((i) => i.id === s.id)?.sourceName ?? s.id,
          role: s.role,
          volume: 1,
          muted: false,
        })),
        decks: {
          A: {
            effects: [
              {
                id: "fx-wave",
                type: "wave",
                enabled: true,
                locked: false,
                params: { amplitude: 0.15, wavelength: 0.2 },
                bindings: [
                  { param: "amplitude", source: { stem: "master", feature: "level" }, amount: 0.3, curve: "linear", offset: 0 },
                ],
              },
              {
                id: "fx-px",
                type: "pixelate",
                enabled: true,
                locked: false,
                params: { pixelSize: 12, falloff: 0.3 },
                bindings: [
                  { param: "pixelSize", source: { stem: firstStemId, feature: "bandLow" }, amount: 30, curve: "linear", offset: 0 },
                ],
              },
            ],
          },
          B: { effects: [] },
        },
      };
    });
    setAnalysis(result);
    setStatus("");
  }, [project.path]);

  // Send the current bench (Deck A) to the live Preview window (Deck B),
  // animating the chosen transition. Snapshots A as the target and the
  // current B as the starting look; the transition loop interpolates.
  const onSendToPreview = useCallback(() => {
    const cur = docRef.current;
    if (!cur) return;
    pendingBRef.current = cur.decks.A;
    oldBRef.current = cur.decks.B;
    void (async () => {
      if (isTauri()) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("git_commit_all", { repo: project.path, message: "pulse: send bench to preview" }).catch(() => {});
        } catch {
          /* not a git repo — fine */
        }
      }
    })();
    setDoc((p) => (p ? { ...p, mix: { ...p.mix, active: "transitioning", progress: 0 } } : p));
  }, [project.path]);

  const onOpenPreview = useCallback(async () => {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_stage_window").catch(() => {});
    // Push current doc so the freshly-opened window has state immediately.
    if (docRef.current) void emit("pulse://doc", docRef.current);
  }, []);

  // Mirror play/pause to the preview window. Tracks isPlaying in React state
  // so the transport button re-renders (engine.isPlaying() alone is a ref read
  // that doesn't trigger a render).
  const togglePlay = useCallback(() => {
    if (!engine) return;
    if (engine.isPlaying()) {
      engine.pause();
      setIsPlaying(false);
      void emit("pulse://pause");
      void emit("pulse://time", engine.currentTime()); // land preview on the paused frame
    } else {
      engine.play();
      setIsPlaying(true);
      void emit("pulse://play");
    }
  }, [engine]);

  // Broadcast the master clock to the preview window every frame while
  // playing. The preview owns no audio engine — it renders from this time, so
  // there is no second copy of the song and its visuals stay in sync.
  useEffect(() => {
    if (!engine || !isPlaying) return;
    let raf = 0;
    const tick = () => {
      void emit("pulse://time", engine.currentTime());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, isPlaying]);

  // Shift+Space toggles play/pause from anywhere in the editor (plain Space is
  // left alone so it still works in text inputs / the terminal).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.shiftKey) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay]);

  const update = (next: PulseProject | ((prev: PulseProject) => PulseProject)) =>
    setDoc((prev) => (typeof next === "function" ? next(prev as PulseProject) : next));

  // Resolve a media effect's relative `src` (under <project>/assets/) to a
  // webview-loadable URL for the Stage to texture.
  const mediaUrlFor = useCallback(
    (effect: PulseProject["decks"]["A"]["effects"][number]) =>
      effect.src && convert ? convert(`${project.path}/${effect.src}`) : null,
    [convert, project.path],
  );

  // Drag a panel edge to resize. `side` says whether the panel grows as the
  // pointer moves right ("left" panel) or left ("right" panel). Clamped so a
  // panel can't swallow the bench.
  const startDrag = (side: "left" | "right", set: (w: number) => void) =>
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = side === "left" ? leftW : rightW;
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const w = side === "left" ? startW + dx : startW - dx;
        set(Math.max(200, Math.min(640, w)));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
      };
      document.body.style.cursor = "col-resize";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };

  if (!doc) return <div style={{ padding: 40, color: "#888" }}>Loading…</div>;

  return (
    <div
      style={{
        display: "grid",
        // left | handle | bench | handle | right
        gridTemplateColumns: `${leftW}px 5px minmax(0, 1fr) 5px ${rightW}px`,
        gridTemplateRows: "minmax(0, 1fr) auto",
        height: "100%",
        background: "#000",
      }}
    >
      {/* LEFT (col 1, both rows): import + transport + agent terminal */}
      <div
        style={{
          gridColumn: 1,
          gridRow: "1 / span 2",
          borderRight: "1px solid #222",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div className="flex flex-none flex-col gap-2 border-b border-border p-2">
          <Button onClick={pickAndImport} variant="secondary" size="sm" className="w-full">
            <Folder />
            Import stems folder…
          </Button>
          <div className="flex gap-2">
            <Button onClick={togglePlay} variant="secondary" size="sm" className="flex-1" disabled={!engine}>
              {isPlaying ? <Pause /> : <Play />}
              {isPlaying ? "Pause" : "Play"}
            </Button>
            <Button
              onClick={toggleLoop}
              variant={loop ? "default" : "outline"}
              size="sm"
              disabled={!engine}
              title="Loop the song"
            >
              ↻ Loop
            </Button>
          </div>
          {status && <div className="text-ui-sm text-sky-400">{status}</div>}
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <Terminal />
        </div>
      </div>

      {/* HANDLE (col 2): drag to resize the terminal panel's right edge */}
      <div
        onMouseDown={startDrag("left", setLeftW)}
        title="Drag to resize"
        style={{ gridColumn: 2, gridRow: "1 / span 2", cursor: "col-resize", background: "transparent" }}
      />

      {/* CENTER (col 3, row 1): the BENCH — Deck A live preview */}
      <div style={{ gridColumn: 3, gridRow: 1, minWidth: 0, minHeight: 0 }}>
        <Renderer doc={doc} analysis={analysis} engine={engine} previewDeck="A" mediaUrlFor={mediaUrlFor} />
      </div>

      {/* CENTER (col 3, row 2): waveform timeline */}
      <div style={{ gridColumn: 3, gridRow: 2, borderTop: "1px solid #222", minWidth: 0 }}>
        <Timeline analysis={analysis} engine={engine} />
      </div>

      {/* HANDLE (col 4): drag to resize the properties panel's left edge */}
      <div
        onMouseDown={startDrag("right", setRightW)}
        title="Drag to resize"
        style={{ gridColumn: 4, gridRow: "1 / span 2", cursor: "col-resize", background: "transparent" }}
      />

      {/* RIGHT (col 5, both rows): the stem rack + preview-window panel */}
      <div
        style={{
          gridColumn: 5,
          gridRow: "1 / span 2",
          borderLeft: "1px solid #222",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <Inspector doc={doc} selection={STORY_SELECTION} onSelect={() => {}} onChange={update} />
        </div>
        <MixPanel doc={doc} onChange={update} onOpenPreview={onOpenPreview} onSendToPreview={onSendToPreview} />
      </div>
    </div>
  );
};

const PulseBootstrap: React.FC<{ onReady: (m: ProjectMeta) => void }> = ({ onReady }) => {
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      if (!isTauri()) return;
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        // IMPORTANT: only ever open a PULSE project. The projects pool is
        // shared with kinetic (which uses story.json); picking the first
        // project would open a kinetic project with no stems. We ask the
        // backend specifically for pulse projects (project.json).
        const list = await invoke<ProjectMeta[]>("projects_list", { canvas: "pulse" }).catch(
          () => [] as ProjectMeta[],
        );
        const existing = Array.isArray(list) && list.length > 0 ? list[0] : null;
        const meta =
          existing ??
          (await invoke<ProjectMeta>("projects_create", { name: "Pulse Session", canvas: "pulse" }));
        await invoke("project_open", { path: meta.path }).catch(() => {});
        onReady(meta);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, [onReady]);
  if (err) return <div style={{ padding: 40, color: "#e66" }}>Pulse failed to open a project: {err}</div>;
  return <div style={{ padding: 40, color: "#888" }}>Opening Pulse session…</div>;
};

export const PulseApp: React.FC<{ onExit: () => void }> = () => {
  const [project, setProject] = useState<ProjectMeta | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      setProject({ name: "Browser", path: "(browser)" });
      return;
    }
    let off: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const un = await listen<ProjectMeta>("project://opened", (e) => setProject(e.payload));
      off = () => un();
    })();
    return () => {
      if (off) off();
    };
  }, []);

  if (!project) return <PulseBootstrap onReady={setProject} />;
  return <PulseEditor key={project.path} project={project} />;
};
