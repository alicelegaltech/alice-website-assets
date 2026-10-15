/* ===========================================================================
   shaders.js — the GLSL. Kept as strings rather than .glsl files on purpose:
   fetch() is blocked on file://, and this page should open by double-clicking
   without a local server.
   =========================================================================== */
(function (AG) {
  'use strict';

  const VERT = `#version 300 es
void main(){
  // Fullscreen triangle from gl_VertexID — no buffers, no attributes.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  /* Pass 1 — composes the light field and maps it through the OKLab LUT.
     Writes LINEAR light into a 16-bit float target. Nothing is quantised here;
     that happens once, in the composite pass. */
  const FIELD = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime, uAngle, uPos, uSoft, uAsym, uWedge, uContrast, uWarpAmt, uWarpScale, uFade;
uniform int uCount;
uniform vec4 uSrc[${AG.MAXSRC}];       // xy = centre, z = radius, w = gain
uniform sampler2D uLut;
out vec4 outColor;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0,0.0)), u.x),
             mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i = 0; i < 4; i++){ v += a * vnoise(p); p *= 2.02; a *= 0.5; }
  return v;
}
vec3 oklabToLinear(vec3 c){
  float l_ = c.x + 0.3963377774*c.y + 0.2158037573*c.z;
  float m_ = c.x - 0.1055613458*c.y - 0.0638541728*c.z;
  float s_ = c.x - 0.0894841775*c.y - 1.2914855480*c.z;
  float l = l_*l_*l_, m = m_*m_*m_, s = s_*s_*s_;
  return vec3( 4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
              -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
              -0.0041960863*l - 0.7034186147*m + 1.7076147010*s);
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = uv - 0.5;
  p.x *= uRes.x / uRes.y;

  // Domain warp perturbs the composition. It must not be the thing shaping
  // it — when the warp does the shaping you get generic value-noise clouds.
  vec2 w = p * uWarpScale;
  float n1 = fbm(w + vec2(0.0, uTime * 0.055));
  float n2 = fbm(w + vec2(5.2, 1.3) - vec2(uTime * 0.041, 0.0));
  p += vec2(n1 - 0.5, n2 - 0.5) * uWarpAmt;

  // Base wedge. Softness varies along the band, so one side falls away gently
  // and the other collapses — the asymmetry a linear gradient cannot make.
  float ca = cos(uAngle), sa = sin(uAngle);
  vec2 q = vec2(p.x*ca - p.y*sa, p.x*sa + p.y*ca);
  float soft = max(uSoft * exp(-uAsym * q.x), 0.015);
  float f = uWedge * (0.5 + 0.5 * tanh((q.y + uPos) / soft));

  // Soft sources stacked over it; negative gain carves shadow out.
  for(int i = 0; i < ${AG.MAXSRC}; i++){
    if(i >= uCount) break;
    vec2 d = p - uSrc[i].xy;
    float r2 = dot(d, d) / max(uSrc[i].z * uSrc[i].z, 1e-5);
    f += uSrc[i].w * exp(-r2 * 1.6);
  }

  // Roll off into the ends with C1 continuity rather than clamping. A hard
  // clamp leaves a knee wherever the sources sum past the top, and that knee
  // reads as a contour line across the highlight.
  float v = (f - 0.5) * uContrast + 0.5;
  float t = smoothstep(-0.08, 1.08, v);

  // Bottom fade: pull the field down the ramp toward its darkest stop over the
  // lowest uFade of the frame, so the bottom edge always lands on the same
  // colour and the next section can meet it seamlessly. Done here, in 16-bit,
  // before the LUT, so it follows the ramp's own hue path and gets dithered.
  if (uFade > 0.0) {
    float m = 1.0 - smoothstep(0.0, uFade, uv.y);
    t *= 1.0 - m * m * (3.0 - 2.0 * m);
  }

  vec3 lab = texture(uLut, vec2(t, 0.5)).rgb;
  outColor = vec4(max(oklabToLinear(lab), vec3(0.0)), 1.0);
}`;

  /* Pass 2 — upscales the field (free bilinear smoothing), encodes to sRGB,
     lays grain and dither over the top at full device resolution, and makes
     the single 8-bit write. */
  const COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uSrcTex;
uniform vec2 uRes;
uniform float uGrain;
uniform float uFlute, uFluteN, uFluteK, uFluteShine, uFluteBend, uDots;
out vec4 outColor;

// Integer hash. A fract(sin(...)) hash loses precision at large fragment
// coordinates and wraps — that produced a measurable 50px tile. No trig here.
uint uhash(uvec2 p){
  uint h = p.x * 374761393u + p.y * 668265263u;
  h = (h ^ (h >> 13)) * 1274126177u;
  return h ^ (h >> 16);
}
float rnd(uvec2 p){ return float(uhash(p)) * (1.0/4294967296.0); }
vec3 encode(vec3 c){
  c = max(c, vec3(0.0));
  return mix(12.92*c, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), c));
}

