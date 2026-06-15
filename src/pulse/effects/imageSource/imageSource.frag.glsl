precision highp float;
uniform vec2 uRes; uniform float uOpacity; uniform float uFit; uniform float uTexAspect; uniform sampler2D uPrev; uniform sampler2D uTex;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  // Cover/contain fit: scale uv around the centre by the aspect ratio.
  float screenAspect = uRes.x / uRes.y;
  vec2 t = uv - 0.5;
  if (uFit < 0.5){ // cover
    if (screenAspect > uTexAspect) t.y *= uTexAspect / screenAspect;
    else t.x *= screenAspect / uTexAspect;
  } else { // contain
    if (screenAspect > uTexAspect) t.x *= screenAspect / uTexAspect;
    else t.y *= uTexAspect / screenAspect;
  }
  vec2 st = t + 0.5;
  vec3 prev = texture2D(uPrev, uv).rgb;
  if (st.x < 0.0 || st.x > 1.0 || st.y < 0.0 || st.y > 1.0){ gl_FragColor = vec4(prev, 1.0); return; }
  vec3 img = texture2D(uTex, vec2(st.x, 1.0 - st.y)).rgb;
  gl_FragColor = vec4(mix(prev, img, uOpacity), 1.0);
}
