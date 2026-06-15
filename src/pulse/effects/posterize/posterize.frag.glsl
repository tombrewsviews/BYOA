precision highp float;
uniform vec2 uRes; uniform float uLevels; uniform sampler2D uPrev;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = texture2D(uPrev, uv).rgb;
  float n = max(2.0, uLevels);
  gl_FragColor = vec4(floor(c * n) / (n - 1.0), 1.0);
}
