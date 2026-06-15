precision highp float;
uniform vec2 uRes; uniform float uIntensity; uniform float uRadius; uniform sampler2D uPrev;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 c = uv - 0.5;
  float d = length(c);
  float glow = uIntensity * smoothstep(uRadius, 0.0, d);
  vec3 prev = texture2D(uPrev, uv).rgb;
  gl_FragColor = vec4(prev + glow * vec3(1.0, 0.7, 0.9), 1.0);
}
