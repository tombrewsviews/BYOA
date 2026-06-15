import React, { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "../../runtime";
import { Terminal } from "../../terminal";
import type { PlayerRef } from "@remotion/player";
import { musicCanvas } from "./index";
import { seedProject, type PulseProject } from "../../../src/pulse/schema";
import type { Analysis } from "../../../src/pulse/analysis";
import { runAnalysis } from "./import";
import { Renderer } from "./Renderer";
import { Inspector } from "./Inspector";
import type { Selection } from "../../selection";

type ProjectMeta = { name: string; path: string };
type ImportedStem = { id: string; file: string; sourceName: string };

const STORY_SELECTION: Selection = { kind: "story" };
const NULL_PLAYER_REF = { current: null } as React.RefObject<PlayerRef | null>;

const PulseEditor: React.FC<{ project: ProjectMeta }> = ({ project }) => {
  const [doc, setDoc] = useState<PulseProject | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | undefined>();
  const [status, setStatus] = useState<string>("");
  const savedRef = useRef("");

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
        if (parsed.stems[0]) {
          setAudioSrc(convertFileSrc(`${project.path}/stems/${parsed.stems[0].file}`));
        }
      } catch {
        setDoc(seedProject(""));
      }
    })();
  }, [project.path]);

  // Autosave project.json (debounced), mirroring the kinetic loop.
  useEffect(() => {
    if (!doc || !isTauri()) return;
    const flat = JSON.stringify(doc);
    if (flat === savedRef.current) return;
    const t = window.setTimeout(async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("save_doc", { json: JSON.stringify(doc, null, 2) });
        savedRef.current = flat;
      } catch {
        /* surfaced elsewhere; slice keeps it quiet */
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [doc]);

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
    const { analysis: result } = await runAnalysis(
      (p) => convertFileSrc(p),
      project.path,
      imported,
    );
    await invoke("pulse_write_analysis", {
      projectPath: project.path,
      json: JSON.stringify(result),
    });
    setDoc((prev): PulseProject => {
      const base = prev ?? seedProject(folder);
      const firstStemId = result.stems[0]?.id ?? "master";
      const next: PulseProject = {
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
                  {
                    param: "amplitude",
                    source: { stem: "master", feature: "level" },
                    amount: 0.3,
                    curve: "linear",
                    offset: 0,
                  },
                ],
              },
              {
                id: "fx-px",
                type: "pixelate",
                enabled: true,
                locked: false,
                params: { pixelSize: 12, falloff: 0.3 },
                bindings: [
                  {
                    param: "pixelSize",
                    source: { stem: firstStemId, feature: "bandLow" },
                    amount: 30,
                    curve: "linear",
                    offset: 0,
                  },
                ],
              },
            ],
          },
          B: { effects: [] },
        },
      };
      return next;
    });
    setAnalysis(result);
    setAudioSrc(convertFileSrc(`${project.path}/stems/${imported[0].file}`));
    setStatus("");
  }, [project.path]);

  if (!doc) return <div style={{ padding: 40, color: "#888" }}>Loading…</div>;

  // Non-null updater for the canvas components (doc is guaranteed set here).
  // The substrate onChange is (next | (prev => next)) => void with a
  // non-null Doc; setDoc's type includes null, so adapt it.
  const updateDoc = (next: PulseProject | ((prev: PulseProject) => PulseProject)) =>
    setDoc((prev) => (typeof next === "function" ? next(prev as PulseProject) : next));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr 300px", height: "100%", background: "#000" }}>
      <div style={{ borderRight: "1px solid #222", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ padding: 8, borderBottom: "1px solid #222" }}>
          <button onClick={pickAndImport} style={{ width: "100%", padding: 8 }}>
            Import stems folder…
          </button>
          {status && <div style={{ marginTop: 6, fontSize: 12, color: "#9ad" }}>{status}</div>}
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <Terminal />
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        <Renderer
          doc={doc}
          analysis={analysis}
          audioSrc={audioSrc}
          durationInFrames={Math.max(1, Math.round((doc.song.durationSec || 0) * 60))}
          fps={60}
          playerRef={NULL_PLAYER_REF}
          selection={STORY_SELECTION}
          onChange={updateDoc}
          loop
        />
      </div>
      <div style={{ borderLeft: "1px solid #222", minHeight: 0 }}>
        <Inspector doc={doc} selection={STORY_SELECTION} onSelect={() => {}} onChange={updateDoc} />
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
        const list = await invoke<ProjectMeta[]>("projects_list").catch(
          () => [] as ProjectMeta[],
        );
        const existing = Array.isArray(list) ? list.find((p) => p.path) : null;
        const meta =
          existing ??
          (await invoke<ProjectMeta>("projects_create", { name: "Pulse Session", canvas: "pulse" }));
        await invoke("project_open", { path: meta.path }).catch(() => {});
        onReady(meta);
      } catch {
        /* surfaced via the Loading state */
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
