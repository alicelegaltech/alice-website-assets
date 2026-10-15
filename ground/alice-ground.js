/*! Alice Ground 1.3.0: the moving gradient on alice.law. Built from src/ by tools/build.mjs. */
/* ===========================================================================
   ramp.js — colour. OKLCH ↔ sRGB, gamut fitting, and the stop table.
   Loaded first; everything else reads from window.AG.
   =========================================================================== */
window.AG = window.AG || {};
(function (AG) {
  'use strict';

  /* ---- OKLab → linear sRGB (Björn Ottosson's matrices) ---- */
  function oklabToLinear(L, a, b) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    return [
      +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ];
  }
  const enc = v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;

  function inGamut(L, C, H) {
    const h = H * Math.PI / 180;
    return oklabToLinear(L, C * Math.cos(h), C * Math.sin(h))
      .every(v => v >= -0.0005 && v <= 1.0005);
  }
  /* Reduce chroma until the colour sits inside sRGB, keeping L and H exact.
     Without this, pushing chroma clips channels and leaves flat dead patches. */
  function fitChroma(L, C, H) {
    if (inGamut(L, C, H)) return C;
    let lo = 0, hi = C;
    for (let i = 0; i < 12; i++) {
      const m = (lo + hi) / 2;
      if (inGamut(L, m, H)) lo = m; else hi = m;
    }
    return lo;
  }
  function oklchToHex(L, C, H) {
    const h = H * Math.PI / 180;
    return '#' + oklabToLinear(L, C * Math.cos(h), C * Math.sin(h)).map(v =>
      Math.round(Math.min(1, Math.max(0, enc(v))) * 255).toString(16).padStart(2, '0')
    ).join('').toUpperCase();
  }

  /* ---- the stop table -----------------------------------------------------
     Measured off the reference image: lightness 0.145 → 0.851, hue travelling
     226° → 180° as the field lightens, and chroma peaking at L ≈ 0.30 rather
     than at either end. That chroma turn in the shadows is what makes it read
     as light falling rather than as a fill. Do not "simplify" it to a straight
     two-stop ramp; that is the thing that kills it.
     --------------------------------------------------------------------- */
  const BASE = [
    { t: 0.00, L: 0.145, C: 0.008, H: 226 },
    { t: 0.15, L: 0.200, C: 0.021, H: 224 },
    { t: 0.32, L: 0.300, C: 0.033, H: 218 },
    { t: 0.55, L: 0.470, C: 0.030, H: 209 },
    { t: 0.78, L: 0.660, C: 0.022, H: 199 },
    { t: 1.00, L: 0.851, C: 0.012, H: 180 }
  ];
  const BASE_PEAK = 0.32, BASE_LO = 0.145, BASE_HI = 0.851;
  const BASE_HMID = 203, BASE_TRAVEL = 46;
  const MAXSRC = 5;

  /* ---- monotone cubic interpolation (Fritsch–Carlson) ---------------------
     READ THIS BEFORE CHANGING IT. Interpolating each segment with smoothstep
     instead pins dL/dt to zero at every stop, which puts a plateau at each one
     and a visible staircase across the gradient: slope ratio 356:1 versus
     3.4:1 done properly. It is invisible to pixel-level checks and obvious to
     the eye. See CLAUDE.md for how to test for it.
     --------------------------------------------------------------------- */
  const SLOPES = {};
  ['L', 'C', 'H'].forEach(f => {
    const n = BASE.length, h = [], d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) {
      h[i] = BASE[i + 1].t - BASE[i].t;
      d[i] = (BASE[i + 1][f] - BASE[i][f]) / h[i];
    }
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) { m[i] = 0; }
      else {
        const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
        m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
      }
    }
    SLOPES[f] = m;
  });

  function sampleBase(t, f) {
    const n = BASE.length;
    if (t <= BASE[0].t) return BASE[0][f];
    if (t >= BASE[n - 1].t) return BASE[n - 1][f];
    let i = 0; while (i < n - 2 && t > BASE[i + 1].t) i++;
    const a = BASE[i], b = BASE[i + 1], m = SLOPES[f];
    const h = b.t - a.t, s = (t - a.t) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * a[f] + (s3 - 2 * s2 + s) * h * m[i]
         + (-2 * s3 + 3 * s2) * b[f] + (s3 - s2) * h * m[i + 1];
  }
  /* Slides the chroma peak without losing the measured shape. */
  function remapPeak(t, peak) {
    if (t <= peak) return peak <= 0 ? 0 : (t / peak) * BASE_PEAK;
    return BASE_PEAK + ((t - peak) / (1 - peak)) * (1 - BASE_PEAK);
  }

  /* The live ramp: base table plus the user's modifiers. Hue rotation is a
     pure offset, so every tint keeps the same lightness and chroma behaviour
     and the whole family reads as siblings. */
  function rampAt(t) {
    const P = AG.P;
    const Lrel = (sampleBase(t, 'L') - BASE_LO) / (BASE_HI - BASE_LO);
    const L = P.lDark + Lrel * (P.lLight - P.lDark);
    const C0 = sampleBase(remapPeak(t, P.peak), 'C') * P.chroma;
    const H = BASE_HMID + (sampleBase(t, 'H') - BASE_HMID) * (P.travel / BASE_TRAVEL) + P.hueShift;
    return { L: L, C: fitChroma(L, C0, H), H: ((H % 360) + 360) % 360 };
  }

  /* ---- control definitions ---- */
  const deg = '°', times = '×';
  const SPEC = [
    { g: 'gColour', key: 'hueShift',  label: 'Hue rotation', min: -180, max: 180,  step: 1,     val: 0,     fmt: v => (v > 0 ? '+' : '') + v.toFixed(0) + deg },
    { g: 'gColour', key: 'chroma',    label: 'Chroma',       min: 0,    max: 2.5,  step: 0.01,  val: 1,     fmt: v => v.toFixed(2) + times },
    { g: 'gColour', key: 'peak',      label: 'Chroma peak',  min: 0.05, max: 0.95, step: 0.01,  val: 0.32,  fmt: v => v.toFixed(2) },
    { g: 'gColour', key: 'travel',    label: 'Hue travel',   min: 0,    max: 120,  step: 1,     val: 46,    fmt: v => v.toFixed(0) + deg },
    { g: 'gColour', key: 'lDark',     label: 'Shadow L',     min: 0.02, max: 0.45, step: 0.005, val: 0.145, fmt: v => v.toFixed(3) },
    { g: 'gColour', key: 'lLight',    label: 'Highlight L',  min: 0.50, max: 1.00, step: 0.005, val: 0.851, fmt: v => v.toFixed(3) },

    { g: 'gSources', key: 'srcCount',  label: 'Count',     min: 0,    max: MAXSRC, step: 1,     val: 3,     fmt: v => v.toFixed(0) },
    { g: 'gSources', key: 'srcSize',   label: 'Size',      min: 0.08, max: 1.6,  step: 0.01,  val: 0.52,  fmt: v => v.toFixed(2) },
    { g: 'gSources', key: 'srcGain',   label: 'Intensity', min: 0,    max: 1.6,  step: 0.01,  val: 0.68,  fmt: v => v.toFixed(2) },
    { g: 'gSources', key: 'srcSpread', label: 'Spread',    min: 0.1,  max: 1.5,  step: 0.01,  val: 0.72,  fmt: v => v.toFixed(2) },
    { g: 'gSources', key: 'drift',     label: 'Drift',     min: 0,    max: 0.30, step: 0.005, val: 0.055, fmt: v => v.toFixed(3) },

    { g: 'gWedge', key: 'wedgeGain', label: 'Weight',    min: 0,    max: 1.4,  step: 0.01, val: 0.72,  fmt: v => v.toFixed(2) },
    { g: 'gWedge', key: 'angle',     label: 'Angle',     min: 0,    max: 360,  step: 1,    val: 332,   fmt: v => v.toFixed(0) + deg },
    { g: 'gWedge', key: 'position',  label: 'Boundary',  min: -0.9, max: 0.9,  step: 0.01, val: 0.06,  fmt: v => v.toFixed(2) },
    { g: 'gWedge', key: 'softness',  label: 'Softness',  min: 0.05, max: 1.60, step: 0.01, val: 0.46,  fmt: v => v.toFixed(2) },
    { g: 'gWedge', key: 'asym',      label: 'Asymmetry', min: -1.6, max: 1.6,  step: 0.01, val: -0.85, fmt: v => v.toFixed(2) },
    { g: 'gWedge', key: 'contrast',  label: 'Contrast',  min: 0.4,  max: 2.6,  step: 0.01, val: 1.0,   fmt: v => v.toFixed(2) + times },

    { g: 'gMotion', key: 'warpAmt',   label: 'Warp',       min: 0,    max: 0.70, step: 0.005, val: 0.14, fmt: v => v.toFixed(3) },
    { g: 'gMotion', key: 'warpScale', label: 'Warp scale', min: 0.25, max: 4.5,  step: 0.05,  val: 1.05, fmt: v => v.toFixed(2) },
    { g: 'gMotion', key: 'speed',     label: 'Speed',      min: 0,    max: 2,    step: 0.01,  val: 0.35, fmt: v => v.toFixed(2) + times },

    /* Grain is a standard deviation, matching how the reference was measured
       (σ ≈ 2.9% of full range). Uniform noise of amplitude a has σ = a/√12,
       so the shader scales up by √12 to land on the number shown here. */
    /* Fluted glass: the field seen through vertical reeded glass. Every flute is
       a small cylindrical lens that shows its own stretched slice of what is
       behind it. Mix 0 switches the whole thing off, which is the default so
       existing looks are untouched. */
    { g: 'gGlass', key: 'fluteMix',     label: 'Amount',      min: 0,   max: 1,   step: 0.01, val: 0,    fmt: v => (v * 100).toFixed(0) + '%' },
    { g: 'gGlass', key: 'fluteCount',   label: 'Flutes',      min: 4,   max: 90,  step: 1,    val: 17,   fmt: v => v.toFixed(0) },
    { g: 'gGlass', key: 'fluteRefract', label: 'Refraction',  min: -10, max: 10,  step: 0.05, val: -3.5,  fmt: v => v.toFixed(2) + times },
    { g: 'gGlass', key: 'fluteShine',   label: 'Edge light',  min: 0,   max: 1.5, step: 0.01, val: 0.6, fmt: v => v.toFixed(2) },
    { g: 'gGlass', key: 'fluteBend',    label: 'Bend',        min: 0,   max: 1,   step: 0.01, val: 0, fmt: v => v.toFixed(2) },
    { g: 'gGlass', key: 'dots',         label: 'Dot grid',    min: 0,   max: 1,   step: 0.01, val: 0,    fmt: v => (v * 100).toFixed(0) + '%' },

    { g: 'gFinish', key: 'fadeBottom', label: 'Bottom fade', min: 0, max: 0.8, step: 0.01, val: 0, fmt: v => v ? (v * 100).toFixed(0) + '% of height' : 'off' },
    { g: 'gFinish', key: 'grain', label: 'Grain σ',  min: 0,    max: 0.09, step: 0.001, val: 0.029, fmt: v => (v * 100).toFixed(1) + '%' },
    { g: 'gFinish', key: 'scale', label: 'Render scale',  min: 0.25, max: 1,    step: 0.05,  val: 1.0,   fmt: v => v.toFixed(2) + times }
  ];

  const P = {};
  SPEC.forEach(s => P[s.key] = s.val);
  const DEFAULTS = Object.assign({}, P);

  /* Parameter-only presets, applied over DEFAULTS. */
  const PRESETS = {
    'Petrol':   {},
    'Ink':      { chroma: 0.32, travel: 16, lDark: 0.075, lLight: 0.72, grain: 0.036, srcCount: 2, srcSize: 0.8, wedgeGain: 0.85 },
    'Pool':     { srcCount: 4, srcSize: 0.40, srcGain: 0.95, srcSpread: 0.95, wedgeGain: 0.30, contrast: 1.35, warpAmt: 0.22 },
    'Vellum':   { hueShift: 150, chroma: 0.60, lDark: 0.42, lLight: 0.965, travel: 24, softness: 0.9, grain: 0.040, srcCount: 2 },
    'Nocturne': { hueShift: -24, chroma: 1.5, peak: 0.22, lDark: 0.045, lLight: 0.64, warpAmt: 0.28, angle: 312, srcCount: 4, srcGain: 0.9 }
  };

  /* Full looks, including source placement. Mirrors presets/*.json — kept
     inline because fetch() is blocked on file:// and this page is meant to
     open by double-clicking. */
  const LOOKS = {
    'Alice': {
      v: 1, space: 'oklch',
      params: {
        hueShift: -10, chroma: 1, peak: 0.32, travel: 46, lDark: 0.08, lLight: 0.98,
        srcCount: 3, srcSize: 0.52, srcGain: 0.98, srcSpread: 0.7, drift: 0.045,
        wedgeGain: 0.53, angle: 332, position: -0.07, softness: 0.46, asym: -0.85,
        contrast: 1, warpAmt: 0.7, warpScale: 0.25, speed: 2, grain: 0.029, scale: 1,
        fluteMix: 0, dots: 0, fadeBottom: 0.35
      },
      sources: [
        { x: 0.613,  y: 0.792, size: 1.09,  gain: 1.249 },
        { x: -0.862, y: 0.968, size: 1.378, gain: 0.972 },
        { x: 0.682,  y: 0.439, size: 0.979, gain: 1.197 }
      ]
    }
  };
  /* A darker field lit from the left, seen through fluted glass. The glass
     needs a mostly dark field with one light source to read as glass; over
     the bright Alice look it just slices the image into blinds. */
  LOOKS['Alice · fluted'] = {"v": 1, "space": "oklch", "params": {"hueShift": -10, "chroma": 1.9, "peak": 0.3, "travel": 46, "lDark": 0.06, "lLight": 0.74, "srcCount": 2, "srcSize": 0.9, "srcGain": 0.95, "srcSpread": 1, "drift": 0.03, "wedgeGain": 0.2, "angle": 332, "position": -0.07, "softness": 0.46, "asym": -0.85, "contrast": 1.15, "warpAmt": 0.2, "warpScale": 0.6, "speed": 0.6, "grain": 0.022, "scale": 1, "fluteMix": 1, "fluteCount": 13, "fluteRefract": -3.5, "fluteShine": 0.6, "fluteBend": 0, "dots": 0.3}, "sources": [{"x": -1.2, "y": 0.3, "rs": 1.35, "gs": 1.05}, {"x": -0.35, "y": 0.95, "rs": 1.0, "gs": 0.55}]};

  Object.assign(AG, {
    oklabToLinear, oklchToHex, fitChroma, rampAt, sampleBase,
    BASE, BASE_PEAK, BASE_LO, BASE_HI, BASE_HMID, BASE_TRAVEL,
    MAXSRC, SPEC, P, DEFAULTS, PRESETS, LOOKS
  });
})(window.AG);

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

