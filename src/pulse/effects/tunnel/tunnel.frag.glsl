precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uSpeed; uniform float uTwist; uniform sampler2D uPrev;
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float a = atan(uv.y, uv.x);
  float r = length(uv);
  float u = a / 6.2831 + uTwist * r;
  float v = 0.3 / r + uTime * uSpeed;
  float check = step(0.5, fract(u * 6.0)) * step(0.5, fract(v * 2.0));
  vec3 col = mix(vec3(0.1, 0.0, 0.2), 0.5 + 0.5 * cos(vec3(0.0, 2.0, 4.0) + v), check) * smoothstep(0.0, 0.3, r);
  vec3 prev = texture2D(uPrev, gl_FragCoord.xy / uRes).rgb;
  gl_FragColor = vec4(prev + col, 1.0);
}
