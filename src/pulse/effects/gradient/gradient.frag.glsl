precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uAngle; uniform float uSpeed; uniform vec3 uColorA; uniform vec3 uColorB; uniform sampler2D uPrev;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 dir = vec2(cos(uAngle), sin(uAngle));
  float t = dot(uv - 0.5, dir) + 0.5 + 0.25 * sin(uTime * uSpeed);
  vec3 col = mix(uColorA, uColorB, clamp(t, 0.0, 1.0));
  vec3 prev = texture2D(uPrev, uv).rgb;
  gl_FragColor = vec4(prev + col, 1.0);
}
