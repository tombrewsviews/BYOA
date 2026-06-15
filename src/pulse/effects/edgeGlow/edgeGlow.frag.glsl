precision highp float;
uniform vec2 uRes; uniform float uStrength; uniform float uGlow; uniform vec3 uColor; uniform sampler2D uPrev;
float lum(vec2 uv){ return dot(texture2D(uPrev, uv).rgb, vec3(0.299, 0.587, 0.114)); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 px = 1.0 / uRes;
  float gx = lum(uv + vec2(-px.x, -px.y)) + 2.0*lum(uv + vec2(-px.x, 0.0)) + lum(uv + vec2(-px.x, px.y))
           - lum(uv + vec2(px.x, -px.y)) - 2.0*lum(uv + vec2(px.x, 0.0)) - lum(uv + vec2(px.x, px.y));
  float gy = lum(uv + vec2(-px.x, -px.y)) + 2.0*lum(uv + vec2(0.0, -px.y)) + lum(uv + vec2(px.x, -px.y))
           - lum(uv + vec2(-px.x, px.y)) - 2.0*lum(uv + vec2(0.0, px.y)) - lum(uv + vec2(px.x, px.y));
  float e = clamp(sqrt(gx*gx + gy*gy) * uStrength, 0.0, 1.0);
  vec3 base = texture2D(uPrev, uv).rgb;
  gl_FragColor = vec4(base + e * uGlow * uColor, 1.0);
}