/* ===========================================================================
   renderer.js — WebGL2. Two passes: the field into a 16-bit float target at
   `scale` resolution, then composite to the screen at full device resolution
   with grain and dither. Knows nothing about the UI.
   =========================================================================== */
(function (AG) {
  'use strict';

  const MAXSRC = AG.MAXSRC;

  /* opts.preserveDrawingBuffer — only the sandbox's still export needs it.
     The production embed passes false, which is faster. */
  function createRenderer(canvas, opts) {
    opts = opts || {};
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      preserveDrawingBuffer: opts.preserveDrawingBuffer !== false,
      alpha: false
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    const floatOK = !!gl.getExtension('EXT_color_buffer_float');

    function compile(src, type) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    }
    function program(fs) {
      const p = gl.createProgram();
      gl.attachShader(p, compile(AG.SHADERS.VERT, gl.VERTEX_SHADER));
      gl.attachShader(p, compile(fs, gl.FRAGMENT_SHADER));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }

    const progField = program(AG.SHADERS.FIELD);
    const progComp  = program(AG.SHADERS.COMPOSITE);
    const vao = gl.createVertexArray();
    const uF = {}, uC = {};
    ['uRes','uTime','uAngle','uPos','uSoft','uAsym','uWedge','uContrast',
     'uWarpAmt','uWarpScale','uCount','uSrc','uLut','uFade']
      .forEach(n => uF[n] = gl.getUniformLocation(progField, n));
    ['uRes','uGrain','uSrcTex','uFlute','uFluteN','uFluteK','uFluteShine','uFluteBend','uDots']
      .forEach(n => uC[n] = gl.getUniformLocation(progComp, n));

    /* LUT at 16-bit float so the ramp itself contributes no steps. 1024
       entries with linear filtering is effectively continuous. */
    const N = 1024, lutData = new Float32Array(N * 4);
    const lutTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, lutTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    function buildLut() {
      for (let i = 0; i < N; i++) {
        const c = AG.rampAt(i / (N - 1));
        const h = c.H * Math.PI / 180;
        lutData[i * 4]     = c.L;
        lutData[i * 4 + 1] = c.C * Math.cos(h);
        lutData[i * 4 + 2] = c.C * Math.sin(h);
        lutData[i * 4 + 3] = 1;
      }
      gl.bindTexture(gl.TEXTURE_2D, lutTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, N, 1, 0, gl.RGBA, gl.FLOAT, lutData);
    }

    const fbo = gl.createFramebuffer(), fboTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fboTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    let fw = 0, fh = 0;
    function sizeFbo(w, h) {
      if (w === fw && h === fh) return;
      fw = w; fh = h;
      gl.bindTexture(gl.TEXTURE_2D, fboTex);
      if (floatOK) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else         gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8,  w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    const srcBuf = new Float32Array(MAXSRC * 4);
    let W = 0, H = 0;

    /* Where a source actually sits this frame: its stored position scaled by
       spread, plus its own slow drift. The UI uses this for handle placement,
       so keep the two in step. */
    function livePos(s, clock) {
      const P = AG.P;
      return [ s.x * P.srcSpread + Math.sin(clock * s.fa + s.pa) * P.drift,
               s.y * P.srcSpread + Math.cos(clock * s.fb + s.pb) * P.drift ];
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (w !== W || h !== H) { W = w; H = h; canvas.width = w; canvas.height = h; return true; }
      return false;
    }
    function setSize(w, h) { W = w; H = h; canvas.width = w; canvas.height = h; }
    function getSize() { return [W, H]; }

    function draw(sources, clock) {
      const P = AG.P;
      const w = Math.max(2, Math.round(W * P.scale)), h = Math.max(2, Math.round(H * P.scale));
      sizeFbo(w, h);

      for (let i = 0; i < MAXSRC; i++) {
        const s = sources[i], pos = livePos(s, clock);
        srcBuf[i * 4]     = pos[0];
        srcBuf[i * 4 + 1] = pos[1];
        srcBuf[i * 4 + 2] = P.srcSize * s.rs;
        srcBuf[i * 4 + 3] = P.srcGain * s.gs;
      }

      gl.bindVertexArray(vao);

      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, w, h);
      gl.useProgram(progField);
      gl.uniform2f(uF.uRes, w, h);
      gl.uniform1f(uF.uTime, clock);
      gl.uniform1f(uF.uAngle, P.angle * Math.PI / 180);
      gl.uniform1f(uF.uPos, P.position);
      gl.uniform1f(uF.uSoft, P.softness);
      gl.uniform1f(uF.uAsym, P.asym);
      gl.uniform1f(uF.uWedge, P.wedgeGain);
      gl.uniform1f(uF.uContrast, P.contrast);
      gl.uniform1f(uF.uWarpAmt, P.warpAmt);
      gl.uniform1f(uF.uWarpScale, P.warpScale);
      gl.uniform1i(uF.uCount, P.srcCount | 0);
      gl.uniform1f(uF.uFade, P.fadeBottom || 0);
      gl.uniform4fv(uF.uSrc, srcBuf);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, lutTex);
      gl.uniform1i(uF.uLut, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(progComp);
      gl.uniform2f(uC.uRes, W, H);
      gl.uniform1f(uC.uGrain, P.grain);
      gl.uniform1f(uC.uFlute, P.fluteMix || 0);
      gl.uniform1f(uC.uFluteN, P.fluteCount || 17);
      gl.uniform1f(uC.uFluteK, P.fluteRefract === undefined ? -3.5 : P.fluteRefract);
      gl.uniform1f(uC.uFluteShine, P.fluteShine === undefined ? 0.65 : P.fluteShine);
      gl.uniform1f(uC.uFluteBend, P.fluteBend || 0);
      gl.uniform1f(uC.uDots, P.dots || 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fboTex);
      gl.uniform1i(uC.uSrcTex, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    return { gl, floatOK, buildLut, draw, resize, setSize, getSize, livePos };
  }

  AG.createRenderer = createRenderer;
})(window.AG);

/* ===========================================================================
   The design system's Alice gradient (AliceWeb.gradient: the Ground Study field with framing, zoom and moving
   grain), taken from ds/aliceweb/components/bundle.js unchanged, so the hero can show it as v5 did.
   =========================================================================== */
(function () {
  var Ground = (function () {
    function oklabToLinear(L, a, b) {
      var l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.2914855480 * b;
      var l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
      return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
    }
    function inGamut(L, C, H) { var h = H * Math.PI / 180; return oklabToLinear(L, C * Math.cos(h), C * Math.sin(h)).every(function (v) { return v >= -0.0005 && v <= 1.0005; }); }
    function fitChroma(L, C, H) { if (inGamut(L, C, H)) return C; var lo = 0, hi = C; for (var i = 0; i < 12; i++) { var m = (lo + hi) / 2; if (inGamut(L, m, H)) lo = m; else hi = m; } return lo; }
    var BASE = [
      { t: 0.00, L: 0.145, C: 0.008, H: 226 }, { t: 0.15, L: 0.200, C: 0.021, H: 224 }, { t: 0.32, L: 0.300, C: 0.033, H: 218 },
      { t: 0.55, L: 0.470, C: 0.030, H: 209 }, { t: 0.78, L: 0.660, C: 0.022, H: 199 }, { t: 1.00, L: 0.851, C: 0.012, H: 180 }];
    var BASE_PEAK = 0.32, BASE_LO = 0.145, BASE_HI = 0.851, BASE_HMID = 203, BASE_TRAVEL = 46, MAXSRC = 5, SLOPES = {};
    ["L", "C", "H"].forEach(function (f) {
      var n = BASE.length, h = [], d = [], m = new Array(n), i;
      for (i = 0; i < n - 1; i++) { h[i] = BASE[i + 1].t - BASE[i].t; d[i] = (BASE[i + 1][f] - BASE[i][f]) / h[i]; }
      m[0] = d[0]; m[n - 1] = d[n - 2];
      for (i = 1; i < n - 1; i++) {
        if (d[i - 1] * d[i] <= 0) m[i] = 0;
        else { var w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
      }
      SLOPES[f] = m;
    });
    function sampleBase(t, f) {
      var n = BASE.length;
      if (t <= BASE[0].t) return BASE[0][f];
      if (t >= BASE[n - 1].t) return BASE[n - 1][f];
      var i = 0; while (i < n - 2 && t > BASE[i + 1].t) i++;
      var a = BASE[i], b = BASE[i + 1], m = SLOPES[f], h = b.t - a.t, s = (t - a.t) / h, s2 = s * s, s3 = s2 * s;
      return (2 * s3 - 3 * s2 + 1) * a[f] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * b[f] + (s3 - s2) * h * m[i + 1];
    }
    function remapPeak(t, peak) { if (t <= peak) return peak <= 0 ? 0 : (t / peak) * BASE_PEAK; return BASE_PEAK + ((t - peak) / (1 - peak)) * (1 - BASE_PEAK); }
    function rampAt(t, Q) {
      var Lrel = (sampleBase(t, "L") - BASE_LO) / (BASE_HI - BASE_LO);
      var L = Q.lDark + Lrel * (Q.lLight - Q.lDark);
      var C0 = sampleBase(remapPeak(t, Q.peak), "C") * Q.chroma;
      var H = BASE_HMID + (sampleBase(t, "H") - BASE_HMID) * (Q.travel / BASE_TRAVEL) + Q.hueShift;
      return { L: L, C: fitChroma(L, C0, H), H: ((H % 360) + 360) % 360 };
    }
    // The saved Alice settings (Ground Study). "intensity" scales the chroma: 1 is the saved look, about 1.5 the film's stronger teal and mint.
    var SAVED = { hueShift: -10, chroma: 1, peak: 0.32, travel: 46, lDark: 0.08, lLight: 0.98, srcCount: 3, srcSize: 0.52, srcGain: 0.98, srcSpread: 0.7, drift: 0.045, wedgeGain: 0.53, angle: 332, position: -0.07, softness: 0.46, asym: -0.85, contrast: 1, warpAmt: 0.7, warpScale: 0.25, speed: 2, grain: 0.029 };
    var SOURCES = [{ x: 0.613, y: 0.792, size: 1.09, gain: 1.249 }, { x: -0.862, y: 0.968, size: 1.378, gain: 0.972 }, { x: 0.682, y: 0.439, size: 0.979, gain: 1.197 }];
    var VERT = "#version 300 es\nvoid main(){ vec2 p=vec2((gl_VertexID<<1)&2, gl_VertexID&2); gl_Position=vec4(p*2.0-1.0,0.0,1.0); }";
    var FIELD = "#version 300 es\nprecision highp float;\nuniform vec2 uRes,uShift;uniform float uTime,uAngle,uPos,uSoft,uAsym,uWedge,uContrast,uWarpAmt,uWarpScale,uFlip,uZoom;uniform int uCount;uniform vec4 uSrc[" + MAXSRC + "];uniform sampler2D uLut;out vec4 outColor;\n" +
      "float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}\n" +
      "float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),u.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),u.x),u.y);}\n" +
      "float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<4;i++){v+=a*vnoise(p);p*=2.02;a*=0.5;}return v;}\n" +
      "vec3 oklabToLinear(vec3 c){float l_=c.x+0.3963377774*c.y+0.2158037573*c.z,m_=c.x-0.1055613458*c.y-0.0638541728*c.z,s_=c.x-0.0894841775*c.y-1.2914855480*c.z;float l=l_*l_*l_,m=m_*m_*m_,s=s_*s_*s_;" +
      "return vec3(4.0767416621*l-3.3077115913*m+0.2309699292*s,-1.2684380046*l+2.6097574011*m-0.3413193965*s,-0.0041960863*l-0.7034186147*m+1.7076147010*s);}\n" +
      "void main(){vec2 uv=gl_FragCoord.xy/uRes;if(uFlip>0.5)uv.y=1.0-uv.y;vec2 p=uv-0.5;p.x*=uRes.x/uRes.y;p=p/uZoom+uShift;vec2 w=p*uWarpScale;" +
      "float n1=fbm(w+vec2(0.0,uTime*0.055));float n2=fbm(w+vec2(5.2,1.3)-vec2(uTime*0.041,0.0));p+=vec2(n1-0.5,n2-0.5)*uWarpAmt;" +
      "float ca=cos(uAngle),sa=sin(uAngle);vec2 q=vec2(p.x*ca-p.y*sa,p.x*sa+p.y*ca);float soft=max(uSoft*exp(-uAsym*q.x),0.015);float f=uWedge*(0.5+0.5*tanh((q.y+uPos)/soft));" +
      "for(int i=0;i<" + MAXSRC + ";i++){if(i>=uCount)break;vec2 d=p-uSrc[i].xy;float r2=dot(d,d)/max(uSrc[i].z*uSrc[i].z,1e-5);f+=uSrc[i].w*exp(-r2*1.6);}" +
      "float v=(f-0.5)*uContrast+0.5;float t=smoothstep(-0.08,1.08,v);outColor=vec4(max(oklabToLinear(texture(uLut,vec2(t,0.5)).rgb),vec3(0.0)),1.0);}";
    var COMPOSITE = "#version 300 es\nprecision highp float;\nuniform sampler2D uSrcTex;uniform vec2 uRes;uniform float uGrain,uFrame;out vec4 outColor;\n" +
      "uint uhash(uvec2 p){uint h=p.x*374761393u+p.y*668265263u;h=(h^(h>>13))*1274126177u;return h^(h>>16);}\nfloat rnd(uvec2 p){return float(uhash(p))*(1.0/4294967296.0);}\n" +
      "vec3 encode(vec3 c){c=max(c,vec3(0.0));return mix(12.92*c,1.055*pow(c,vec3(1.0/2.4))-0.055,step(vec3(0.0031308),c));}\n" +
      "void main(){uvec2 fc=uvec2(gl_FragCoord.xy);vec3 c=encode(texture(uSrcTex,gl_FragCoord.xy/uRes).rgb);uvec2 o=uvec2(uint(uFrame)*7919u,uint(uFrame)*104729u);" +
      "float g=rnd(fc+uvec2(11u,29u)+o)-0.5;c+=g*uGrain*3.4641016;float d=rnd(fc+o)-rnd(fc+uvec2(7919u,104729u)+o);c+=d*(1.0/255.0);outColor=vec4(clamp(c,0.0,1.0),1.0);}";

    function create(canvas, opts) {
      opts = opts || {};
      var P = {}, k; for (k in SAVED) P[k] = SAVED[k];
      for (k in (opts.params || {})) P[k] = opts.params[k];
      P.chroma = SAVED.chroma * (opts.intensity || 1);
      var gl = null;
      try { gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true, alpha: false }); } catch (e) { gl = null; }
      if (!gl) return null;
      function compile(src, type) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
      function program(fs) { var p = gl.createProgram(); gl.attachShader(p, compile(VERT, gl.VERTEX_SHADER)); gl.attachShader(p, compile(fs, gl.FRAGMENT_SHADER)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }
      function texParams() { [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(function (n) { gl.texParameteri(gl.TEXTURE_2D, n, gl.LINEAR); }); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
      var progF, progC, vao, lut, fbo, fboTex, floatOK, uF = {}, uC = {}, fw = 0, fh = 0;
      try {
        floatOK = !!gl.getExtension("EXT_color_buffer_float");
        progF = program(FIELD); progC = program(COMPOSITE); vao = gl.createVertexArray();
        ["uRes", "uShift", "uTime", "uAngle", "uPos", "uSoft", "uAsym", "uWedge", "uContrast", "uWarpAmt", "uWarpScale", "uFlip", "uZoom", "uCount", "uSrc", "uLut"].forEach(function (n) { uF[n] = gl.getUniformLocation(progF, n); });
        ["uRes", "uGrain", "uSrcTex", "uFrame"].forEach(function (n) { uC[n] = gl.getUniformLocation(progC, n); });
        lut = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, lut); texParams();
        var N = 1024, data = new Float32Array(N * 4);
        for (var i = 0; i < N; i++) { var r = rampAt(i / (N - 1), P), h = r.H * Math.PI / 180; data[i * 4] = r.L; data[i * 4 + 1] = r.C * Math.cos(h); data[i * 4 + 2] = r.C * Math.sin(h); data[i * 4 + 3] = 1; }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, N, 1, 0, gl.RGBA, gl.FLOAT, data);
        fbo = gl.createFramebuffer(); fboTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, fboTex); texParams();
      } catch (e) { return null; }
      var seed = 7, rnd = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }, src = [];
      for (var j = 0; j < MAXSRC; j++) src.push({ x: rnd() * 2 - 1, y: rnd() * 2 - 1, rs: 0.6 + rnd() * 0.8, gs: (j === MAXSRC - 1 ? -0.7 : 0.6 + rnd() * 0.7), pa: rnd() * 6.283, pb: rnd() * 6.283, fa: 0.17 + rnd() * 0.23, fb: 0.13 + rnd() * 0.21 });
      SOURCES.forEach(function (s, i) { src[i].x = s.x; src[i].y = s.y; src[i].rs = s.size; src[i].gs = s.gain; });
      var buf = new Float32Array(MAXSRC * 4), fieldScale = opts.fieldScale || 0.5, shift = opts.shift || [0, 0];
      function draw(t, frame, W, H) {
        if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
        var clock = t * P.speed;
        for (var i = 0; i < MAXSRC; i++) {
          var s = src[i];
          buf[i * 4] = s.x * P.srcSpread + Math.sin(clock * s.fa + s.pa) * P.drift; buf[i * 4 + 1] = s.y * P.srcSpread + Math.cos(clock * s.fb + s.pb) * P.drift;
          buf[i * 4 + 2] = P.srcSize * s.rs; buf[i * 4 + 3] = P.srcGain * s.gs;
        }
        var w = Math.max(2, Math.round(W * fieldScale)), h = Math.max(2, Math.round(H * fieldScale));
        if (w !== fw || h !== fh) {
          fw = w; fh = h; gl.bindTexture(gl.TEXTURE_2D, fboTex);
          if (floatOK) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null); else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
        gl.bindVertexArray(vao);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h); gl.useProgram(progF);
        gl.uniform2f(uF.uRes, w, h); gl.uniform2f(uF.uShift, shift[0], shift[1]); gl.uniform1f(uF.uTime, clock); gl.uniform1f(uF.uAngle, P.angle * Math.PI / 180);
        gl.uniform1f(uF.uPos, P.position); gl.uniform1f(uF.uSoft, P.softness); gl.uniform1f(uF.uAsym, P.asym); gl.uniform1f(uF.uWedge, P.wedgeGain);
        gl.uniform1f(uF.uContrast, P.contrast); gl.uniform1f(uF.uWarpAmt, P.warpAmt); gl.uniform1f(uF.uWarpScale, P.warpScale);
        gl.uniform1f(uF.uFlip, opts.invert ? 1 : 0); gl.uniform1f(uF.uZoom, opts.zoom || 1);
        gl.uniform1i(uF.uCount, P.srcCount); gl.uniform4fv(uF.uSrc, buf);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, lut); gl.uniform1i(uF.uLut, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); gl.useProgram(progC);
        gl.uniform2f(uC.uRes, W, H); gl.uniform1f(uC.uGrain, P.grain); gl.uniform1f(uC.uFrame, frame || 0);
        gl.bindTexture(gl.TEXTURE_2D, fboTex); gl.uniform1i(uC.uSrcTex, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      // the colour at the light end, so a section can match the field's top exactly
      var top = rampAt(1, P), th = top.H * Math.PI / 180, lin = oklabToLinear(top.L, top.C * Math.cos(th), top.C * Math.sin(th));
      var hex = "#" + lin.map(function (c) { c = Math.max(0, Math.min(1, c)); c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return ("0" + Math.round(c * 255).toString(16)).slice(-2); }).join("");
      return { draw: draw, lightColor: hex, params: P };
    }
    return { create: create };
  })();
  window.AliceDSGround = Ground;
})();

