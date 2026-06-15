precision highp float;
uniform vec2 uRes; uniform float uIntensity; uniform float uRadius; uniform sampler2D uPrev;
uniform vec3 uColor;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 c = uv - 0.5;
  float d = length(c);
  float glow = uIntensity * smoothstep(uRadius, 0.0, d);
  vec3 prev = texture2D(uPrev, uv).rgb;
  gl_FragColor = vec4(prev + glow * uColor, 1.0);
}
