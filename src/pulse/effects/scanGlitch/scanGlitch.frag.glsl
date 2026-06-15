precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uIntensity; uniform float uBlocks; uniform sampler2D uPrev;
float hash(float x){ return fract(sin(x * 12.9898) * 43758.5); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float band = floor(uv.y * uBlocks);
  float t = floor(uTime * 12.0);
  float r = hash(band + t * 7.0);
  // only some bands glitch
  float active = step(0.7, hash(band * 1.3 + t));
  float shift = (r - 0.5) * uIntensity * active;
  vec3 c = texture2D(uPrev, vec2(uv.x + shift, uv.y)).rgb;
  // occasional channel tear on active bands
  c.r = texture2D(uPrev, vec2(uv.x + shift * 1.5, uv.y)).r;
  gl_FragColor = vec4(c, 1.0);
}
