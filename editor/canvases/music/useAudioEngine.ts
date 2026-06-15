import { useEffect, useRef, useState } from "react";
import { createAudioGraph, computeGains, type AudioGraph } from "../../../src/pulse/audioGraph";
import type { Stem } from "../../../src/pulse/schema";

/**
 * Builds a multi-stem AudioGraph from the project's stems and keeps its
 * gains in sync with the live stem volumes/mutes. Rebuilds only when the
 * stem set (ids) changes — volume changes just retune gains. Returns the
 * graph (null until decoded) so callers can drive the shared clock.
 */
export function useAudioEngine(stems: Stem[], urlFor: (file: string) => string): AudioGraph | null {
  const [graph, setGraph] = useState<AudioGraph | null>(null);
  const graphRef = useRef<AudioGraph | null>(null);
  const ids = stems.map((s) => s.id).join(",");

  useEffect(() => {
    let alive = true;
    if (stems.length === 0) {
      setGraph(null);
      return;
    }
    void (async () => {
      try {
        const g = await createAudioGraph(stems.map((s) => ({ id: s.id, url: urlFor(s.file) })));
        if (!alive) {
          g.dispose();
          return;
        }
        graphRef.current = g;
        setGraph(g);
      } catch {
        /* decode failure leaves graph null; preview shows a black canvas */
      }
    })();
    return () => {
      alive = false;
      graphRef.current?.dispose();
      graphRef.current = null;
      setGraph(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  useEffect(() => {
    graph?.setGains(computeGains(stems));
  }, [graph, stems]);

  return graph;
}
