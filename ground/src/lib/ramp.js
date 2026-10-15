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
