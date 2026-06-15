precision highp float;
uniform vec2 uRes; uniform float uPixelSize; uniform float uFalloff; uniform sampler2D uPrev;
void main() {
  float px = max(1.0, uPixelSize);
  vec2 grid = floor(gl_FragCoord.xy / px) * px + px * 0.5;
  vec2 uv = grid / uRes;
  vec3 c = texture2D(uPrev, uv).rgb;
  // falloff darkens cell edges toward the cell center distance.
  vec2 f = fract(gl_FragCoord.xy / px) - 0.5;
  float edge = 1.0 - clamp(length(f) * 2.0 * uFalloff, 0.0, 1.0);
  gl_FragColor = vec4(c * edge, 1.0);
}
