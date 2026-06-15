import React, { useEffect, useRef } from "react";
import type { Analysis } from "../../../src/pulse/analysis";
import type { AudioGraph } from "../../../src/pulse/audioGraph";

/**
 * Song timeline: master level envelope (max across stems) as a waveform,
 * beat-grid lines, onset ticks, and a live playhead. Click to seek.
 */
export const Timeline: React.FC<{
  analysis: Analysis | null;
  engine: AudioGraph | null;
  height?: number;
}> = ({ analysis, engine, height = 90 }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);

  useEffect(() => {
    const cvs = ref.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    const draw = () => {
      const w = cvs.width;
      const h = cvs.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, w, h);
      if (analysis && analysis.stems.length) {
        const n = analysis.stems[0].level.length;
        ctx.strokeStyle = "#3a6";
        ctx.beginPath();
        for (let x = 0; x < w; x++) {
          const i = Math.floor((x / w) * n);
          let lvl = 0;
          for (const s of analysis.stems) lvl = Math.max(lvl, s.level[i] ?? 0);
          const y = h - lvl * h;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        const dur = Math.max(0.01, analysis.durationSec);
        ctx.strokeStyle = "#244";
        for (const t of analysis.beatTimesSec) {
          const x = (t / dur) * w;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        ctx.fillStyle = "#fa0";
        for (const s of analysis.stems)
          for (const o of s.onsets) {
            const x = (o / dur) * w;
            ctx.fillRect(x, h - 4, 1, 4);
          }
      }
      if (engine) {
        const x = (engine.currentTime() / Math.max(0.01, engine.duration())) * w;
        ctx.strokeStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      raf.current = requestAnimationFrame(draw);
    };
    raf.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf.current);
  }, [analysis, engine]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!engine) return;
    const r = e.currentTarget.getBoundingClientRect();
    engine.seek(((e.clientX - r.left) / r.width) * engine.duration());
  };

  return (
    <canvas
      ref={ref}
      width={1200}
      height={height}
      onClick={onClick}
      style={{ width: "100%", height, display: "block", cursor: "pointer" }}
    />
  );
};