/* ===========================================================================
   site.js — the gradient on alice.law.

   Puts the looks above on the website. Every element with data-alice-ground gets a canvas
   that fades in over the still under it (the element's own background, see README.md), and
   it is kept cheap: it only starts when its section comes near the screen, pauses when it is
   scrolled away or the tab is hidden, draws 30 frames a second unless told otherwise, stops
   moving on a device that cannot keep up, and shows one still frame to people who turn
   motion off. Without WebGL 2 nothing happens and the still stays.

   1.3.0: each gradient draws straight into its own canvas, the one on the page, with a WebGL
   context of its own. v9 drew every gradient into one hidden canvas and copied each frame
   from there onto the canvas on the page; on some computers (seen on Windows, with an external
   screen) the page could show a copy that was only partly updated, as a rectangle of the
   gradient a moment out of step. Drawn straight into the canvas on the page, a frame reaches
   the screen whole, and there is no copy to make. The looks, and how a frame is drawn, are
   v9's: a frame here is v9's frame, pixel for pixel (with 1.1.0's exception: a box too big for
   a canvas, 2600 device pixels either way, is drawn at a lower resolution in both directions,
   so it keeps its proportions, where v9 squeezed it in one).
   When its canvas has faded in, the element gets data-alice-live, so the page's CSS can take
   the still's grain away under it (it no longer shows, and the browser no longer mixes it in).

     <div data-alice-ground="close"></div>       close · hero · plan (an element that is positioned)
     <script src=".../alice-ground.min.js" data-fps="30" async></script>     30 or 60
   On alice.law the loader in the site's footer code adds that script tag (see the README).

   window.AliceGround: mount(canvas, look), attach(element), scan(), relook(canvas, look),
   still(look, w, h), setFps(n), freeze(), LOOKS, look(name), items, version, and for testing:
   redraw() (draws every gradient now), fps, frozen, running, drawn (frames drawn so far),
   webgl (true, false, or null before the first frame).
   =========================================================================== */
