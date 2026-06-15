precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uDensity; uniform float uSpeed; uniform sampler2D uPrev;
vec2 hash2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 g = uv * uDensity;
  vec2 i = floor(g), f = fract(g);
  float md = 8.0; vec2 mp = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 o = vec2(float(x), float(y));
    vec2 pt = o + 0.5 + 0.5 * sin(uTime * uSpeed + 6.2831 * hash2(i + o));
    float d = length(pt - f);
    if (d < md){ md = d; mp = hash2(i + o); }
  }
  vec3 col = 0.5 + 0.5 * cos(6.2831 * (mp.x + vec3(0.0, 0.33, 0.67))) * (1.0 - md);
  vec3 prev = texture2D(uPrev, uv).rgb;
  gl_FragColor = vec4(prev + col, 1.0);
}
