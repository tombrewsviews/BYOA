precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uAmount; uniform float uSpeed; uniform sampler2D uPrev;
float noise(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float n = noise(floor(uv * vec2(8.0, 24.0)) + floor(uTime * uSpeed));
  vec2 off = (vec2(n, noise(uv.yx + n)) - 0.5) * uAmount;
  float r = texture2D(uPrev, uv + off).r;
  float g = texture2D(uPrev, uv).g;
  float b = texture2D(uPrev, uv - off).b;
  gl_FragColor = vec4(r, g, b, 1.0);
}
