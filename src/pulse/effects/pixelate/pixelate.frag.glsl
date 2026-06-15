precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uPixelSize; uniform float uFalloff; uniform sampler2D uPrev;
uniform float uTint; uniform float uBounce; uniform float uCascade;

// Per-cell hash — gives each cell its own pseudo-random frequency offset.
float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 17.5);
  return fract(p.x * p.y);
}

void main() {
  float px = max(1.0, uPixelSize);
  vec2 cell = floor(gl_FragCoord.xy / px);
  vec2 grid = cell * px + px * 0.5;

  // Each cell gets its own random frequency (0.5x–2x base) so they bounce
  // independently. The cascade adds a travelling wave phase across the grid.
  float rng = hash(cell);
  float freq = 0.5 + rng * 1.5;
  float cascadePhase = dot(cell, vec2(1.0)) * uCascade;
  float pulse = 0.5 + 0.5 * sin(uTime * freq * 6.2831 - cascadePhase);
  float scale = 1.0 - uBounce * pulse;

  // Scale the cell's content toward its own center, leaving gaps as it shrinks.
  vec2 local = fract(gl_FragCoord.xy / px) - 0.5;
  vec2 sampled = (grid + local * px * scale) / uRes;
  vec3 c = texture2D(uPrev, sampled).rgb;

  // Tint toward blue while keeping some of the underlying variation.
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 blue = vec3(lum * 0.35, lum * 0.6, lum * 1.0 + 0.15);
  c = mix(c, blue, uTint);

  // falloff darkens cell edges.
  vec2 f = fract(gl_FragCoord.xy / px) - 0.5;
  float edge = 1.0 - clamp(length(f) * 2.0 * uFalloff, 0.0, 1.0);
  gl_FragColor = vec4(c * edge, 1.0);
}
