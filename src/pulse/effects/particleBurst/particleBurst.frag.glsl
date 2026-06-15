precision highp float;
uniform vec2 uRes; uniform float uCount; uniform float uBurst; uniform sampler2D uPrev;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 cell = floor(uv * uCount);
  vec2 f = fract(uv * uCount) - 0.5;
  float dot = step(length(f), 0.2 * hash(cell)) * step(1.0 - uBurst, hash(cell + 7.0));
  vec3 prev = texture2D(uPrev, uv).rgb;
  gl_FragColor = vec4(prev + dot * vec3(1.0, 0.9, 0.5), 1.0);
}
