import React, { useMemo, useRef } from "react";
import type { CanvasRendererProps } from "../../canvas";
import type { PulseProject } from "../../../src/pulse/schema";
import { Stage } from "../../../src/pulse/Stage";
import type { Analysis } from "../../../src/pulse/analysis";

/**
 * For the vertical slice the Renderer plays the first stem via one
 * <audio> element as the master clock and renders Deck A. The per-stem
 * gain graph and the second fullscreen stage window are the follow-up
 * plan; here a single element is enough to prove audio drives pixels.
 *
 * `analysis` and `audioSrc` are extra props supplied by PulseApp (they
 * are not part of the persisted doc), so the type widens the substrate
 * RendererProps with them.
 */
export type PulseRendererProps = CanvasRendererProps<PulseProject> & {
  analysis?: Analysis | null;
  audioSrc?: string;
};

export const Renderer: React.FC<PulseRendererProps> = (props) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const stemVolumes = useMemo(
    () => Object.fromEntries(props.doc.stems.map((s) => [s.id, s.muted ? 0 : s.volume])),
    [props.doc.stems],
  );
  const getTime = () => audioRef.current?.currentTime ?? 0;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#000" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Stage
          deck={props.doc.decks.A}
          analysis={props.analysis ?? null}
          stemVolumes={stemVolumes}
          getTime={getTime}
          width={960}
          height={540}
        />
      </div>
      {props.audioSrc && (
        <audio ref={audioRef} src={props.audioSrc} controls style={{ width: "100%" }} />
      )}
    </div>
  );
};
