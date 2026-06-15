precision highp float;
uniform vec2 uRes; uniform float uScanline; uniform float uCurve; uniform float uVignette; uniform sampler2D uPrev;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  // barrel curve
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  uv = uv + cc * r2 * uCurve;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0){ gl_FragColor = vec4(0.0,0.0,0.0,1.0); return; }
  vec3 c = texture2D(uPrev, uv).rgb;
  // scanlines
  float sl = 0.5 + 0.5 * sin(uv.y * uRes.y * 3.14159);
  c *= mix(1.0, sl, uScanline);
  // aperture grille tint per column
  float col = mod(gl_FragCoord.x, 3.0);
  vec3 mask = vec3(col < 1.0 ? 1.1 : 0.9, (col >= 1.0 && col < 2.0) ? 1.1 : 0.9, col >= 2.0 ? 1.1 : 0.9);
  c *= mask;
  // vignette
  c *= mix(1.0, smoothstep(0.8, 0.2, length(cc)), uVignette);
  gl_FragColor = vec4(c, 1.0);
}
