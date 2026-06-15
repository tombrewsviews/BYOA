precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uAmplitude; uniform float uWavelength;
uniform sampler2D uPrev;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float w = sin((uv.x / max(0.01, uWavelength) + uTime) * 6.2831);
  float d = abs(uv.y - 0.5 - w * uAmplitude);
  float line = smoothstep(0.02, 0.0, d);
  vec3 prev = texture2D(uPrev, uv).rgb;
  gl_FragColor = vec4(prev + vec3(line) * vec3(0.4, 0.8, 1.0), 1.0);
}