(function () {
  'use strict';
  if (window.AliceGround) return;                    // loaded twice: the first one runs the page
  var VERSION = '1.3.0';
  var me = document.currentScript;

  // ---------------------------------------------------------------- looks (v9's, unchanged)
  var AG = window.AG;
  var BASE = {
    hueShift: -10, chroma: 1, peak: 0.32, travel: 46, lDark: 0.08, lLight: 0.98,
    srcCount: 3, srcSize: 0.52, srcGain: 0.98, srcSpread: 0.7, drift: 0.045,
    wedgeGain: 0.53, angle: 332, position: -0.07, softness: 0.46, asym: -0.85,
    contrast: 1, warpAmt: 0.7, warpScale: 0.25, speed: 2, grain: 0.029, scale: 0.5,
    fluteMix: 0, dots: 0, fadeBottom: 0.35
  };
  var ALICE_SRC = [{ x: 0.613, y: 0.792, size: 1.09, gain: 1.249 }, { x: -0.862, y: 0.968, size: 1.378, gain: 0.972 }, { x: 0.682, y: 0.439, size: 0.979, gain: 1.197 }];
  function S(list) { return list.map(function (a) { return { x: a[0], y: a[1], size: a[2], gain: a[3] }; }); }
  var LOOKS = {
    alice: { params: {}, sources: ALICE_SRC, time: 0 },
    // the hero: v5's, the design system's field in its hero framing, a little lower and closer, with stronger colour
    hero: { ds: { framing: 'hero', intensity: 1.9, zoom: 0.8, time: 3, params: { position: 0.08 } } },
    // the closing: light falling from the top, dark at the bottom (v8)
    close: { params: { chroma: 1.2, position: 0.14, warpAmt: 0.35 },
             sources: S([[0, 0.3, 1.0, 0.9], [-0.862, 0.968, 1.378, 0.972], [0.682, 0.6, 0.979, 1.0]]), time: 40 },
    'close-phone': { params: { chroma: 1.2, position: 0.3, warpAmt: 0.35 },
             sources: S([[0, 0.15, 0.75, 1.0], [-0.862, 0.968, 0.8, 0.972], [0.682, 0.6, 0.6, 1.0]]), time: 40 },
    // the plan: a dark version, deep petrol lit from the top right, moving slowly (v8)
    plan: { params: { lDark: 0.07, lLight: 0.62, chroma: 1.25, fadeBottom: 0, wedgeGain: 0.6, position: 0, softness: 0.7, contrast: 0.9, warpAmt: 0.4, speed: 1 },
            sources: S([[0.8, 0.6, 1.0, 0.55], [-0.8, 0.8, 0.7, 0.2], [0.6, -0.8, 0.6, 0.15]]), time: 0 }
  };
  LOOKS['hero-phone'] = LOOKS.hero;
  LOOKS['plan-phone'] = LOOKS.plan;
  var DS_FRAMING = { hero: { params: { position: -0.07 }, zoom: 1 } };   // the design system's framings used here
  function look(l) {
    var o = typeof l === 'string' ? (LOOKS[l] || LOOKS.alice) : (l || LOOKS.alice);
    if (o.ds) {
      var f = DS_FRAMING[o.ds.framing] || DS_FRAMING.hero, d = {}, k;
      for (k in f) d[k] = f[k];
      for (k in o.ds) if (k !== 'framing' && o.ds[k] !== undefined) d[k] = o.ds[k];
      if (d.intensity == null) d.intensity = 1.5;
      return { ds: d };
    }
    return { params: Object.assign({}, BASE, o.params || {}), sources: o.sources || ALICE_SRC, time: o.time || 0 };
  }

  // Same PRNG and seed as the sandbox and the embed, so drift phases match.
  function makeSources(list) {
    var seed = 7;
    function rand() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    var sources = [];
    for (var i = 0; i < AG.MAXSRC; i++) {
      sources.push({
        x: rand() * 2 - 1, y: rand() * 2 - 1,
        rs: 0.6 + rand() * 0.8,
        gs: (i === AG.MAXSRC - 1 ? -0.7 : 0.6 + rand() * 0.7),
        pa: rand() * 6.283, pb: rand() * 6.283,
        fa: 0.17 + rand() * 0.23, fb: 0.13 + rand() * 0.21
      });
    }
    (list || []).slice(0, AG.MAXSRC).forEach(function (s, i) {
      var t = sources[i];
      if (typeof s.x === 'number') t.x = s.x;
      if (typeof s.y === 'number') t.y = s.y;
      var rs = (typeof s.rs === 'number') ? s.rs : s.size;
      var gs = (typeof s.gs === 'number') ? s.gs : s.gain;
      if (typeof rs === 'number') t.rs = rs;
      if (typeof gs === 'number') t.gs = gs;
      ['pa', 'pb', 'fa', 'fb'].forEach(function (k) { if (typeof s[k] === 'number') t[k] = s[k]; });
    });
    return sources;
  }

  // ---------------------------------------------------------------- settings
  function readFps(v) { v = +v; return v > 0 ? Math.max(10, Math.min(120, v)) : 30; }
  var fps = readFps(me && me.getAttribute('data-fps'));
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var PHONE = 479;                   // Webflow's phone breakpoint: a ground this wide or narrower takes its phone look
  var MAXW = 2600, MAXH = 2600;      // v9's limits on a canvas, in device pixels
  var FADE = 900;                    // ms: the canvas fades in over the still
  // Each canvas's own context. Opaque (the gradient covers its whole box), double-buffered (a frame is shown whole,
  // once it is finished), no extras it doesn't use, and asking the computer for its everyday graphics chip.
  var ATTRS = { alpha: false, premultipliedAlpha: true, preserveDrawingBuffer: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };

  // ---------------------------------------------------------------- drawing (v9's, straight into the item's canvas)
  var items = [], raf = 0, last = 0, frozen = false, dead = false, startedAt = 0, slowFor = 0, drawn = 0, ever = false;

  // the item's WebGL context, made the first time it draws
  function context(it) {
    if (it.gl) {
      if (!it.gl.isContextLost()) return it.gl;
      // taken away and not given back: a new canvas, with a new context (attach()'s canvases only)
      if (it.el && it.lostAt && performance.now() - it.lostAt > 2500) renew(it); else return null;
    }
    var gl = null;
    try { gl = it.canvas.getContext('webgl2', ATTRS); } catch (e) { gl = null; }
    if (!gl) { if (!ever) dead = true; return null; }   // no WebGL 2 on this device: the stills stay
    it.gl = gl; ever = true;
    return gl;
  }
  function listen(it, c) {
    c.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();                                // ask for it back
      it.lostAt = performance.now(); it.r = null;
      hide(it);                                          // the still shows until it is back
    });
    c.addEventListener('webglcontextrestored', function () { it.lostAt = 0; it.r = null; if (it.visible) kick(); else idle(function () { drawOne(it); }); });
  }
  function renew(it) {
    var old = it.canvas, c = document.createElement('canvas');
    c.setAttribute('aria-hidden', 'true');
    c.style.cssText = old.style.cssText;
    c.style.opacity = '0';
    c._ground = it;
    if (old.parentNode) old.parentNode.replaceChild(c, old);
    old._ground = null;
    it.canvas = c; it.gl = null; it.r = null; it.w = it.h = 0; it.lostAt = 0;
    listen(it, c);
  }
  // what a renderer sees as its canvas: the item's context, and a size it may set freely (the real canvas is sized
  // in measure(), only when it changes: setting a canvas's size clears it)
  function stand(it) { return { getContext: function () { return it.gl; }, width: 1, height: 1, clientWidth: 1, clientHeight: 1 }; }
  function build(it) {
    try {
      if (it.L.ds) { it.r = window.AliceDSGround.create(stand(it), it.L.ds); }
      else {
        Object.assign(AG.P, it.L.params);
        it.r = AG.createRenderer(stand(it), { preserveDrawingBuffer: false });
        it.r.buildLut();
      }
    } catch (e) { it.r = null; }
    return !!it.r;
  }
  function measure(it) {
    var r = it.canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    // device pixels per CSS pixel; a box too big for the limits gets fewer, the same both ways (v9 cut each side
    // separately, which squeezed the gradient sideways on very large screens)
    var s = Math.min(dpr, MAXW / Math.max(1, r.width), MAXH / Math.max(1, r.height));
    var w = Math.max(2, Math.min(MAXW, Math.round(r.width * s))), h = Math.max(2, Math.min(MAXH, Math.round(r.height * s)));
    if (w !== it.w || h !== it.h) { it.w = w; it.h = h; it.canvas.width = w; it.canvas.height = h; }
  }
  function drawOne(it) {
    if (dead) return false;
    var gl = context(it);
    if (!gl) return false;
    if (!it.r && !build(it)) return false;
    measure(it);
    gl.disable(gl.BLEND); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (it.L.ds) {
      it.r.draw((it.L.ds.time || 0) + it.clock * (it.L.ds.speed || 1), reduced ? 0 : it.frame++, it.w, it.h);
    } else {
      Object.assign(AG.P, it.L.params);
      it.r.setSize(it.w, it.h);
      it.r.draw(it.sources, it.clock);
    }
    if (!it.ready) show(it);
    drawn++;
    return true;
  }
  // the first frame is on the canvas: it fades in, and once it covers the still the element says so
  function show(it) {
    it.ready = true;
    it.canvas.setAttribute('data-ready', '');
    if (!it.el) return;
    it.canvas.style.transitionDuration = FADE + 'ms';   // the fade in (hide() takes it away)
    it.canvas.style.opacity = '1';
    clearTimeout(it.liveT);
    it.liveT = setTimeout(function () { if (it.ready) it.el.setAttribute('data-alice-live', ''); }, FADE + 50);
  }
  function hide(it) {                                // at once: a canvas without its context has nothing to show
    it.ready = false;
    clearTimeout(it.liveT);
    it.canvas.removeAttribute('data-ready');
    if (!it.el) return;
    it.el.removeAttribute('data-alice-live');
    it.canvas.style.transitionDuration = '0ms';
    it.canvas.style.opacity = '0';
  }

  // ---------------------------------------------------------------- the loop
  // Time-based, as in v9: the motion has the same speed at any frame rate; only how often it is drawn changes.
  function tick(now) {
    raf = 0;
    if (dead) return;
    var gap = now - last;
    if (gap < 1000 / fps - 2) { raf = requestAnimationFrame(tick); return; }   // hold to the frame rate
    var dt = Math.max(0, Math.min(gap / 1000, 0.1)); last = now;
    var any = false;
    items.forEach(function (it) {
      if (!it.visible) return;
      any = true;
      if (!reduced && !frozen) it.clock += dt * (it.L.ds ? 1 : it.L.params.speed);
      drawOne(it);
    });
    if (dead) return;                                   // no WebGL 2: the stills stay
    if (any) pace(gap, now);
    if (any && !reduced && !frozen && !document.hidden) raf = requestAnimationFrame(tick);
  }
  // A device that can't keep up (under 12 frames a second for 2.5 seconds, once the page has settled)
  // stops moving and keeps its last frame, as with reduced motion.
  function pace(gap, now) {
    if (now - startedAt < 2000) return;
    if (gap > 1000 / 12) { slowFor += gap; if (slowFor > 2500) freeze(); }
    else slowFor = 0;
  }
  function freeze() { frozen = true; stopLoop(); }
  function kick() {
    if (raf || dead || document.hidden) return;
    var now = performance.now();
    if (!startedAt) startedAt = now;
    last = now; raf = requestAnimationFrame(tick);
  }
  function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  // On screen (with a margin): animate. Near the screen: get ready while the browser is idle.
  var hasIO = 'IntersectionObserver' in window;
  var seen = hasIO ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { var it = e.target._ground; if (it) it.visible = e.isIntersecting; });
    if (items.some(function (it) { return it.visible; })) kick(); else stopLoop();
  }, { rootMargin: '200px 0px' }) : null;
  var near = hasIO ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var it = e.target._ground;
      if (!it || !e.isIntersecting) return;
      near.unobserve(e.target);
      idle(function () { if (!it.r && !dead) drawOne(it); });
    });
  }, { rootMargin: '150% 0px' }) : null;
  function idle(fn) { if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: 600 }); else setTimeout(fn, 60); }
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopLoop(); else kick(); });

  // mount(canvas, look): v9's call. lazy = wait until it comes near the screen before drawing.
  // The element the observers watch is the ground itself when there is one (attach()), else the canvas.
  function mount(canvas, l, lazy, el) {
    if (!canvas || canvas._ground) return canvas && canvas._ground;
    var L = look(l), box = el || canvas;
    var it = { canvas: canvas, el: el || null, L: L, sources: L.ds ? null : makeSources(L.sources), clock: L.ds ? 0 : L.time, frame: 0, visible: !hasIO,
               w: 0, h: 0, r: null, gl: null, lostAt: 0, ready: false, liveT: 0 };
    canvas._ground = it; box._ground = it;
    items.push(it);
    listen(it, canvas);
    if (!lazy) drawOne(it);                        // v9: one frame straight away, so it never waits for the observer
    if (hasIO) { seen.observe(box); if (lazy) near.observe(box); } else kick();
    if (window.ResizeObserver) new ResizeObserver(function () {
      if (it.el) { var v = variant(it.el, it.name); if (v !== it.lookName) { it.lookName = v; relook(it.canvas, v); return; } }
      if (it.r && !raf) drawOne(it);
    }).observe(box);
    return it;
  }
  // a look's field changed in place (a phone look, or comparing looks on the page itself)
  function relook(canvas, l) {
    var it = canvas && canvas._ground; if (!it) return;
    var L = look(l), started = !!it.r; it.L = L; it.sources = L.ds ? null : makeSources(L.sources); it.clock = L.ds ? 0 : L.time; it.r = null;
    if (started) drawOne(it);
  }
  // a still of a look at a size (the image under each field): drawn on a canvas of its own, which is let go of after
  function still(l, w, h) {
    var c = document.createElement('canvas'); c.style.cssText = 'position:fixed;left:0;top:0;width:' + w + 'px;height:' + h + 'px;visibility:hidden';
    document.body.appendChild(c);
    var L = look(l), gl = null;
    try { gl = c.getContext('webgl2', { alpha: false, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false }); } catch (e) { gl = null; }
    var it = { canvas: c, L: L, sources: L.ds ? null : makeSources(L.sources), clock: L.ds ? 0 : L.time, frame: 0, w: 0, h: 0, gl: gl, ready: true };
    var dpr = window.devicePixelRatio; Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
    if (gl) drawOne(it);
    Object.defineProperty(window, 'devicePixelRatio', { value: dpr, configurable: true });
    var url = c.toDataURL('image/png');
    var lose = gl && gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    c.remove();
    return url;
  }

  // ---------------------------------------------------------------- the website's markup
  function variant(el, name) {
    var w = el.getBoundingClientRect().width;
    return w > 0 && w <= PHONE && LOOKS[name + '-phone'] ? name + '-phone' : name;
  }
  function attach(el) {
    if (!el || el._aliceGround) return el && el._aliceGround;
    var name = el.getAttribute('data-alice-ground') || 'alice', v = variant(el, name);
    var c = document.createElement('canvas');
    c.setAttribute('aria-hidden', 'true');
    c.style.cssText = 'position:absolute;left:0;top:0;z-index:1;display:block;width:100%;height:100%;pointer-events:none;opacity:0;transition:opacity ' + FADE + 'ms cubic-bezier(.2,.8,.2,1)';
    el.appendChild(c);
    el._aliceGround = true;                        // claimed (mount sets the item)
    var it = mount(c, v, true, el);
    it.name = name; it.lookName = v;
    el._aliceGround = it;
    return it;
  }
  function scan(root) { Array.prototype.forEach.call((root || document).querySelectorAll('[data-alice-ground]'), attach); }
  if (!window.WebGL2RenderingContext) dead = true;   // the stills stay
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { scan(); });
  else scan();

  window.AliceGround = {
    version: VERSION, mount: function (canvas, l, lazy) { return mount(canvas, l, lazy); }, attach: attach, scan: scan, relook: relook, still: still, look: look, LOOKS: LOOKS, items: items,
    setFps: function (n) { fps = readFps(n); }, freeze: freeze,
    redraw: function () { items.forEach(function (it) { drawOne(it); }); },
    get fps() { return fps; }, get frozen() { return frozen; }, get running() { return !!raf; }, get drawn() { return drawn; },
    get webgl() { return dead ? false : ever ? true : null; }
  };
  if (!window.AliceGround9) window.AliceGround9 = window.AliceGround;   // v9's name
})();
