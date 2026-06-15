precision highp float;
uniform vec2 uRes; uniform float uCell; uniform sampler2D uPrev;
// Crude 5-level glyph: brighter cells get denser dot patterns.
float glyph(vec2 f, float lvl){
  vec2 g = floor(f * 5.0);
  float h = fract(sin(dot(g, vec2(12.9, 78.2))) * 43758.5);
  return step(1.0 - lvl, h);
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 cell = floor(gl_FragCoord.xy / uCell) * uCell;
  vec3 c = texture2D(uPrev, (cell + uCell * 0.5) / uRes).rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  vec2 f = fract(gl_FragCoord.xy / uCell);
  float on = glyph(f, lum);
  gl_FragColor = vec4(c * on + c * 0.05, 1.0);
}
