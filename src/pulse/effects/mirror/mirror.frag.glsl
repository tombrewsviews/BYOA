precision highp float;
uniform vec2 uRes; uniform float uAxis; uniform float uSplit; uniform sampler2D uPrev;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  if (uAxis < 0.5){ if (uv.x > uSplit) uv.x = 2.0 * uSplit - uv.x; }
  else { if (uv.y > uSplit) uv.y = 2.0 * uSplit - uv.y; }
  gl_FragColor = vec4(texture2D(uPrev, uv).rgb, 1.0);
}
