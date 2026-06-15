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

const wrap = (frag: string) =>
  frag.startsWith("#version") ? frag : `#version 300 es\n${frag.replace("gl_FragColor", "outColor").replace("texture2D", "texture")}\nout vec4 outColor;`;

type StageProps = {
  deck: Deck;
  analysis: Analysis | null;
  stemVolumes: Record<string, number>;
  getTime: () => number;
  width: number; height: number;
};

// WebGL2 ping-pong compositor. Each pass samples uPrev (previous pass output).
export const Stage: React.FC<StageProps> = ({ deck, analysis, stemVolumes, getTime, width, height }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const gl = canvas.getContext("webgl2"); if (!gl) return;
    const passes = buildDeckPasses(deck);

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

    const draw = () => {
      const time = getTime();
      const frame: FeatureFrame = analysis
        ? sampleFeatures(analysis, time)
        : { timeSec: time, tempoPhase: 0, master: { level: 0, bandLow: 0, bandMid: 0, bandHigh: 0, brightness: 0, flux: 0 }, stems: {} };

      gl.viewport(0, 0, width, height);
      // seed: clear a to black
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo); gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);

      passes.forEach((pass, i) => {
        const prog = programs[i]; gl.useProgram(prog);
        const loc = gl.getAttribLocation(prog, "aPos");
        gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        // resolve params
        const resolved: Record<string, number> = {};
        const vol = pass.effect.bindings.length ? (stemVolumes[pass.effect.bindings[0].source.stem] ?? 1) : 1;
        for (const spec of pass.descriptor.params) {
          const base = pass.effect.params[spec.name] ?? spec.default;
          resolved[spec.name] = resolveParam(base, pass.effect.bindings, spec.name, frame, vol);
        }
        const uniforms = pass.descriptor.uniforms(resolved, frame);
        gl.uniform2f(gl.getUniformLocation(prog, "uRes"), width, height);
        for (const [name, val] of Object.entries(uniforms)) {
          const ul = gl.getUniformLocation(prog, name); if (ul == null) continue;
          if (Array.isArray(val)) { if (val.length === 2) gl.uniform2f(ul, val[0], val[1]); }
          else gl.uniform1f(ul, val);
        }
        gl.uniform1f(gl.getUniformLocation(prog, "uAlpha"), passAlpha(pass.effect));
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
    return () => cancelAnimationFrame(rafRef.current);
  }, [deck, analysis, stemVolumes, getTime, width, height]);

  return <canvas ref={ref} width={width} height={height} style={{ width: "100%", height: "100%", display: "block", background: "#000" }} />;
};
