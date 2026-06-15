// src/pulse/Stage.tsx
import React, { useEffect, useRef } from "react";
import { EFFECTS } from "./effects/registry";
import { resolveParam } from "./bindings";
import type { Deck } from "./schema";
import type { Analysis } from "./analysis";
import { sampleFeatures, type FeatureFrame } from "./featureBus";

export type DeckPass = { type: string; frag: string; effect: Deck["effects"][number]; descriptor: (typeof EFFECTS)[string] };

export function passAlpha(e: { params: Record<string, number> }): number {
  const a = e.params._alpha;
  return a == null ? 1 : Math.max(0, Math.min(1, a));
}

// Pure helper (unit-tested): deck -> ordered render passes.
export function buildDeckPasses(deck: Deck): DeckPass[] {
  const out: DeckPass[] = [];
  for (const e of deck.effects) {
    if (!e.enabled) continue;
    const d = EFFECTS[e.type];
    if (!d) continue;
    out.push({ type: e.type, frag: d.frag, effect: e, descriptor: d });
  }
  return out;
}

const VERT = `#version 300 es
in vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Convert a GLSL1-style fragment shader to GLSL ES 3.00. Two ordering rules
// both matter, or it fails to compile:
//   - `out vec4 outColor;` must be declared at global scope BEFORE main()
//     (used-before-declared -> "'outColor' : undeclared identifier"), and
//   - it must come AFTER `precision highp float;` (a float-typed decl before
//     any precision stmt -> "No precision specified for (float)").
// So we splice the out-decl in right after the first `precision ...;` line.
const wrap = (frag: string) => {
  if (frag.startsWith("#version")) return frag;
  const body = frag.replaceAll("gl_FragColor", "outColor").replaceAll("texture2D", "texture");
  const withOut = /precision[^;]*;/.test(body)
    ? body.replace(/(precision[^;]*;)/, "$1\nout vec4 outColor;")
    : `precision highp float;\nout vec4 outColor;\n${body}`;
  return `#version 300 es\n${withOut}`;
};

type StageProps = {
  deck: Deck;
  analysis: Analysis | null;
  stemVolumes: Record<string, number>;
  getTime: () => number;
  width: number; height: number;
  // Resolves a media effect's `src` to a loadable URL (host knows the project
  // path). Returns null/undefined for effects with no media or no src yet.
  mediaUrlFor?: (effect: Deck["effects"][number]) => string | null | undefined;
};

// Per-media-effect element + GL texture, cached so we don't reload every frame.
type MediaSlot = { el: HTMLImageElement | HTMLVideoElement; tex: WebGLTexture; url: string; ready: boolean; aspect: number };

