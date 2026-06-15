precision highp float;
uniform vec2 uRes; uniform float uScale; uniform float uAngle; uniform sampler2D uPrev;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = texture2D(uPrev, uv).rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  float s = sin(uAngle), co = cos(uAngle);
  vec2 p = gl_FragCoord.xy;
  vec2 rp = vec2(p.x * co - p.y * s, p.x * s + p.y * co);
  vec2 cell = mod(rp, uScale) - uScale * 0.5;
  float d = length(cell) / (uScale * 0.5);
  float dot_ = smoothstep(lum, lum + 0.08, d);
  gl_FragColor = vec4(c * (1.0 - dot_), 1.0);
}
