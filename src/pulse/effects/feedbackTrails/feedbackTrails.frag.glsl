precision highp float;
uniform vec2 uRes; uniform float uDecay; uniform sampler2D uPrev;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 prev = texture2D(uPrev, uv).rgb;
  vec3 smear = prev * uDecay;
  gl_FragColor = vec4(mix(prev, smear, 0.5), 1.0);
}
