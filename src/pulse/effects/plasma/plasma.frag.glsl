precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uScale; uniform float uSpeed;
uniform float uColorR; uniform float uColorG; uniform float uColorB;
uniform float uBlend; // 0=screen, 1=add, 2=multiply, 3=overlay
uniform float uSaturation; // 0=greyscale, 1=full color
uniform float uBrightness; // 0=dark, 1=full
uniform sampler2D uPrev;

// HSV to RGB — keeps saturation at 1 so colors are always vivid, never white
vec3 hsv2rgb(float h, float s, float v) {
  vec3 c = clamp(abs(fract(h + vec3(0.0,2.0/3.0,1.0/3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), c, s);
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float t = uTime * uSpeed;
  float v = sin(uv.x * uScale + t)
          + sin(uv.y * uScale + t * 1.3)
          + sin((uv.x + uv.y) * uScale * 0.7 + t * 0.7)
          + sin(length(uv - 0.5) * uScale * 1.5 - t);
  v = v * 0.125 + 0.5; // remap [-2,2] → [0,1]

  // hue offset driven by colorR so each layer lands in a different hue zone
  float hue = fract(v + uColorR);
  // saturation and brightness caps prevent approaching white
  vec3 col = hsv2rgb(hue, uSaturation, uBrightness);

  vec3 prev = texture2D(uPrev, uv).rgb;

  // When prev is black (first layer / empty canvas), skip the blend and
  // output col directly — multiply/overlay on black = black, which is wrong.
  float prevLum = dot(prev, vec3(0.299, 0.587, 0.114));
  vec3 blended;
  if (prevLum < 0.001) {
    blended = col;
  } else if (uBlend < 0.5) {
    // screen: never exceeds 1.0, avoids blowout
    blended = 1.0 - (1.0 - prev) * (1.0 - col);
  } else if (uBlend < 1.5) {
    // add
    blended = clamp(prev + col, 0.0, 1.0);
  } else if (uBlend < 2.5) {
    // multiply
    blended = prev * col;
  } else {
    // overlay
    blended = mix(2.0*prev*col, 1.0-2.0*(1.0-prev)*(1.0-col), step(0.5, prev));
  }
  gl_FragColor = vec4(blended, 1.0);
}
