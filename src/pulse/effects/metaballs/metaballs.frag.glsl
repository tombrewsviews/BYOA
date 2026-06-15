precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uCount; uniform float uRadius; uniform float uSpeed; uniform sampler2D uPrev;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  uv.x *= uRes.x / uRes.y;
  float t = uTime * uSpeed;
  float field = 0.0;
  int n = int(uCount);
  for (int k = 0; k < 12; k++){
    if (k >= n) break;
    float fk = float(k);
    vec2 c = vec2(0.5 * uRes.x / uRes.y + 0.35 * sin(t + fk * 1.7), 0.5 + 0.35 * cos(t * 0.9 + fk * 2.3));
    field += uRadius * uRadius / dot(uv - c, uv - c);
  }
  float m = smoothstep(0.8, 1.6, field);
  vec3 col = m * (0.5 + 0.5 * cos(vec3(0.0, 2.0, 4.0) + t));
  vec3 prev = texture2D(uPrev, gl_FragCoord.xy / uRes).rgb;
  gl_FragColor = vec4(prev + col, 1.0);
}
