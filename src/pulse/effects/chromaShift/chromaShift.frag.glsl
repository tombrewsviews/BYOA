precision highp float;
uniform vec2 uRes; uniform float uAmount; uniform sampler2D uPrev;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float r = texture2D(uPrev, uv + vec2(uAmount, 0.0)).r;
  float g = texture2D(uPrev, uv).g;
  float b = texture2D(uPrev, uv - vec2(uAmount, 0.0)).b;
  gl_FragColor = vec4(r, g, b, 1.0);
}
