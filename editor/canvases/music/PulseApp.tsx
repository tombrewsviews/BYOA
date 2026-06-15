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

  // Transition animation loop: while releasing, advance mix.progress; at the
  // end, promote Deck B to Deck A and reset.
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
      if (next >= 1) {
        // Promote B → A, reset B, go live on A.
        setDoc((p) =>
          p
            ? {
                ...p,
                decks: { A: p.decks.B, B: { effects: [] } },
                mix: { ...p.mix, active: "A", progress: 0 },
              }
            : p,
        );
        return;
      }
      setDoc((p) => (p ? { ...p, mix: { ...p.mix, progress: next } } : p));
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

  const onRelease = useCallback(() => {
    // Best-effort: snapshot project.json into git history, then start the
    // templated A→B transition. Effect-code commits are the agent's job; the
    // app-level release is the visual handoff.
    void (async () => {
      if (isTauri()) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("git_commit_all", { repo: project.path, message: "pulse: release deck B" }).catch(() => {});
        } catch {
          /* not a git repo — fine */
        }
      }
    })();
    setDoc((p) => (p ? { ...p, mix: { ...p.mix, active: "transitioning", progress: 0 } } : p));
  }, [project.path]);

  const openStage = useCallback(async () => {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_stage_window").catch(() => {});
  }, []);

  // Mirror play/pause to the stage window.
  const togglePlay = useCallback(() => {
    if (!engine) return;
    if (engine.isPlaying()) {
      engine.pause();
      void emit("pulse://pause");
    } else {
      engine.play();
      void emit("pulse://play");
    }
  }, [engine]);

  const update = (next: PulseProject | ((prev: PulseProject) => PulseProject)) =>
    setDoc((prev) => (typeof next === "function" ? next(prev as PulseProject) : next));

  if (!doc) return <div style={{ padding: 40, color: "#888" }}>Loading…</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr 320px", gridTemplateRows: "1fr auto", height: "100%", background: "#000" }}>
      {/* Left: import + transport + agent terminal */}
      <div style={{ gridRow: "1 / span 2", borderRight: "1px solid #222", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ padding: 8, borderBottom: "1px solid #222", display: "flex", flexDirection: "column", gap: 6 }}>
          <button onClick={pickAndImport} style={{ padding: 8 }}>Import stems folder…</button>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={togglePlay} style={{ flex: 1, padding: 6 }} disabled={!engine}>
              {engine?.isPlaying() ? "Pause" : "Play"}
            </button>
            <button onClick={openStage} style={{ flex: 1, padding: 6 }}>Open Stage ⤢</button>
          </div>
          {status && <div style={{ fontSize: 12, color: "#9ad" }}>{status}</div>}
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <Terminal />
        </div>
      </div>

      {/* Center: preview (Deck B / transition blend) */}
      <div style={{ minWidth: 0, minHeight: 0 }}>
        <Renderer doc={doc} analysis={analysis} engine={engine} previewDeck="B" />
      </div>

      {/* Right: inspector (stems / deck A / deck B) + mix panel */}
      <div style={{ gridRow: "1 / span 2", borderLeft: "1px solid #222", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ flex: 1, minHeight: 0 }}>
          <Inspector doc={doc} selection={STORY_SELECTION} onSelect={() => {}} onChange={update} />
        </div>
        <MixPanel doc={doc} onChange={update} onRelease={onRelease} />
      </div>

      {/* Bottom-center: timeline */}
      <div style={{ gridColumn: "2", borderTop: "1px solid #222" }}>
        <Timeline analysis={analysis} engine={engine} />
      </div>
    </div>
  );
};

const PulseBootstrap: React.FC<{ onReady: (m: ProjectMeta) => void }> = ({ onReady }) => {
  useEffect(() => {
    void (async () => {
      if (!isTauri()) return;
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        const list = await invoke<ProjectMeta[]>("projects_list").catch(() => [] as ProjectMeta[]);
        const existing = Array.isArray(list) ? list.find((p) => p.path) : null;
        const meta =
          existing ??
          (await invoke<ProjectMeta>("projects_create", { name: "Pulse Session", canvas: "pulse" }));
        await invoke("project_open", { path: meta.path }).catch(() => {});
        onReady(meta);
      } catch {
        /* surfaced via Loading */
      }
    })();
  }, [onReady]);
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
