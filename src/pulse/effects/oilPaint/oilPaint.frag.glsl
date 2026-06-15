precision highp float;
uniform vec2 uRes; uniform float uRadius; uniform sampler2D uPrev;
// Simplified Kuwahara: 4 quadrant means, pick the lowest-variance one.
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 px = 1.0 / uRes;
  int rad = int(uRadius);
  vec3 mean[4]; vec3 sq[4];
  for (int q = 0; q < 4; q++){ mean[q] = vec3(0.0); sq[q] = vec3(0.0); }
  float cnt = 0.0;
  for (int y = -4; y <= 4; y++){
    for (int x = -4; x <= 4; x++){
      if (abs(x) > rad || abs(y) > rad) continue;
      vec3 c = texture2D(uPrev, uv + vec2(float(x), float(y)) * px).rgb;
      int q = (x <= 0 ? 0 : 1) + (y <= 0 ? 0 : 2);
      mean[q] += c; sq[q] += c * c;
    }
  }
  float n = float((rad + 1) * (rad + 1));
  vec3 best = mean[0] / n; float bv = 1e9;
  for (int q = 0; q < 4; q++){
    vec3 m = mean[q] / n;
    vec3 v = sq[q] / n - m * m;
    float var = v.r + v.g + v.b;
    if (var < bv){ bv = var; best = m; }
  }
  gl_FragColor = vec4(best, 1.0);
}