// Each flute is a small cylindrical lens: it shows a slice of the field
// centred on the flute, stretched by uFluteK. K = 1 is flat glass, K > 1
// compresses, K < 0 mirrors (the stage-panel look: light gathers on one edge).
vec3 fluted(vec2 uv){
  float bend = uFluteBend * 0.02 * sin(uv.y * 2.6);
  float fx = (uv.x + bend) * uFluteN;
  float s = fract(fx);
  float x2 = ((floor(fx) + 0.5) + (s - 0.5) * uFluteK) / uFluteN - bend;
  vec3 lin = mix(texture(uSrcTex, uv).rgb, texture(uSrcTex, vec2(x2, uv.y)).rgb, uFlute);
  vec3 c = encode(lin);
  // Light on the glass: a soft sheen toward one edge, a gentle falloff on the
  // other. Deliberately low — the refraction carries the effect.
  float n = s * 2.0 - 1.0;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float sheen = smoothstep(0.1, 1.0, n) * smoothstep(1.0, 0.82, n);
  float fall = pow(max(-n, 0.0), 1.5) * 0.18;
  float k = uFluteShine * uFlute;
  c *= 1.0 - fall * k;
  c += sheen * 0.22 * (0.2 + lum) * k;
  return c;
}
void main(){
  uvec2 fc = uvec2(gl_FragCoord.xy);
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c;

  if (uFlute > 0.0) {
    // Fluted glass, supersampled 3x across the flute so the seams stay crisp
    // without stair-stepping. The glass is evaluated in sRGB so the shading
    // behaves like light on a surface rather than a change of exposure.
    c = vec3(0.0);
    for (int i = -1; i <= 1; i++) {
      vec2 px = gl_FragCoord.xy + vec2(float(i) * 0.33, 0.0);
      c += fluted(px / uRes);
    }
    c /= 3.0;
  } else {
    c = encode(texture(uSrcTex, uv).rgb);
  }

  if (uDots > 0.0) {
    // Sparse dot grid on every other flute centre, like LED stage panels.
    float pitch = uRes.x / max(uFluteN, 1.0);
    float cx = mod(gl_FragCoord.x + pitch * 0.5, 2.0 * pitch) - pitch;
    float cy = mod(gl_FragCoord.y, pitch * 1.5) - pitch * 0.75;
    float r = max(0.9, uRes.x / 1600.0);
    float dt = step(abs(cx), r) * step(abs(cy), r);
    c = mix(c, vec3(0.96), dt * uDots);
  }

  // Grain, at the requested standard deviation (uniform noise of amplitude a
  // has sigma a/sqrt(12), hence the sqrt(12) factor).
  float g = rnd(fc + uvec2(11u, 29u)) - 0.5;
  c += g * uGrain * 3.4641016;

  // Dither: triangular PDF at one least-significant bit, immediately before
  // the 8-bit write. THIS, not the grain, is what removes banding — which is
  // why grain can go to zero safely. Never reorder these two.
  float d = rnd(fc) - rnd(fc + uvec2(7919u, 104729u));
  c += d * (1.0/255.0);

  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

  AG.SHADERS = { VERT: VERT, FIELD: FIELD, COMPOSITE: COMPOSITE };
})(window.AG);
