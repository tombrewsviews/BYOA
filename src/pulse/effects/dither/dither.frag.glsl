precision highp float;
uniform vec2 uRes; uniform float uScale; uniform float uLevels; uniform sampler2D uPrev;
// 4x4 Bayer threshold matrix, normalized to (0..1).
float bayer(vec2 p){
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int idx = x + y * 4;
  float m[16];
  m[0]=0.0;  m[1]=8.0;  m[2]=2.0;  m[3]=10.0;
  m[4]=12.0; m[5]=4.0;  m[6]=14.0; m[7]=6.0;
  m[8]=3.0;  m[9]=11.0; m[10]=1.0; m[11]=9.0;
  m[12]=15.0;m[13]=7.0; m[14]=13.0;m[15]=5.0;
  float v = 0.0;
  for (int i = 0; i < 16; i++){ if (i == idx) v = m[i]; }
  return (v + 0.5) / 16.0;
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = texture2D(uPrev, uv).rgb;
  float th = bayer(gl_FragCoord.xy / max(1.0, uScale));
  float n = max(2.0, uLevels);
  vec3 q = floor(c * n + th) / n;
  gl_FragColor = vec4(q, 1.0);
}
