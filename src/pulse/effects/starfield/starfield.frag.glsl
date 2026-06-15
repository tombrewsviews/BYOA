precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uDensity; uniform float uSpeed; uniform sampler2D uPrev;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 col = vec3(0.0);
  for (float l = 0.0; l < 3.0; l += 1.0){
    float z = fract(uTime * uSpeed * 0.1 + l / 3.0);
    float scale = mix(40.0, 0.5, z) * (uDensity * 0.1);
    vec2 g = uv * scale + l * 17.0;
    vec2 i = floor(g), f = fract(g) - 0.5;
    float h = hash(i);
    float star = smoothstep(0.08, 0.0, length(f)) * step(0.92, h);
    col += vec3(star) * z;
  }
  vec3 prev = texture2D(uPrev, gl_FragCoord.xy / uRes).rgb;
  gl_FragColor = vec4(prev + col, 1.0);
}
