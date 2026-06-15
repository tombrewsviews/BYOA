precision highp float;
uniform vec2 uRes; uniform float uLow; uniform float uMid; uniform float uHigh; uniform sampler2D uPrev;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float band = floor(uv.x * 3.0);
  float h = band < 1.0 ? uLow : (band < 2.0 ? uMid : uHigh);
  float bar = step(uv.y, h);
  vec3 col = band < 1.0 ? vec3(1.0, 0.3, 0.3) : (band < 2.0 ? vec3(0.3, 1.0, 0.4) : vec3(0.4, 0.5, 1.0));
  vec3 prev = texture2D(uPrev, uv).rgb;
  gl_FragColor = vec4(prev + bar * col, 1.0);
}
