import React, { useEffect, useRef, useState } from "react";
import { Stage } from "../../../src/pulse/Stage";
import { pulseProjectSchema, type PulseProject } from "../../../src/pulse/schema";
import type { Analysis } from "../../../src/pulse/analysis";
import { computeGains } from "../../../src/pulse/audioGraph";

/**
 * The fullscreen live "stage" — rendered in a separate Tauri window on
 * the `/stage` route. Loads the active project's doc + analysis and renders
 * the live deck (Deck B, the sent look). It owns NO audio engine: the main
 * window plays the only copy of the song and broadcasts its clock via
 * `pulse://time`, which we use to drive the visuals. This keeps the preview
 * silent (no double audio) and in sync, and responds to `pulse://seek|doc`.
 */
export const StageWindow: React.FC = () => {
  const [doc, setDoc] = useState<PulseProject | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const timeRef = useRef(0); // master clock pushed from the main window
  const hostRef = useRef<HTMLDivElement>(null);
  const [mediaUrlFor, setMediaUrlFor] = useState<((e: PulseProject["decks"]["A"]["effects"][number]) => string | null) | undefined>(undefined);

  // Size the canvas to the host element via ResizeObserver (not window
  // dimensions): the Tauri window's final size can race with the webview load,
  // and a stale size gives a squeezed/stretched render. The observer fires
  // with the element's true box whenever it settles.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
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
          setMediaUrlFor(() => (e: PulseProject["decks"]["A"]["effects"][number]) =>
            e.src ? convertFileSrc(`${path}/${e.src}`) : null);
          try {
            const r = await fetch(convertFileSrc(`${path}/analysis.json`));
            if (r.ok) setAnalysis((await r.json()) as Analysis);
          } catch {
            /* no analysis */
          }
        }
      } catch {
        /* no project open yet */
      }
      // Clock + seek come from the main window; no local audio engine.
      const un1 = await listen<number>("pulse://time", (e) => { timeRef.current = e.payload; });
      const un2 = await listen<number>("pulse://seek", (e) => { timeRef.current = e.payload; });
      const un3 = await listen<PulseProject>("pulse://doc", (e) => setDoc(e.payload));
      cleanup = () => {
        un1();
        un2();
        un3();
      };
    })();
    return () => cleanup?.();
  }, []);

  const toggleFullscreen = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const w = getCurrentWindow();
      const fs = await w.isFullscreen();
      await w.setFullscreen(!fs);
    } catch {
      /* not in tauri */
    }
  };

  if (!doc) {
    return (
      <div style={{ width: "100vw", height: "100vh", background: "#000", color: "#444", display: "grid", placeItems: "center" }}>
        Pulse Preview — open a project in the main window
      </div>
    );
  }

  // Which deck the preview shows depends on the project's sync mode:
  //  - "continuous": mirror the bench (Deck A) live — every edit shows here.
  //  - "manual": render only what was sent (Deck B). Deck B is empty until
  //    the first "Send Bench → Preview", so the preview stays black until then
  //    and bench edits never leak in. During a send the transition loop pushes
  //    the interpolated Deck B via pulse://doc, so we render it directly.
  const deck = doc.mix.previewSync === "manual" ? doc.decks.B : doc.decks.A;

  return (
    <div ref={hostRef} style={{ width: "100vw", height: "100vh", background: "#000" }} onDoubleClick={toggleFullscreen}>
      <Stage
        deck={deck}
        analysis={analysis}
        stemVolumes={computeGains(doc.stems)}
        getTime={() => timeRef.current}
        width={size.w}
        height={size.h}
        mediaUrlFor={mediaUrlFor}
      />
    </div>
  );
};
