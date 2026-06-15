precision highp float;
uniform vec2 uRes; uniform float uSegments; uniform sampler2D uPrev;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 c = uv - 0.5;
  float a = atan(c.y, c.x);
  float r = length(c);
  float seg = 6.2831853 / max(1.0, uSegments);
  a = abs(mod(a, seg) - seg * 0.5);
  vec2 fold = vec2(cos(a), sin(a)) * r + 0.5;
  vec3 prev = texture2D(uPrev, fold).rgb;
  gl_FragColor = vec4(prev, 1.0);
}