// WebGL2 ping-pong compositor. Each pass samples uPrev (previous pass output).
//
// GL setup (context, compiled programs, FBOs) runs ONCE per effect-structure
// + size change — NOT every render. The per-frame values (deck params,
// getTime, analysis, stem volumes) are read from refs inside the rAF loop, so
// scrubbing a slider or the clock ticking never tears down the GL context.
export const Stage: React.FC<StageProps> = ({ deck, analysis, stemVolumes, getTime, width, height, mediaUrlFor }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  // Live values the draw loop reads without re-running the GL setup effect.
  const deckRef = useRef(deck);
  deckRef.current = deck;
  const mediaUrlRef = useRef(mediaUrlFor);
  mediaUrlRef.current = mediaUrlFor;
  const analysisRef = useRef(analysis);
  analysisRef.current = analysis;
  const volRef = useRef(stemVolumes);
  volRef.current = stemVolumes;
  const getTimeRef = useRef(getTime);
  getTimeRef.current = getTime;

  // Structure key: only the ordered list of ENABLED effect types. Changing a
  // param or binding does NOT change this, so GL is not rebuilt for tweaks.
  const structureKey = deck.effects.filter((e) => e.enabled).map((e) => e.type).join("|");

  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    // antialias:false -> single-sample default framebuffer, matching our
    // single-sample FBOs so the final blitFramebuffer is a valid same-sample
    // copy (a multisampled default FB makes blitFramebuffer INVALID_OPERATION).
    const gl = canvas.getContext("webgl2", { antialias: false }); if (!gl) return;
    const passes = buildDeckPasses(deckRef.current);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

    const compile = (frag: string) => {
      const vs = gl.createShader(gl.VERTEX_SHADER)!; gl.shaderSource(vs, VERT); gl.compileShader(vs);
      const fs = gl.createShader(gl.FRAGMENT_SHADER)!; gl.shaderSource(fs, wrap(frag)); gl.compileShader(fs);
      if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) console.error("[pulse] shader:", gl.getShaderInfoLog(fs));
      const p = gl.createProgram()!; gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
      return p;
    };
    const programs = passes.map((p) => compile(p.frag));

    const makeTarget = () => {
      const tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fbo };
    };
    let a = makeTarget(), b = makeTarget();

    // Media (image/video) textures, keyed by effect id. Created lazily the
    // first time a media effect resolves a URL; reused across frames. Video
    // frames are re-uploaded every draw; images upload once on load.
    const media = new Map<string, MediaSlot>();
    const ensureMedia = (effectId: string, kind: "image" | "video", url: string): MediaSlot | null => {
      let slot = media.get(effectId);
      if (slot && slot.url !== url) { slot = undefined; media.delete(effectId); } // src changed
      if (!slot) {
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        // 1x1 black placeholder until the element loads.
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (kind === "video") {
          const v = document.createElement("video");
          v.src = url; v.loop = true; v.muted = true; v.crossOrigin = "anonymous"; v.playsInline = true;
          v.play().catch(() => {});
          v.addEventListener("loadeddata", () => { slot && (slot.ready = true); slot && (slot.aspect = v.videoWidth / Math.max(1, v.videoHeight)); });
          slot = { el: v, tex, url, ready: false, aspect: 16 / 9 };
        } else {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            slot && (slot.aspect = img.naturalWidth / Math.max(1, img.naturalHeight));
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            slot && (slot.ready = true);
          };
          img.src = url;
          slot = { el: img, tex, url, ready: false, aspect: 1 };
        }
        media.set(effectId, slot);
      }
      // Re-upload video frames each draw once data is flowing.
      if (kind === "video" && slot.ready) {
        const v = slot.el as HTMLVideoElement;
        if (v.readyState >= 2) {
          gl.bindTexture(gl.TEXTURE_2D, slot.tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
        }
      }
      return slot;
    };

    const draw = () => {
      const time = getTimeRef.current();
      const an = analysisRef.current;
      const vols = volRef.current;
      // Live effect data this frame, in the SAME enabled order the programs
      // were compiled for (so program[i] matches livePasses[i]).
      const livePasses = buildDeckPasses(deckRef.current);
      const frame: FeatureFrame = an
        ? sampleFeatures(an, time)
        : { timeSec: time, tempoPhase: 0, master: { level: 0, bandLow: 0, bandMid: 0, bandHigh: 0, brightness: 0, flux: 0 }, stems: {} };

      gl.viewport(0, 0, width, height);
      // seed: clear a to black
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo); gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);

      passes.forEach((pass, i) => {
        // Prefer the live effect if its type still matches at this index
        // (params/bindings may have changed without a rebuild).
        const live = livePasses[i] && livePasses[i].type === pass.type ? livePasses[i] : pass;
        const prog = programs[i]; gl.useProgram(prog);
        const loc = gl.getAttribLocation(prog, "aPos");
        gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        // resolve params
        const resolved: Record<string, number> = {};
        const vol = live.effect.bindings.length ? (vols[live.effect.bindings[0].source.stem] ?? 1) : 1;
        for (const spec of live.descriptor.params) {
          const base = live.effect.params[spec.name] ?? spec.default;
          resolved[spec.name] = resolveParam(base, live.effect.bindings, spec.name, frame, vol);
        }
        const uniforms = live.descriptor.uniforms(resolved, frame);
        gl.uniform2f(gl.getUniformLocation(prog, "uRes"), width, height);
        for (const [name, val] of Object.entries(uniforms)) {
          const ul = gl.getUniformLocation(prog, name); if (ul == null) continue;
          if (Array.isArray(val)) {
            if (val.length === 2) gl.uniform2f(ul, val[0], val[1]);
            else if (val.length === 3) gl.uniform3f(ul, val[0], val[1], val[2]);
            else if (val.length === 4) gl.uniform4f(ul, val[0], val[1], val[2], val[3]);
          } else gl.uniform1f(ul, val);
        }
        gl.uniform1f(gl.getUniformLocation(prog, "uAlpha"), passAlpha(live.effect));
        // Media effects (image/video): bind the file's texture to TEXTURE1 as
        // uTex and pass its aspect ratio. Resolved via the host's mediaUrlFor.
        if (live.descriptor.media) {
          const url = mediaUrlRef.current?.(live.effect);
          const slot = url ? ensureMedia(live.effect.id, live.descriptor.media, url) : null;
          if (slot) {
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, slot.tex);
            gl.uniform1i(gl.getUniformLocation(prog, "uTex"), 1);
            const ta = gl.getUniformLocation(prog, "uTexAspect");
            if (ta != null) gl.uniform1f(ta, slot.aspect);
          }
        }
        // bind previous output as uPrev
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a.tex);
        gl.uniform1i(gl.getUniformLocation(prog, "uPrev"), 0);
        // render into b
        gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        [a, b] = [b, a]; // ping-pong
      });

      // blit final (a) to screen
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, a.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0,0,width,height, 0,0,width,height, gl.COLOR_BUFFER_BIT, gl.NEAREST);

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      // Stop any videos and drop their GL textures.
      for (const slot of media.values()) {
        if (slot.el instanceof HTMLVideoElement) { slot.el.pause(); slot.el.src = ""; }
        gl.deleteTexture(slot.tex);
      }
      media.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, width, height]);

  return <canvas ref={ref} width={width} height={height} style={{ width: "100%", height: "100%", display: "block", background: "#000" }} />;
};
