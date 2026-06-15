import React, { useEffect, useRef, useState } from "react";
import { Stage } from "../../../src/pulse/Stage";
import { pulseProjectSchema, type PulseProject } from "../../../src/pulse/schema";
import type { Analysis } from "../../../src/pulse/analysis";
import { createAudioGraph, computeGains, type AudioGraph } from "../../../src/pulse/audioGraph";
import { blendDecks, shapeCurve } from "../../../src/pulse/transitions";

/**
 * The fullscreen live "stage" — rendered in a separate Tauri window on
 * the `/stage` route. Loads the active project's doc + analysis, builds
 * its own audio engine, and renders the live deck (Deck A, or the
 * transition blend while releasing). It owns its own clock and responds
 * to `pulse://play|pause|seek|doc` events from the main window so the
 * show stays roughly in sync. Sample-exact sync isn't required for a
 * visual performance.
 */
export const StageWindow: React.FC = () => {
  const [doc, setDoc] = useState<PulseProject | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [engine, setEngine] = useState<AudioGraph | null>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const engineRef = useRef<AudioGraph | null>(null);
  engineRef.current = engine;

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void (async () => {
      const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");
      try {
        const text = await invoke<string>("load_doc");
        const d = pulseProjectSchema.parse(JSON.parse(text));
        setDoc(d);
        const path = await invoke<string>("active_project_path").catch(() => "");
        if (path) {
          try {
            const r = await fetch(convertFileSrc(`${path}/analysis.json`));
            if (r.ok) setAnalysis((await r.json()) as Analysis);
          } catch {
            /* no analysis */
          }
          if (d.stems.length) {
            const g = await createAudioGraph(
              d.stems.map((s) => ({ id: s.id, url: convertFileSrc(`${path}/stems/${s.file}`) })),
            );
            g.setGains(computeGains(d.stems));
            setEngine(g);
          }
        }
      } catch {
        /* no project open yet */
      }
      const un1 = await listen("pulse://play", () => engineRef.current?.play());
      const un2 = await listen("pulse://pause", () => engineRef.current?.pause());
      const un3 = await listen<number>("pulse://seek", (e) => engineRef.current?.seek(e.payload));
      const un4 = await listen<PulseProject>("pulse://doc", (e) => setDoc(e.payload));
      cleanup = () => {
        un1();
        un2();
        un3();
        un4();
      };
    })();
    return () => cleanup?.();
  }, []);

  if (!doc) {
    return (
      <div style={{ width: "100vw", height: "100vh", background: "#000", color: "#444", display: "grid", placeItems: "center" }}>
        Pulse Stage — open a project in the main window
      </div>
    );
  }

  const deck =
    doc.mix.active === "transitioning"
      ? blendDecks(doc.decks.A, doc.decks.B, shapeCurve(doc.mix.progress, doc.mix.curve), doc.mix.template)
      : doc.decks.A;

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#000" }}>
      <Stage
        deck={deck}
        analysis={analysis}
        stemVolumes={computeGains(doc.stems)}
        getTime={() => engine?.currentTime() ?? 0}
        width={size.w}
        height={size.h}
      />
    </div>
  );
};
