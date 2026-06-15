# Pulse effects

Each visual effect is two files under `src/pulse/effects/<name>/`:

- `<name>.frag.glsl` — a GLSL fragment shader. Write it with `gl_FragColor`
  and `texture2D` (the compositor auto-wraps to GLSL3). It MUST declare
  `precision highp float;`, `uniform vec2 uRes;`, and `uniform sampler2D uPrev;`
  (the previous pass's output — sample it so effects compose). `uTime` and
  `uAlpha` are available; multiply your output by `uAlpha` to honor transitions.
- `<name>.ts` — exports an `EffectDescriptor`:
  ```ts
  { type, label, frag, params: ParamSpec[], uniforms(resolved, frame), blend }
  ```
  `params` are static sliders (`{name,min,max,default,step}`). `uniforms` maps
  the resolved param values + the current audio `FeatureFrame` to GLSL uniform
  values. `blend` is `"add" | "screen" | "alpha" | "multiply"`.

Register every effect in `src/pulse/effects/registry.ts` (`EFFECTS` map). Vite
HMR hot-reloads shader + descriptor edits live.

The 10 shipped effects: wave, pixelate (pixel size + falloff), noiseField,
bloomPulse, spectrumBars, feedbackTrails, kaleido, chromaShift, contourLines,
particleBurst. They composite in stack order — `pixelate` over `noiseField`
over `wave`, etc. — so the visual space is large from small shaders.
