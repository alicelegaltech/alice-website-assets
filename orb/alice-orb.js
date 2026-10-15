/*! Alice orb 1.0.0: the orb on alice.law. Built from src/ by tools/build.mjs. */
(function () {
'use strict';
if (window.AliceOrbSite) return;   // loaded twice: the first one runs the page
var AliceOrb;

/* src/gl.js: the page's one WebGL context, shared by every orb and every gradient on the page.
   The same code as Alice Ground's (ground/src/site.js), which has it from v9: if the gradient's script got here
   first, its context is used and the page has one WebGL context for both. The context is made only when an orb
   first needs it, not when the script loads. */
var AliceGL = window.AliceGL || (function () {
  var canvas = null, gl = null, clients = [], res = {}, lostAt = 0, ever = false;
  function make() {
    canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 1024;
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();                                  // ask for it back
      lostAt = performance.now(); res = {};
      clients.forEach(function (c) { if (c.lost) c.lost(); });
    });
    canvas.addEventListener('webglcontextrestored', function () { lostAt = 0; res = {}; ready(); });
    gl = null;
    try { gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false }); } catch (e) { gl = null; }
    if (gl && !gl.isContextLost()) ready();
  }
  function ready() { ever = true; clients.forEach(function (c) { c.init(gl); }); }
  function ok() {
    if (!canvas) make();
    if (gl && !gl.isContextLost()) return true;
    // taken and not given back: a new one (it may take the place of another page's)
    if (lostAt && performance.now() - lostAt > 2500) { lostAt = performance.now(); make(); }
    return !!(gl && !gl.isContextLost());
  }
  return {
    ok: ok,
    get gl() { return gl; },
    get canvas() { return canvas; },
    get ever() { return ever; },
    get tried() { return !!canvas; },
    client: function (c) { clients.push(c); if (gl && !gl.isContextLost()) c.init(gl); },
    res: function (key, build) { if (!(key in res)) res[key] = build(); return res[key]; },
    need: function (w, h) { if (canvas.width < w) canvas.width = w; if (canvas.height < h) canvas.height = h; }
  };
})();
if (!window.AliceGL) window.AliceGL = AliceGL;

/* src/lib/orb.js: the Alice orb, copied UNCHANGED from homepage v9 (alice-app-v9.js, lines 1380-1853),
   which lifted it from the Orb Lab. It assigns the variable AliceOrb, which tools/build.mjs declares, and it draws
   through window.AliceGL (src/gl.js). Change nothing here; the website's part is src/site.js. */
// The Alice orb (Ink or Ring), lifted from the Orb Lab: one WebGL2 context draws every
// canvas.orb on the page. Time is driven from outside (step), so a video can be rendered
// frame by frame and always look the same.
AliceOrb = (function () {
  "use strict";
  const clamp01 = n => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
  const lerp = (a, b, t) => a + (b - a) * t;
  const LOOKS = ["ink", "ribbon", "bands", "twist", "ring"];   // the index is u_look in the shader
  // Ink: Dominique's settings. Ring: the lab defaults with the streak of light at rest.
  const SET = {
    ink:  { amount: 1, scale: 0, swirl: 0.45, softness: 0.35, depth: 0.58, edge: 0.6, gloss: 0, glow: 0.5, halo: 0, grain: 0.1, speed: 1, movement: 1, reaction: 0.8, snap: 0, seed: 7 },
    ring: { amount: 0.85, scale: 0.5, swirl: 0.5, softness: 0.5, depth: 0.5, edge: 0.7, gloss: 0.5, glow: 0.6, halo: 0.5, grain: 0.02, speed: 1, movement: 1, reaction: 0.8, snap: 0, seed: 7 },
  };
  const INK_COLORS = { deep: "#03090B", ink: "#0F2E33", tint: "#5E8A8C", clear: "#EEF3F3", glow: "#80E0E6" };
  const RING_COLORS = { c1: "#1FC4F5", c2: "#1446FF", c3: "#7A18FF", metal: "#DCE1E8" };
  // The Ring at rest. "now" is the silver ring as designed; the others give it more colour and presence when idle
  // (colour it keeps at rest, the silver anodised in its colours, a soft light round it, extra line weight).
  const IDLE = {
    now:    { restE: 0,    anod: 0, aura: 0, weight: 0 },
    colour: { restE: 0.5,  anod: 0, aura: 0, weight: 0.6 },
    metal:  { restE: 0,    anod: 1, aura: 0, weight: 0.6 },
    glow:   { restE: 0.5,  anod: 0, aura: 1, weight: 0.6 },
  };
  let look = "ink", theme = 0, idle = "now", fillScale = 1;
  const S = () => SET[look];
  // ================================================================ colour maths
  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
  function s2l(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function l2s(c) { c = Math.max(0, c); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
  function toOklab(rgb) {
    const r = s2l(rgb[0]), g = s2l(rgb[1]), b = s2l(rgb[2]);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }
  function okToSrgb(c) {
    const l_ = c[0] + 0.3963377774 * c[1] + 0.2158037573 * c[2];
    const m_ = c[0] - 0.1055613458 * c[1] - 0.0638541728 * c[2];
    const s_ = c[0] - 0.0894841775 * c[1] - 1.2914855480 * c[2];
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    return [l2s(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), l2s(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), l2s(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)];
  }
  function monoSlopes(xs, ys) {
    const n = xs.length, h = [], d = [], m = [];
    for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) m[i] = 0;
      else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
    }
    return m;
  }
  function hermite(xs, ys, ms, t) {
    const n = xs.length;
    if (t <= xs[0]) return ys[0];
    if (t >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (i < n - 2 && t > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], s = (t - xs[i]) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * h * ms[i] + (-2 * s3 + 3 * s2) * ys[i + 1] + (s3 - s2) * h * ms[i + 1];
  }
  function ramp(stops, T) {
    stops = stops.map(x => typeof x === "string" ? x : rgbToHex(x));
    const labs = stops.map(h => toOklab(hexToRgb(h)));
    const ch = [0, 1, 2].map(k => labs.map(x => x[k]));
    const ms = ch.map(ys => monoSlopes(T, ys));
    const out = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      const rgb = okToSrgb([0, 1, 2].map(k => hermite(T, ch[k], ms[k], t)));
      for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(clamp01(rgb[c]) * 255);
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  // Row 0: the light reading (clear water, ink gets darker). Row 1: the dark reading (dark water, ink glows).
  function buildLut(c) {
    const out = new Uint8Array(256 * 2 * 4);
    out.set(ramp([c.clear, mixOk(c.clear, c.glow, 0.45), c.tint, c.ink, c.deep], [0, 0.22, 0.5, 0.82, 1]), 0);
    out.set(ramp([c.deep, c.ink, c.glow, c.clear], [0, 0.34, 0.72, 1]), 256 * 4);
    return out;
  }
  function rgbToHex(c) { return "#" + c.map(x => Math.round(clamp01(x) * 255).toString(16).padStart(2, "0")).join(""); }
  function mixOk(h1, h2, t) { const a = toOklab(hexToRgb(h1)), b = toOklab(hexToRgb(h2)); return okToSrgb([0, 1, 2].map(k => a[k] + (b[k] - a[k]) * t)); }

  // ================================================================ renderer
  const FRAG = "#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler3D;\n\nuniform vec2 u_res;\nuniform vec2 u_win;\nuniform float u_size;\nuniform int u_look;        // 0 ink, 1 ribbon, 2 bands, 4 ring (3, twist, has its own programs)\nuniform int u_steps;\nuniform float u_theme;     // 0 light, 1 dark\nuniform float u_flow;      // accumulated clocks: they speed up and slow down, never jump\nuniform float u_turn;\nuniform float u_wave;\nuniform float u_time;\nuniform float u_seed;\nuniform float u_gseed;\nuniform float u_in, u_out, u_think, u_listen, u_fill, u_prog, u_exhale, u_busy, u_amount;\nuniform float u_scale, u_swirl, u_soft, u_depth, u_edge, u_gloss, u_glow, u_halo, u_grain;\nuniform vec3 u_glowLin, u_tintLin, u_shadowSrgb, u_glowSrgb;\nuniform sampler2D u_lut;   // 256 x 2: row 0 light reading, row 1 dark reading\nuniform sampler3D u_noise; // tileable noise, 4 independent channels, period 8 units\nuniform mat3 u_ribRot;     // the ribbon's orientation, turned a little every frame\nuniform vec3 u_rc1, u_rc2, u_rc3, u_rmetal;   // ring colours (linear)\nuniform float u_energy, u_read, u_comet;      // ring: how alive the whole ring is; reading amount; the light that runs round at rest\n// ring at rest (all 0 = the silver ring as designed): how much colour it keeps when idle; the silver anodised in the\n// ring's colours; a soft light round and inside it; extra line weight\nuniform float u_restE, u_anod, u_aura, u_weight;\n// how different the states look from rest (all 0 = as designed): more movement from what Alice is doing, a breath in\n// size, a brighter and heavier line (Ring) or more glow and denser ink (Ink) while working, the unread part dimming while reading\nuniform float u_moveX, u_grow, u_work, u_readDim;\nuniform float u_workE;   // Ring: how much Alice is working, without listening (so listening can stay calm)\n// Ring: a movement of its own for each state (all 0 = as designed). Listening breathes (-1..1), thinking spins (the light\n// gathers into points that chase each other round), reading sweeps (a bright point draws the arc), writing beats (a kick per word).\nuniform float u_breath, u_spin, u_sweep, u_beat;\nuniform float u_spinA;   // Ink: how far the ink has turned while thinking (0 = as designed)\nuniform float u_move;                          // Movement: how strongly states and events move the orb (1 = as designed)\nout vec4 fragColor;\n\nconst float PI = 3.14159265358979;\n\nvec4 NZ(vec3 p) { return texture(u_noise, p * 0.125); }\nvec3 s2l(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }\nvec3 l2s(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }\nuint uhash(uvec2 p) { uint h = p.x * 374761393u + p.y * 668265263u; h = (h ^ (h >> 13u)) * 1274126177u; return h ^ (h >> 16u); }\nfloat urnd(uvec2 p) { return float(uhash(p)) * (1.0 / 4294967296.0); }\nmat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }\nfloat hash1(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }\n// Movement and Reaction can push the state values past what they were designed for; above 1.5 they grow ever more slowly.\nfloat softCap(float x) { return x < 1.5 ? x : 1.5 + (x - 1.5) / (1.0 + (x - 1.5) / 2.0); }\n\n// ---------------------------------------------------------------- Ink\n// Teal ink suspended in water. The density is sampled at several depths\n// along the refracted view ray, so it reads as something inside the glass.\nfloat inkDensity(vec3 P, vec3 so) {\n  float mThink = softCap(u_think * u_move * (1.0 + u_moveX)), mListen = softCap(u_listen * u_move * (1.0 + u_moveX)), mIn = softCap(u_in * u_move), mOut = softCap(u_out * u_move), mEx = softCap(u_exhale * u_move);\n  // thinking (Medium, High): the ink whirls round the middle, as a whole, with a twist that is strongest near the centre\n  if (u_spinA != 0.0 || u_spin > 0.0) {\n    P.xy = rot(u_spinA + u_spin * 1.4 * (1.0 - smoothstep(0.0, 1.0, length(P.xy)))) * P.xy;\n  }\n  float rr = length(P.xz);\n  float twist = mThink * 2.6 * (1.0 - smoothstep(0.0, 1.0, rr));\n  P.xz = rot(u_turn + twist) * P.xz;\n  float breathe = 1.0 + 0.07 * mOut + 0.12 * mEx - 0.05 * mThink + 0.07 * u_breath;   // listening breathes\n  vec3 p = (P - vec3(0.0, -0.1 * mListen, 0.0)) / breathe;\n  float sc = mix(0.75, 2.3, u_scale);\n  vec3 q = p * sc + so;\n  vec3 dr = vec3(0.23, -0.31, 0.17) * u_flow;\n  float stir = u_swirl * (1.0 + 0.8 * mIn + 0.5 * mOut) + 0.35 * mThink;\n  vec3 w = NZ(q * 0.55 + dr * 0.5).rgb - 0.5;\n  q += w * (0.5 + 2.0 * stir);\n  vec3 w2 = NZ(q * 1.7 + dr * 0.9 + 11.3).rgb - 0.5;\n  q += w2 * (0.15 + 0.55 * stir) * (1.0 - 0.5 * u_soft);\n  float n = 0.62 * NZ(q + dr).a + 0.28 * NZ(q * 2.03 + dr * 1.5 + 3.1).a;\n  n += 0.10 * mix(NZ(q * 4.07 + dr * 2.2 + 7.7).a, 0.5, u_soft);\n  float rp = length(p);\n  float cov = smoothstep(0.0, 0.6, u_fill);\n  float thr = mix(0.62, 0.4, u_fill) - 0.12 * mThink * (1.0 - smoothstep(0.0, 0.6, rp));\n  float sw = mix(0.025, 0.16, u_soft);\n  float dns = smoothstep(thr - sw, thr + sw, n);\n  float wisp = smoothstep(thr - 0.12 - sw, thr + sw * 0.5, n) * 0.25;\n  dns = max(dns, wisp);\n  float rOut = mix(mix(0.38, 0.93, cov), 0.6, min(mThink, 1.0)) + 0.08 * mOut + 0.1 * mEx;\n  float rIn = mix(rOut * 0.34, 0.04, min(mThink, 1.0));\n  dns *= 1.0 - smoothstep(rIn, rOut, rp);\n  dns *= 1.0 + 0.8 * mThink * (1.0 - smoothstep(0.0, 0.55, rp));\n  // thinking (Medium, High): the gathered ink opens into two spiral arms, so you can see it whirl\n  if (u_spin > 0.0) {\n    float rxy = length(P.xy);\n    float arms = 0.5 + 0.5 * sin(2.0 * atan(P.y, P.x) - 7.0 * rxy);\n    float sp2 = u_spin * u_spin;                          // gentle at Medium, full arms at High\n    float a0 = mix(0.32, 0.06, sp2);                      // at Medium the core stays round and only the edge whirls\n    dns *= mix(1.0, 0.25 + 1.3 * arms, sp2 * smoothstep(a0, a0 + 0.24, rxy));\n    dns += sp2 * 0.35 * arms * smoothstep(0.62, 0.3, rxy) * smoothstep(0.08, 0.3, rxy);\n  }\n  return dns;\n}\n\n// ---------------------------------------------------------------- Bands\n// Soft bands stacked like pages, bending and drifting sideways.\nfloat bandsDensity(vec3 P, vec3 so) {\n  float mThink = softCap(u_think * u_move * (1.0 + u_moveX)), mListen = softCap(u_listen * u_move * (1.0 + u_moveX)), mIn = softCap(u_in * u_move), mOut = softCap(u_out * u_move), mEx = softCap(u_exhale * u_move);\n  // Lines of a page, abstracted: soft strokes with ragged ends, stacked in depth.\n  P.xz = rot(0.22 * u_move * sin(u_turn * 0.7)) * P.xz;\n  float breathe = 1.0 + 0.05 * mOut + 0.1 * mEx;\n  vec3 p = P / breathe;\n  float conv = 1.0 + mThink * 1.1 * (1.0 - clamp(p.x * p.x, 0.0, 1.0));\n  float sc = mix(0.7, 1.6, u_scale);\n  vec3 bq = vec3(p.x * 0.8 - u_flow * 0.22, p.y * 0.45, p.z * 0.8) * sc + so;\n  float bend = (NZ(bq).r - 0.5) * (0.25 + 0.8 * u_swirl);\n  float amp = 0.04 + 0.06 * u_swirl + 0.06 * mThink + 0.08 * mOut + 0.04 * mIn;\n  float wave = sin(p.x * mix(1.8, 3.6, u_scale) - u_wave + p.z * 1.1) * amp;\n  float y0 = p.y * conv + wave + bend + 0.12 * mListen;\n  float count = mix(6.0, 10.0, u_scale);\n  float s0 = y0 * count * 0.5;\n  float id0 = floor(s0 + 0.5);\n  float presT = mix(0.0, 1.25, u_amount) * clamp(u_fill / max(u_amount, 0.05), 0.0, 1.0);\n  float level = mix(-1.2, 1.2, u_prog);\n  float endS = 0.1 + 0.2 * u_soft;\n  float edge = mix(0.04, 0.18, u_soft);\n  float best = 0.0;\n  // evaluate the nearest lines so tilted lines never cut off at a seam\n  for (int k = -1; k <= 1; k++) {\n    float id = id0 + float(k);\n    float h = hash1(id + floor(u_seed) * 17.0);\n    float fr = (y0 + (h - 0.5) * 0.3 * p.z) * count * 0.5 - id;\n    float width = mix(0.09, 0.22, fract(h * 5.31)) + 0.1 * u_soft;\n    float dk = 1.0 - smoothstep(width - edge, width + edge, abs(fr));\n    dk *= mix(0.55, 1.0, smoothstep(-width, width, fr));\n    dk *= mix(0.35, 1.0, fract(h * 7.13));\n    float xs = -0.95 + 0.3 * fract(h * 13.7);\n    float xe = xs + mix(0.7, 1.8, fract(h * 9.1)) + 0.25 * mOut + 0.12 * mEx;\n    dk *= smoothstep(xs - endS, xs + endS, p.x) * (1.0 - smoothstep(xe - endS, xe + endS, p.x));\n    float even = 1.0 - abs(mod(id, 2.0));\n    float pres = mix(0.1 + 0.9 * fract(h * 3.71), 0.4 * fract(h * 3.71), even);\n    dk *= smoothstep(pres - 0.12, pres + 0.12, presT);\n    dk *= smoothstep(level + 0.1, level - 0.1, id / (count * 0.5));\n    best = max(best, dk);\n  }\n  float dns = best;\n  dns *= 1.0 - smoothstep(0.62, 1.0, length(p));\n  return dns;\n}\n\n// ---------------------------------------------------------------- Ribbon\n// One wide ribbon of ink, curved and twisted, rolling and turning in 3D inside\n// the glass. It is thin through its thickness, so every step along the ray is\n// integrated instead of point-sampled: no gaps and no banding.\nstruct Rib { float v0; float v1; float v2; float m0; float m1; float m2; float mv; float sg; };\nRib ribbonAt(vec3 P) {\n  float mThink = softCap(u_think * u_move * (1.0 + u_moveX)), mListen = softCap(u_listen * u_move * (1.0 + u_moveX)), mIn = softCap(u_in * u_move), mOut = softCap(u_out * u_move), mEx = softCap(u_exhale * u_move);\n  Rib r;\n  vec3 p = u_ribRot * P;\n  float breathe = 1.0 + 0.06 * mOut + 0.1 * mEx;\n  p /= breathe;\n  p.y += 0.1 * mListen;\n  float x = p.x;\n  float k = mix(1.1, 2.4, u_scale);\n  float amp = 0.16 + 0.1 * mThink;\n  float rip = (0.03 + 0.06 * mOut + 0.05 * mIn) * sin(2.6 * k * x - u_wave);\n  float cy = amp * sin(k * x + 0.6) + rip;\n  float cz = (0.2 + 0.15 * mThink) * sin(0.8 * k * x + 1.9);\n  float th = (0.6 + 2.0 * u_swirl + 1.8 * mThink) * x + u_flow * 0.35;\n  float c = cos(th), s = sin(th);\n  vec2 dd = vec2(p.y - cy, p.z - cz);\n  float u = dd.x * c + dd.y * s;\n  float v = -dd.x * s + dd.y * c;\n  float fillR = clamp(u_fill / max(u_amount, 0.05), 0.0, 1.0);\n  float w = mix(0.14, 0.36, u_amount) * mix(0.45, 1.0, fillR) * (1.0 + 0.2 * mEx);\n  float e = mix(0.03, 0.2, u_soft);\n  float fan = 0.06 + 0.04 * mThink;\n  float sp = sin(1.7 * x + 0.9);\n  r.v0 = v;\n  r.v1 = v - fan * (1.0 + 0.5 * sp);\n  r.v2 = v + fan * (1.0 - 0.5 * sp);\n  float g0 = 1.0 - smoothstep(w - e, w + e, abs(u));\n  float e2 = e * 0.45;\n  float g1 = 1.0 - smoothstep(0.82 * w - e2, 0.82 * w + e2, abs(u - 0.14 * w));\n  float g2 = 1.0 - smoothstep(0.62 * w - e2, 0.62 * w + e2, abs(u + 0.18 * w));\n  float side = mix(0.35, 1.0, smoothstep(-w, 0.6 * w, u));\n  float reach = mix(-1.3, 1.3, u_prog);\n  float env = smoothstep(reach + 0.15, reach - 0.15, x) * (1.0 - smoothstep(0.74, 0.97, length(P))) * mix(0.2, 1.0, fillR);\n  r.m0 = g0 * side * env;\n  r.m1 = g1 * side * env * 0.6;\n  r.m2 = g2 * env * 0.45;\n  float vw = w * 1.5;\n  r.mv = (1.0 - smoothstep(vw - 0.15, vw + 0.15, abs(u + w * 2.2))) * env * 0.25 * (0.4 + 0.6 * u_depth);\n  r.sg = mix(0.035, 0.11, u_soft);\n  return r;\n}\nfloat erfA(float x) { return tanh(clamp(1.2025 * x, -9.0, 9.0)); }\n// Average of the sheet profile over one step of the ray (analytic, so a thin sheet is never skipped).\nfloat gAvg(float a, float b, float sg) {\n  float dv = b - a;\n  if (abs(dv) < 1e-3 * sg) { float t = erfA(a / sg); return 1.0657 * (1.0 - t * t); }\n  return 0.886227 * sg * (erfA(b / sg) - erfA(a / sg)) / dv;\n}\nfloat ribbonSeg(Rib a, Rib b) {\n  return gAvg(a.v0, b.v0, a.sg) * 0.5 * (a.m0 + b.m0)\n       + gAvg(a.v1, b.v1, a.sg) * 0.5 * (a.m1 + b.m1)\n       + gAvg(a.v2, b.v2, a.sg) * 0.5 * (a.m2 + b.m2)\n       + gAvg(a.v0, b.v0, a.sg * 3.0) * 0.5 * (a.mv + b.mv);\n}\n\n// ---------------------------------------------------------------- Ring\n// The first version: a silver ring that comes alive as bands of light.\n// Dark backgrounds get light (added, glowing); light backgrounds get pigment (absorbed, like ink).\nvec3 ringPalette(float h) {\n  float x = fract(h) * 4.0;\n  if (x < 1.0) return mix(u_rc1, u_rc2, smoothstep(0.0, 1.0, x));\n  if (x < 2.0) return mix(u_rc2, u_rc3, smoothstep(0.0, 1.0, x - 1.0));\n  if (x < 3.0) return u_rc3;                                            // the third colour holds longest\n  return mix(u_rc3, u_rc1, smoothstep(0.0, 1.0, x - 3.0));\n}\nfloat angDist(float a, float b) { return mod(a - b + PI, 2.0 * PI) - PI; }\n// what a colour of light becomes as pigment on paper: it absorbs the other colours\nvec3 pigmentOf(vec3 c) { return -log(max(c, vec3(0.03))) * 0.55 + 0.08; }\nvec4 ringLook(vec2 px) {\n  float R = 0.5 * min(u_res.x, u_res.y) * u_size;\n  vec2 q = (px - 0.5 * u_res) / R;\n  float r = length(q);\n  float th = atan(q.y, q.x);\n  float t = u_flow;\n  float dark = u_theme;\n  float pxw = 1.0 / R;                                   // one pixel, in these units\n  // reading: the light runs round from the top, clockwise, as far as Alice has read\n  float fromTop = mod(PI * 0.5 - th, 2.0 * PI);\n  float arc = u_prog * 2.0 * PI;\n  float lit = smoothstep(0.0, 0.4, fromTop) * smoothstep(arc + 0.3, arc - 0.3, fromTop);\n  lit = mix(lit, 1.0, smoothstep(0.92, 1.0, u_prog));\n  // at rest a streak of light runs round the ring, clockwise, about one lap every nine seconds\n  float head = mod(u_flow * 2.3, 2.0 * PI);\n  float behind = mod(head - fromTop, 2.0 * PI);            // how far behind the head of the streak\n  float comet = smoothstep(0.0, 0.4, behind) * exp(-behind / 1.5) * 1.3;\n  float dimR = 1.0 - u_readDim * u_read * (1.0 - lit);   // while reading, the part not read yet dims so the arc stands out\n  float Es = clamp(max(max(u_energy, u_read * lit), comet * u_comet * dimR), 0.0, 1.0);   // what Alice is doing\n  // At rest the ring can keep part of its colour (u_restE). What Alice does lifts it from there, so every state\n  // still reads as a step up. The bands only move as much as Alice is doing something: colour at rest stays calm.\n  float rE = u_restE * dimR;\n  float E = u_restE > 0.0 ? clamp(rE + (1.0 - rE) * pow(Es, 0.7), 0.0, 1.0) : Es;\n  float Em = u_restE > 0.0 ? max(Es, 0.3 * u_restE) : E;\n  // more movement from what Alice does, not from listening or rest: those stay calm\n  Em += u_moveX * max(min(Em, max(u_workE, u_read * lit)) - max(0.3 * u_restE, comet * u_comet), 0.0);\n  float face = u_moveX * u_listen;                         // listening: the light gathers at the bottom, towards where you type\n  float wk = u_work * clamp(max(u_energy, u_read * lit), 0.0, 1.0);    // brighter and heavier where Alice is working\n  float RR = 0.8 * (1.0 + 0.02 * softCap(u_exhale * u_move)) * (1.0 + u_grow) * (1.0 + 0.045 * u_breath + 0.035 * u_beat);\n  // thinking spins: three points of light chase each other round the ring, clockwise, each at its own uneven speed\n  float chase = 0.0;\n  if (u_spin > 0.0) {\n    for (int k = 0; k < 3; k++) {\n      float fk = float(k);\n      float hk = mod(t * (2.1 + 0.55 * fk) + 0.35 * sin(t * (0.6 + 0.3 * fk) + fk * 2.0) + fk * 2.094, 2.0 * PI);\n      float bk = mod(hk - fromTop, 2.0 * PI);            // how far behind this point\n      chase += smoothstep(0.0, 0.16, bk) * exp(-bk / 0.62) * (1.0 - 0.2 * fk);\n    }\n  }\n  float chaseMul = mix(1.0, 0.1 + 2.4 * chase, u_spin);\n  // reading sweeps: a bright point at the tip of the arc\n  float spark = u_sweep * exp(-pow(angDist(fromTop, arc), 2.0) / 0.03) * (1.0 - smoothstep(0.92, 1.0, u_prog));\n  float moveMul = chaseMul * (1.0 + 2.2 * spark) * (1.0 + 0.3 * u_breath + 0.6 * u_beat);\n  // and it sways slowly in 3D, like a ring settling on a table\n  float swayA = u_move * mix(0.015, 0.06, u_scale) * (0.55 + 0.45 * sin(t * 0.29 + u_seed));\n  float swayAx = t * 0.19 + u_seed * 1.7;\n  float sw0 = sin(th - swayAx);\n  float RRt = RR * (1.0 - swayA * sw0 * sw0);\n  vec3 light = vec3(0.0), absorb = vec3(0.0);\n\n  // ---- the silver ring: a metal tube lit from the top right, with a faint reflection below it\n  float tube = max(0.02 * (1.0 + 0.5 * u_weight), (1.6 + 1.4 * u_weight) * pxw) * (1.0 + 0.5 * wk);\n  float d0 = r - RRt;\n  float nr = clamp(d0 / tube, -1.0, 1.0);\n  vec3 n = vec3(nr * cos(th), nr * sin(th), sqrt(max(1.0 - nr * nr, 0.0)));\n  vec3 Ld = normalize(vec3(0.55, 0.65, 0.5));\n  float diff = max(dot(n, Ld), 0.0);\n  float spec = pow(max(dot(reflect(-vec3(0.0, 0.0, 1.0), n), Ld), 0.0), 24.0);\n  float tcov = 1.0 - smoothstep(tube - 1.2 * pxw, tube + 0.6 * pxw, abs(d0));\n  float ga = swayAx + 0.9;                                // the glints travel as it sways\n  float glint = (exp(-pow(angDist(th, ga), 2.0) / 0.08) + 0.6 * exp(-pow(angDist(th, ga + PI), 2.0) / 0.08)) * u_gloss;\n  float metal = tcov * (diff * 0.75 + spec * (0.5 + glint)) * mix(0.55, 1.1, u_edge) * (1.0 + 0.9 * u_exhale);   // it flashes as it settles\n  float dr = length(q - vec2(0.0, -0.055)) - RRt;\n  float refl = exp(-dr * dr / (0.028 * 0.028)) * 0.07 * u_edge;\n  float rest = 1.0 - smoothstep(0.0, 0.85, E);\n  // anodised: the silver takes on the ring's colours, which run round the ring and shift across the tube as it sways\n  float ah = th / (2.0 * PI) + 0.16 * nr + 0.1 * sin(th - swayAx) + t * 0.02;\n  vec3 anod = ringPalette(ah);\n  float anL = dot(anod, vec3(0.2126, 0.7152, 0.0722));\n  vec3 anodLight = anod * min(4.0, dot(u_rmetal, vec3(0.2126, 0.7152, 0.0722)) * 0.85 / max(anL, 0.02));\n  vec3 metalCol = mix(u_rmetal, mix(anodLight, u_rmetal, clamp(0.7 * spec * (0.5 + glint), 0.0, 1.0)), u_anod);   // the glints stay silver\n  light += metalCol * (metal + refl) * rest;\n  // on paper it reads as chrome: the half that reflects the room is light, the half that reflects the floor is dark\n  float sky = smoothstep(-0.1, 0.15, 2.0 * n.z * n.y + 0.08);\n  float chrome = 0.12 + 0.6 * (1.0 - sky) + 0.3 * pow(abs(nr), 4.0) - 0.25 * spec * (0.5 + glint);\n  float chromeA = tcov * max(chrome, 0.0) * mix(0.55, 1.0, u_edge) * (1.0 - 0.5 * u_exhale) + refl * 1.6;\n  chromeA = mix(chromeA, max(chromeA, 0.5 * tcov), u_anod);   // anodised metal is coloured all round, its light half too\n  vec3 anodPig = pigmentOf(anod); anodPig /= max((anodPig.r + anodPig.g + anodPig.b) / 3.0, 0.1);\n  absorb += chromeA * mix(vec3(1.0), anodPig, u_anod) * rest;\n\n  // ---- bands of light: each one is a circle tipped a little in 3D, so they drift apart and cross,\n  // and each one is a ribbon that twists along the ring: face-on a wide, faint veil, edge-on a thin bright line\n  float cw = max(0.006, (1.1 + 0.9 * u_weight) * pxw) * (1.0 + 0.9 * wk);\n  float gw = mix(0.018, 0.05, u_soft);\n  float tipG = Em * u_move * mix(0.01, 0.09, u_scale) * (0.6 + 0.4 * sin(t * 0.13 + u_seed));\n  float envB = 0.5 + 0.5 * sin(th - t * 0.27 + u_seed * 1.3);             // one side of the ring burns brighter, and it travels\n  float axisG = t * 0.07 + u_seed * 0.9;\n  for (int i = 0; i < 3; i++) {\n    float fi = float(i);\n    float ph = fi * 2.09 + u_seed * 0.37;\n    float dir = (i == 1) ? -1.0 : 1.0;\n    float tip = Em * mix(0.02, 0.12, u_swirl) * (0.55 + 0.45 * u_move * sin(t * 0.21 + ph * 1.7));\n    float axis = ph + dir * t * (0.09 + 0.04 * fi);\n    vec2 off = Em * u_move * mix(0.005, 0.04, u_swirl) * vec2(cos(t * 0.16 + ph * 1.3), sin(t * 0.12 + ph * 2.3));\n    vec2 qi = q - off;\n    float ri = length(qi);\n    float ti = atan(qi.y, qi.x);\n    float sn = sin(ti - axis);\n    float sg = sin(ti - axisG);\n    float sw = sin(ti - swayAx);\n    float rc = RR * (1.0 - swayA * sw * sw - tip * sn * sn - tipG * sg * sg);\n    rc += Em * u_move * RR * 0.05 * u_scale * (0.6 * sin(2.0 * ti + dir * t * (0.5 + 0.15 * fi) + ph) + 0.4 * sin(3.0 * ti - dir * t * 0.37 + ph * 2.0));\n    rc += Em * u_move * RR * 0.1 * u_scale * (NZ(vec3(cos(ti) * 1.1 + fi * 2.7, sin(ti) * 1.1 - fi * 1.9, t * 0.18 + fi)).r - 0.5);\n    rc += softCap(u_in * u_move) * RR * 0.008 * sin(10.0 * ti + t * 8.0 + fi * 2.1);     // keystrokes ripple it\n    float d = ri - rc;\n    float turns = fi + 1.0;                               // whole turns, so the colours meet up again\n    float phi = turns * ti + dir * t * (0.4 + 0.2 * fi) + ph;\n    float hw = E * mix(0.02, 0.1, u_soft) * (1.0 - 0.2 * fi);\n    float c = cos(phi);\n    float a = sqrt(hw * hw * c * c + cw * cw);\n    float u = d / a;\n    float cover = 1.0 - smoothstep(0.55, 1.0, abs(u));\n    float dens = min((hw + cw) / a, 3.5);\n    float across = clamp(d * hw * c / (hw * hw * c * c + cw * cw), -1.0, 1.0);   // -1..1 across the ribbon itself\n    dens *= 1.0 + 0.6 * smoothstep(0.4, 0.95, abs(across));                    // its edges catch more light\n    float pulse = u_out * exp(-pow(angDist(ti, dir * u_wave * 0.7 + fi * 2.1), 2.0) / 0.2);\n    float b = (0.3 + 0.7 * pow(0.5 + 0.5 * sin(ti * (1.0 + fi) + dir * t * (0.6 + 0.2 * fi) + ph), 1.5)) * (1.0 + 1.4 * pulse) * (0.45 + 0.8 * envB);\n    b *= 1.0 + face * (1.3 * pow(max(0.0, -sin(ti)), 2.0) - 0.4 * max(0.0, sin(ti)));\n    b *= moveMul;\n    float w = (i == 0) ? E : E * smoothstep(0.05, 0.5, E) * (1.0 - 0.3 * fi);   // one main band, two fainter ones\n    // the colours run round the ring; the inner edge of each band leans to the third colour\n    float hue = ti / (2.0 * PI) + fi * 0.12 + t * 0.06;\n    vec3 pal = ringPalette(hue);                                          // for the glow round the band\n    vec3 col = mix(ringPalette(hue + 0.1 * across * cover), u_rc3, 0.5 * smoothstep(-0.35, 0.85, -d / (hw + 0.02)));\n    float core = cover * dens * b * w * (1.0 + 0.6 * wk);\n    float glow = exp(-abs(d) / gw) * b * w * u_glow * (1.0 + wk);\n    // a crisp filament of light along the outer edge of each band\n    float fil = exp(-pow((d - 0.8 * a) / (0.9 * cw), 2.0)) * b * w;\n    light += col * core * 1.25 + pal * glow * 0.32 + vec3(core * core) * 0.08 + mix(pal, vec3(1.0), 0.45) * fil * 0.9;\n    absorb += pigmentOf(col) * core * 0.75 + pigmentOf(pal) * (glow * 0.05 + fil * 0.45);\n  }\n\n  // ---- veils of light hanging inward from the ring, streaked along it\n  float inR = (RRt - r) / RR;\n  float Ev = Em * sqrt(Em);                              // veils and haze show that Alice is doing something\n  float veilBand = smoothstep(-0.04, 0.03, inR) * exp(-max(inR, 0.0) / mix(0.04, 0.13, u_depth));\n  if (veilBand * Ev * u_depth > 0.002) {\n    vec3 sp = vec3(cos(th + t * 0.04) * 1.6, sin(th + t * 0.04) * 1.6, r * 6.5 - t * 0.22);\n    sp += (NZ(sp * 0.6 + vec3(0.0, 0.0, t * 0.07)).rgb - 0.5) * 1.6;\n    float vn = NZ(sp).a;\n    float env = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(th - t * 0.23 + u_seed), 2.0);\n    float veil = smoothstep(0.4, 0.85, vn) * veilBand * Ev * u_depth * env * 3.2;\n    vec3 veilCol = mix(u_rc3, u_rc2, 0.3 * smoothstep(0.3, 0.7, NZ(sp * 0.4 + 5.0).g));\n    light += veilCol * veil * 1.1;\n    absorb += pigmentOf(veilCol) * veil * 0.45;\n  }\n  // ---- a wide haze of light round it\n  float hz = exp(-abs(r - RRt) / mix(0.09, 0.065, step(r, RRt))) * Ev * u_halo * (1.0 - smoothstep(0.98, 1.14, r)) * (1.0 + 1.2 * wk);\n  vec3 hazeCol = mix(u_rc2, u_rc3, 0.25 + 0.25 * sin(th + t * 0.1));\n  light += hazeCol * hz * 0.22;\n  absorb += pigmentOf(hazeCol) * hz * 0.07;\n  // ---- aura: a soft light round the ring and caught inside it, there even at rest\n  if (u_aura > 0.0) {\n    vec3 auraCol = ringPalette(th / (2.0 * PI) + t * 0.03 + 0.08 * sin(2.0 * th - t * 0.2));\n    float dd = r - RRt;                                   // outside > 0 > inside\n    float glowO = exp(-max(dd, 0.0) / 0.075) * smoothstep(-0.05, 0.0, dd) * (1.0 - smoothstep(0.98, 1.12, r));\n    float glowI = exp(-max(-dd, 0.0) / 0.2) * (1.0 - smoothstep(0.0, 0.04, dd));\n    float ab = u_aura * (0.75 + 0.25 * envB) * (1.0 + 0.5 * Es);\n    light += auraCol * (glowO * 0.30 + glowI * 0.16) * ab;                 // on dark: a glow, and light caught inside\n    absorb += pigmentOf(auraCol) * (glowO * 0.14 + glowI * 0.045) * ab;     // on paper: a soft tint round it\n  }\n\n  vec2 uvv = px / u_res;\n  float ef = smoothstep(0.0, 0.08, min(min(uvv.x, 1.0 - uvv.x), min(uvv.y, 1.0 - uvv.y)));\n  vec3 col;\n  float A;\n  if (dark > 0.5) {\n    vec3 cc = 1.0 - exp(-light * 1.35);                  // where the light piles up it turns white\n    col = l2s(cc) * ef;\n    A = max(max(col.r, col.g), col.b);\n  } else {\n    vec3 T = l2s(exp(-absorb * 1.6));                    // pigment over the page\n    float mn = min(min(T.r, T.g), T.b);\n    A = (1.0 - mn) * ef;\n    col = (T - mn) * ef;                                 // premultiplied: reads as T over white\n  }\n  // grain\n  uvec2 ip = uvec2(px);\n  uint fr = uint(floor(u_time * 24.0)) + uint(u_gseed) * 7919u;\n  float g = urnd(ip + uvec2(fr * 1663u, fr * 3037u)) + urnd(ip + uvec2(fr * 2791u + 101u, fr * 457u + 29u)) - 1.0;\n  col += g * u_grain * A * 0.6;\n  col = clamp(col, 0.0, A);\n  return vec4(col, A);\n}\n\n// ---------------------------------------------------------------- main\nvoid main() {\n  vec2 px = gl_FragCoord.xy + u_win;\n  if (u_look == 4) { fragColor = ringLook(px); return; }\n  float R = 0.5 * min(u_res.x, u_res.y) * u_size * (1.0 + u_grow) * (1.0 + 0.03 * u_breath + 0.03 * u_beat);\n  vec2 q = (px - 0.5 * u_res) / R;\n  float d = length(q);\n  float aa = 1.25 / R;\n  float cover = 1.0 - smoothstep(1.0 - aa, 1.0 + aa * 0.4, d);\n  float dark = u_theme;\n  float glowNow = (u_glow * (0.3 + 0.7 * u_busy) + u_glow * 0.6 * u_exhale) * (1.0 + 1.5 * u_work * u_busy + 0.8 * u_beat);\n  vec3 col = vec3(0.0);\n  float a = 0.0;\n\n  if (d < 1.0 + aa) {\n    float z = sqrt(max(1.0 - d * d, 0.0));\n    vec3 N = normalize(vec3(q, z + 1e-4));\n    vec3 so = vec3(u_seed * 1.31, u_seed * 0.77, u_seed * 2.13);\n    vec3 T = refract(vec3(0.0, 0.0, -1.0), N, mix(1.0, 0.74, u_depth));\n    float tEx = max(-2.0 * dot(N, T), 0.0);\n    float tau = 0.0;\n    if (u_look == 1) {\n      Rib ra = ribbonAt(N);\n      for (int k = 1; k <= 28; k++) {\n        if (k > u_steps) break;\n        float f = float(k) / float(u_steps);\n        vec3 P = N + T * (tEx * f);\n        Rib rb = ribbonAt(P);\n        float wgt = mix(1.0, 1.0 - 0.6 * u_depth, f) * (1.0 - 0.2 * P.y);\n        tau += wgt * ribbonSeg(ra, rb);\n        ra = rb;\n      }\n      tau *= 1.9 * tEx / float(u_steps);\n    } else {\n      for (int k = 0; k < 8; k++) {\n        if (k >= u_steps) break;\n        float f = (float(k) + 0.5) / float(u_steps);\n        vec3 P = N + T * (tEx * f);\n        float dns = (u_look == 0) ? inkDensity(P, so) : bandsDensity(P, so);\n        float wgt = mix(1.0, 1.0 - 0.6 * u_depth, f) * (1.0 - 0.2 * P.y);\n        tau += dns * wgt;\n      }\n      tau *= tEx / float(u_steps);\n    }\n    tau *= 1.0 + 0.35 * u_work * u_busy;\n    float tone = 1.0 - exp(-tau * mix(1.9, 2.7, dark));\n    vec3 lin = s2l(texture(u_lut, vec2(tone * (255.0 / 256.0) + 0.5 / 256.0, dark > 0.5 ? 0.75 : 0.25)).rgb);\n    a = mix(mix(0.5, 0.94, dark), 1.0, smoothstep(0.0, 0.45, tone));\n\n    // glow: ink lights up while Alice works (dark), a touch of glow colour in the light reading\n    float mid = 4.0 * tone * (1.0 - tone);\n    lin += u_glowLin * tone * tone * glowNow * 0.6 * dark;\n    lin = mix(lin, lin * 0.6 + u_glowLin * 0.4, mid * glowNow * 0.3 * (1.0 - dark));\n\n    // glass: darker ring towards the edge (light), rim light (dark), thin edge line, soft reflection\n    float ring = smoothstep(0.78, 0.995, d);\n    lin = mix(lin, u_tintLin * 0.75, ring * ring * 0.55 * u_edge * (1.0 - dark));\n    a = max(a, ring * u_edge * (1.0 - dark) * 0.9);\n    float rimD = pow(1.0 - z, 3.0) * (0.3 + 0.7 * smoothstep(-0.4, 0.9, N.y));\n    lin += u_glowLin * rimD * u_edge * 0.8 * dark;\n    vec2 dir = q / max(d, 1e-4);\n    float side = 0.35 + 0.65 * smoothstep(-0.3, 0.8, dot(dir, normalize(vec2(-0.55, 0.8))));\n    float line = exp(-pow((d - 0.968) / 0.016, 2.0)) * side;\n    lin += mix(vec3(1.0), u_glowLin, dark) * line * 0.5 * u_edge;\n    vec3 Rv = reflect(vec3(0.0, 0.0, -1.0), N);\n    float sd = dot(Rv, normalize(vec3(-0.666, 0.74, 0.095)));\n    float spc = smoothstep(0.955, 0.985, sd);\n    float sps = smoothstep(0.75, 0.97, sd);\n    lin = mix(lin, vec3(1.0), clamp((spc + 0.25 * sps) * u_gloss * 0.9 * (1.0 - dark), 0.0, 1.0));\n    lin += (vec3(spc) * 0.38 + u_glowLin * sps * 0.12) * u_gloss * dark;\n    a = max(a, clamp((spc + 0.25 * sps * (1.0 - dark)) * u_gloss, 0.0, 1.0));\n\n    col = l2s(lin);\n  }\n\n  // film grain: proper integer hash, changes 24 times a second, strongest in the mid-tones\n  uvec2 ip = uvec2(px);\n  uint fr = uint(floor(u_time * 24.0)) + uint(u_gseed) * 7919u;\n  float g = urnd(ip + uvec2(fr * 1663u, fr * 3037u)) + urnd(ip + uvec2(fr * 2791u + 101u, fr * 457u + 29u)) - 1.0;\n  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));\n  col += g * u_grain * (0.35 + 2.6 * lum * (1.0 - lum));\n  col += (urnd(ip + uvec2(17u, 911u)) - 0.5) / 255.0;\n  col = clamp(col, 0.0, 1.0);\n\n  float ballA = a * cover;\n\n  // outside: soft contact shadow (light), halo (dark)\n  float outA = 0.0;\n  vec3 outC = vec3(0.0);\n  {\n    vec2 sp2 = (q - vec2(0.0, -1.05)) / vec2(0.75, 0.1);\n    float contact = exp(-dot(sp2, sp2) * 1.4) * 0.2;\n    float amb = exp(-max(d - 1.0, 0.0) * 9.0) * 0.06 * clamp(-q.y / max(d, 1e-4) + 0.3, 0.0, 1.0);\n    float shA = (1.0 - dark) * u_halo * (contact + amb);\n    float haloA = dark * u_halo * exp(-max(d - 1.0, 0.0) * 6.0) * (0.05 + 0.3 * glowNow);\n    vec2 uv = px / u_res;\n    float ef = smoothstep(0.0, 0.06, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));\n    outA = clamp(shA + haloA, 0.0, 1.0) * (1.0 - cover) * ef;\n    outC = mix(u_shadowSrgb, u_glowSrgb, dark);\n  }\n  float A = ballA + outA * (1.0 - ballA);\n  vec3 C = col * ballA + outC * outA * (1.0 - ballA);\n  fragColor = vec4(C, A);\n}\n";
  const BAKE = "#version 300 es\nprecision highp float;\nprecision highp int;\nuniform float u_z;\nuniform float u_N;\nuniform int u_P;\nout vec4 fragColor;\nuint uh3(uvec3 p, uint s) {\n  uint h = p.x * 374761393u + p.y * 668265263u + p.z * 2147483647u + s * 2246822519u;\n  h = (h ^ (h >> 13u)) * 1274126177u;\n  return h ^ (h >> 16u);\n}\nvec3 grad(ivec3 c, uint s) {\n  ivec3 w = c % u_P;\n  uint h = uh3(uvec3(w), s);\n  float a = float(h & 65535u) * (6.2831853 / 65536.0);\n  float zc = float(h >> 16u) * (2.0 / 65536.0) - 1.0;\n  float r = sqrt(max(0.0, 1.0 - zc * zc));\n  return vec3(r * cos(a), r * sin(a), zc);\n}\nfloat perlin(vec3 p, uint s) {\n  ivec3 i = ivec3(floor(p));\n  vec3 f = fract(p);\n  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);\n  float n000 = dot(grad(i, s), f);\n  float n100 = dot(grad(i + ivec3(1, 0, 0), s), f - vec3(1.0, 0.0, 0.0));\n  float n010 = dot(grad(i + ivec3(0, 1, 0), s), f - vec3(0.0, 1.0, 0.0));\n  float n110 = dot(grad(i + ivec3(1, 1, 0), s), f - vec3(1.0, 1.0, 0.0));\n  float n001 = dot(grad(i + ivec3(0, 0, 1), s), f - vec3(0.0, 0.0, 1.0));\n  float n101 = dot(grad(i + ivec3(1, 0, 1), s), f - vec3(1.0, 0.0, 1.0));\n  float n011 = dot(grad(i + ivec3(0, 1, 1), s), f - vec3(0.0, 1.0, 1.0));\n  float n111 = dot(grad(i + ivec3(1, 1, 1), s), f - vec3(1.0, 1.0, 1.0));\n  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);\n}\nvoid main() {\n  vec3 p = vec3(gl_FragCoord.xy, u_z) * (float(u_P) / u_N);\n  vec4 n = vec4(perlin(p, 1u), perlin(p, 2u), perlin(p, 3u), perlin(p, 4u));\n  fragColor = clamp(0.5 + 0.8 * n, 0.0, 1.0);\n}\n";
  const VERT = "#version 300 es\nlayout(location = 0) in vec2 a_pos;\nvoid main() { gl_Position = vec4(a_pos, 0.0, 1.0); }";
  const GLSIZE = 1024;
  // v9: no context of its own. window.AliceGL (alice-ground-v9.js) holds one WebGL context for every orb and every
  // gradient on the page; the programs and textures below are built once per context and shared between the copies.
  const HUB = window.AliceGL;
  let gl = null, prog = null, lutTex = null, noiseTex = null, VAO = null;
  let U = {};
  function compile(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  function link(vsSrc, fsSrc) {
    const vs = compile(gl.VERTEX_SHADER, vsSrc), fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(p)); return null; }
    return p;
  }
  function noiseParams() {
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
  }
  // Tileable gradient noise, baked once on the GPU into a 128^3 texture (four independent channels).
  function bakeNoise(bake) {
    const NS = 128;
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texStorage3D(gl.TEXTURE_3D, 1, gl.RGBA8, NS, NS, NS);
    noiseParams();
    gl.bindTexture(gl.TEXTURE_3D, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.useProgram(bake);
    const uz = gl.getUniformLocation(bake, "u_z");
    gl.uniform1f(gl.getUniformLocation(bake, "u_N"), NS);
    gl.uniform1i(gl.getUniformLocation(bake, "u_P"), 8);
    gl.viewport(0, 0, NS, NS);
    let ok = true;
    for (let z = 0; z < NS; z++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, z);
      if (z === 0 && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { ok = false; break; }
      gl.uniform1f(uz, z + 0.5);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    if (ok) return tex;
    gl.deleteTexture(tex);
    return cpuNoise();
  }
  // Fallback if the GPU bake is not possible: the same noise at 48^3, computed on the CPU.
  function cpuNoise() {
    const NS = 48, PER = 8, data = new Uint8Array(NS * NS * NS * 4);
    let seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let ch = 0; ch < 4; ch++) {
      const G = [];
      for (let i = 0; i < PER * PER * PER; i++) { const a = rnd() * 6.2831853, zc = rnd() * 2 - 1, r = Math.sqrt(1 - zc * zc); G.push([r * Math.cos(a), r * Math.sin(a), zc]); }
      const g = (x, y, z) => G[((z % PER) * PER + (y % PER)) * PER + (x % PER)];
      const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
      for (let z = 0; z < NS; z++) for (let y = 0; y < NS; y++) for (let x = 0; x < NS; x++) {
        const px = (x + 0.5) * PER / NS, py = (y + 0.5) * PER / NS, pz = (z + 0.5) * PER / NS;
        const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz), fx = px - ix, fy = py - iy, fz = pz - iz;
        const dot = (cx, cy, cz) => { const v = g(ix + cx, iy + cy, iz + cz); return v[0] * (fx - cx) + v[1] * (fy - cy) + v[2] * (fz - cz); };
        const u = fade(fx), v = fade(fy), w = fade(fz);
        const n = lerp(lerp(lerp(dot(0, 0, 0), dot(1, 0, 0), u), lerp(dot(0, 1, 0), dot(1, 1, 0), u), v), lerp(lerp(dot(0, 0, 1), dot(1, 0, 1), u), lerp(dot(0, 1, 1), dot(1, 1, 1), u), v), w);
        data[((z * NS + y) * NS + x) * 4 + ch] = Math.round(clamp01(0.5 + 0.8 * n) * 255);
      }
    }
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, NS, NS, NS, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    noiseParams();
    return tex;
  }

  const UNAMES = ["u_res", "u_win", "u_size", "u_look", "u_steps", "u_theme", "u_flow", "u_turn", "u_wave", "u_time", "u_seed", "u_gseed", "u_in", "u_out", "u_think", "u_listen", "u_fill", "u_prog", "u_exhale", "u_busy", "u_amount", "u_scale", "u_swirl", "u_soft", "u_depth", "u_edge", "u_gloss", "u_glow", "u_halo", "u_grain", "u_glowLin", "u_tintLin", "u_shadowSrgb", "u_glowSrgb", "u_lut", "u_noise", "u_ribRot", "u_rc1", "u_rc2", "u_rc3", "u_rmetal", "u_energy", "u_read", "u_comet", "u_move", "u_restE", "u_anod", "u_aura", "u_weight", "u_moveX", "u_grow", "u_work", "u_readDim", "u_workE", "u_breath", "u_spin", "u_sweep", "u_beat", "u_spinA"];
  function glInit(g) {
    gl = g;
    const R = HUB.res("orb", function () {
      let prog = null, lutTex = null, noiseTex = null; const U = {};
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const bake = link(VERT, BAKE);
      prog = link(VERT, FRAG);
      if (prog && bake) {
        noiseTex = bakeNoise(bake);
        gl.useProgram(prog);
        UNAMES.forEach(n => { U[n] = gl.getUniformLocation(prog, n); });
        lutTex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, lutTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, buildLut(INK_COLORS));
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_3D, noiseTex);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(U.u_lut, 0); gl.uniform1i(U.u_noise, 1);
        const g = hexToRgb(INK_COLORS.glow), t = hexToRgb(INK_COLORS.tint), sh = hexToRgb(INK_COLORS.deep);
        gl.uniform3f(U.u_glowLin, s2l(g[0]), s2l(g[1]), s2l(g[2]));
        gl.uniform3f(U.u_glowSrgb, g[0], g[1], g[2]);
        gl.uniform3f(U.u_tintLin, s2l(t[0]), s2l(t[1]), s2l(t[2]));
        gl.uniform3f(U.u_shadowSrgb, sh[0], sh[1], sh[2]);
        const lin = h => hexToRgb(h).map(s2l);
        gl.uniform3fv(U.u_rc1, lin(RING_COLORS.c1)); gl.uniform3fv(U.u_rc2, lin(RING_COLORS.c2)); gl.uniform3fv(U.u_rc3, lin(RING_COLORS.c3)); gl.uniform3fv(U.u_rmetal, lin(RING_COLORS.metal));
      } else prog = null;
      return prog ? { prog: prog, U: U, lutTex: lutTex, noiseTex: noiseTex, vao: vao } : null;
    });
    if (R) { prog = R.prog; U = R.U; lutTex = R.lutTex; noiseTex = R.noiseTex; VAO = R.vao; } else prog = null;
  }
  if (HUB) HUB.client({ init: glInit, lost: function () { prog = null; } });

  // ================================================================ Alice's state: every value glides, the clocks never jump
  const MODES = {
    idle:      { think: 0,    listen: 0, write: 0, read: 0, speed: 0.3,  turnV: 0.05, waveV: 0.35, grow: 0 },
    listening: { think: 0,    listen: 1, write: 0, read: 0, speed: 0.42, turnV: 0.07, waveV: 0.5,  grow: 1 },
    thinking:  { think: 1,    listen: 0, write: 0, read: 0, speed: 0.85, turnV: 0.5,  waveV: 1.1,  grow: 0.55 },
    writing:   { think: 0,    listen: 0, write: 1, read: 0, speed: 0.65, turnV: 0.16, waveV: 1.5,  grow: 0.75 },
    reading:   { think: 0.3,  listen: 0, write: 0, read: 1, speed: 0.7,  turnV: 0.22, waveV: 0.9,  grow: 0.45 },
  };
  // How different the states look from rest. "low" is the design as it was. "medium" and "high" turn up everything that
  // sets a state apart: speed, movement, the kicks from keys and words, a breath in size, a brighter and heavier line
  // (Ring) or more glow and denser ink (Ink) while working, the part not read yet dimming, and the flash when Alice is
  // done. Rest itself stays exactly as it is. "sig" is how strongly each Ring state moves its own way: listening
  // breathes, thinking spins, reading sweeps, writing beats.
  const CONTRAST = {
    low:    { speed: 1,   move: 0,    react: 1,   finish: 1,   grow: 0,     work: 0,    listen: 0.25, readDim: 0,    sig: 0 },
    medium: { speed: 1.6, move: 0.4,  react: 1.6, finish: 1.6, grow: 0.028, work: 0.35, listen: 0.42, readDim: 0.35, sig: 0.6 },
    high:   { speed: 2.3, move: 0.85, react: 2.3, finish: 2.2, grow: 0.05,  work: 0.7,  listen: 0.6,  readDim: 0.6,  sig: 1 },
  };
  let K = CONTRAST.low;
  const VKEYS = ["think", "listen", "write", "read", "in", "out", "exhale", "grow"];
  function resetState(st) {
    st.mode = "idle"; st.progress = null; st.baseFill = null; st.inImp = 0; st.outImp = 0; st.exImp = 0;
    VKEYS.forEach(k => { st.v[k] = 0; st.v1[k] = 0; });
    st.v.fill = st.v1.fill = S().amount; st.v.prog = st.v1.prog = 1;
    st.v.speed = st.v1.speed = 0.3; st.v.turnV = st.v1.turnV = 0.05; st.v.waveV = st.v1.waveV = 0.35;
    st.flow = 0; st.turn = 0; st.wave = 0; st.bph = 0; st.spinA = 0;
    return st;
  }
  const makeState = () => resetState({ v: {}, v1: {} });
  const E = makeState();        // the page's Alice
  const AGENTS = {};            // more Alices, each in a state of its own (to show the states side by side)
  const CALM = { think: 0, listen: 0, write: 0, read: 0, in: 0, out: 0, exhale: 0, grow: 0 };
  function approach(st, k, target, tau, dt) {
    const a = 1 - Math.exp(-dt / tau);
    st.v1[k] += (target - st.v1[k]) * a;
    st.v[k] += (st.v1[k] - st.v[k]) * a;
  }
  function busy(v) { return clamp01(v.think + v.write + 0.8 * v.read + 0.35 * v.listen + 0.35 * v.in + 0.3 * v.out + 0.5 * v.exhale); }
  // Movement: how strongly states and events move the orb (1 = as designed). Snap: how quickly it glides
  // from one state to the next (0 = as designed, 1 = about four times as fast). A Reaction above its
  // default also lets the kicks from keys and words grow bigger.
  // above 1.5 the pushed values grow ever more slowly, so the extremes stay usable (the same curve as in the shaders)
  function softCap(x) { return x < 1.5 ? x : 1.5 + (x - 1.5) / (1 + (x - 1.5) / 2); }
  function motion() {
    const L = S();
    return { mv: L.movement === undefined ? 1 : L.movement, f: lerp(1, 0.22, clamp01(L.snap || 0)), cap: Math.max(1, (L.reaction || 0) / 0.8) };
  }
  function stepState(st, dt) {
    const m = MODES[st.mode] || MODES.idle, I = MODES.idle;
    const { mv, f, cap } = motion();
    const capR = cap * K.react, ks = mv * K.speed;
    st.inImp *= Math.exp(-dt / 0.35);
    st.outImp *= Math.exp(-dt / 0.3);
    st.exImp *= Math.exp(-dt / 0.9);
    ["think", "listen", "write", "read"].forEach(k => approach(st, k, m[k], 0.4 * f, dt));
    approach(st, "in", Math.min(1.3 * capR, st.inImp), 0.06 * f, dt);
    approach(st, "out", Math.min(1.3 * capR, st.outImp), 0.06 * f, dt);
    approach(st, "exhale", st.exImp, 0.14 * f, dt);
    const amt = S().amount;
    const base = st.baseFill === null ? amt : st.baseFill;
    const fillT = st.progress === null ? base : lerp(Math.min(0.1, amt), amt, st.progress);
    approach(st, "fill", fillT, 0.45 * f, dt);
    approach(st, "prog", st.progress === null ? 1 : st.progress, 0.3 * f, dt);
    const kin = softCap(st.v.in * mv), kout = softCap(st.v.out * mv);
    approach(st, "speed", I.speed + (m.speed - I.speed) * ks + 0.7 * kin + 0.5 * kout, 0.35 * f, dt);
    approach(st, "turnV", I.turnV + (m.turnV - I.turnV) * ks + 0.08 * kin + 0.1 * kout, 0.5 * f, dt);
    approach(st, "waveV", I.waveV + (m.waveV - I.waveV) * ks + 1.5 * kout + 0.8 * kin, 0.25 * f, dt);
    // the breath in size: in with listening, keys and words kick it, and it swells as Alice finishes
    approach(st, "grow", m.grow + 0.3 * Math.min(1, kin) + 0.4 * Math.min(1, kout) + 0.5 * Math.min(1, st.v.exhale), 0.3 * f, dt);
    const sp = S().speed;
    st.bph += dt * 2 * Math.PI / 2.6;              // listening breathes about every 2.6 s
    st.spinA += dt * 2.2 * st.v.think * (1 - clamp01(st.v.read)) * K.sig;   // the Ink whirls while thinking
    st.flow += dt * st.v.speed * sp;
    st.turn += dt * st.v.turnV * sp;
    st.wave += dt * st.v.waveV * sp * 2;
  }
  function keystroke(st) { st.inImp = Math.min(1.6 * motion().cap * K.react, st.inImp + 0.45 * S().reaction * K.react); }
  function word(st, w) { st.outImp = Math.min(1.6 * motion().cap * K.react, st.outImp + (0.22 + Math.min(12, (w || "").length) * 0.03) * S().reaction * K.react); }
  function pulse(st, x) { st.outImp = Math.min(1.6 * motion().cap * K.react, st.outImp + x * S().reaction * K.react); }
  function setModeOn(st, m) {
    const was = st.mode;
    st.mode = m;
    if (m !== "reading") st.progress = null;
    if (m === "listening" && was !== "listening") st.bph = 0;   // the first breath is in
    if (m === "idle" && (was === "thinking" || was === "writing" || was === "reading")) st.exImp = K.finish;
  }

  // ================================================================ drawing
  const ROLE = {
    tile: { size: 0.88, gseed: 1 },
    fab:  { size: 0.9, gseed: 2 },
    brand:{ size: 0.9, calm: true, gseed: 3 },
  };
  let tAbs = 0, renderScale = 1;
  function setShared(st) {
    gl.uniform1i(U.u_look, LOOKS.indexOf(look));
    gl.uniform1f(U.u_flow, st.flow); gl.uniform1f(U.u_turn, st.turn); gl.uniform1f(U.u_wave, st.wave);
    gl.uniform1f(U.u_time, tAbs);
    const L = S();
    gl.uniform1f(U.u_seed, L.seed);
    gl.uniform1f(U.u_scale, L.scale); gl.uniform1f(U.u_swirl, L.swirl); gl.uniform1f(U.u_depth, L.depth);
    gl.uniform1f(U.u_edge, L.edge); gl.uniform1f(U.u_gloss, L.gloss); gl.uniform1f(U.u_glow, L.glow); gl.uniform1f(U.u_grain, L.grain);
    gl.uniform1f(U.u_move, motion().mv);
    gl.uniform1f(U.u_moveX, K.move); gl.uniform1f(U.u_work, K.work); gl.uniform1f(U.u_readDim, K.readDim);
  }
  function setEnergies(st, calm) {
    const v = calm ? CALM : st.v;
    gl.uniform1f(U.u_in, v.in); gl.uniform1f(U.u_out, v.out); gl.uniform1f(U.u_think, v.think); gl.uniform1f(U.u_listen, v.listen);
    gl.uniform1f(U.u_exhale, v.exhale);
    gl.uniform1f(U.u_fill, calm ? S().amount : Math.min(1, st.v.fill * fillScale));
    gl.uniform1f(U.u_amount, S().amount);
    gl.uniform1f(U.u_prog, calm ? 1 : st.v.prog);
    gl.uniform1f(U.u_busy, calm ? 0 : busy(st.v));
    const amt = S().amount;
    gl.uniform1f(U.u_energy, calm ? 0 : clamp01(v.think * (1 - 0.8 * v.read) + 0.9 * v.write + K.listen * v.listen + 0.3 * v.in + 0.5 * v.out));
    gl.uniform1f(U.u_read, calm ? 0 : v.read);
    gl.uniform1f(U.u_comet, calm ? amt : amt * (1 - clamp01(v.read)));
    gl.uniform1f(U.u_grow, calm ? 0 : v.grow * K.grow);
    gl.uniform1f(U.u_workE, calm ? 0 : clamp01(v.think * (1 - 0.8 * v.read) + 0.9 * v.write + 0.3 * v.in + 0.5 * v.out));
    gl.uniform1f(U.u_breath, calm ? 0 : v.listen * K.sig * Math.sin(st.bph));
    gl.uniform1f(U.u_spin, calm ? 0 : v.think * (1 - clamp01(v.read)) * K.sig);
    gl.uniform1f(U.u_sweep, calm ? 0 : v.read * K.sig);
    gl.uniform1f(U.u_beat, calm ? 0 : Math.min(1, v.out) * K.sig);
    gl.uniform1f(U.u_spinA, calm ? 0 : st.spinA);
  }
  function drawOrb(cv, st) {
    const r = cv.getBoundingClientRect();
    if (r.width < 2 || r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return;
    const role = ROLE[cv.dataset.role] || {};
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.min(GLSIZE, Math.round(r.width * dpr * (renderScale || 1))));
    if (cv.width !== w || cv.height !== w) { cv.width = w; cv.height = w; }
    gl.viewport(0, 0, w, w);
    gl.uniform2f(U.u_res, w, w);
    gl.uniform1f(U.u_size, role.size || 0.86);
    // One orb flies between sizes here, so the small-size adjustments blend in instead of switching at a size.
    gl.uniform1i(U.u_steps, 7);
    gl.uniform2f(U.u_win, 0, 0);
    gl.uniform1f(U.u_theme, cv.dataset.theme === "dark" ? 1 : cv.dataset.theme === "light" ? 0 : theme);   // data-theme: this orb's own light or dark
    gl.uniform1f(U.u_gseed, role.gseed || 0);
    const L = S();
    const small = 1 - clamp01((w - 60) / 80), mid = 1 - clamp01((w - 170) / 80);
    const soft = lerp(lerp(L.softness, Math.max(L.softness, 0.5), mid), Math.max(L.softness, 0.75), small);
    gl.uniform1f(U.u_soft, soft);
    gl.uniform1f(U.u_halo, L.halo * (role.halo !== undefined ? role.halo : 1));
    setEnergies(st, !!role.calm);
    if (small > 0) { const f = role.calm ? L.amount : Math.min(1, st.v.fill * fillScale); gl.uniform1f(U.u_fill, lerp(f, Math.max(f, 0.55), small)); }
    const iv = IDLE[cv.dataset.idle] || IDLE[idle] || IDLE.now;
    gl.uniform1f(U.u_restE, iv.restE); gl.uniform1f(U.u_anod, iv.anod); gl.uniform1f(U.u_aura, iv.aura); gl.uniform1f(U.u_weight, iv.weight);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const ctx = cv._ctx || (cv._ctx = cv.getContext("2d"));
    ctx.clearRect(0, 0, w, w);
    ctx.drawImage(HUB.canvas, 0, HUB.canvas.height - w, w, w, 0, 0, w, w);
  }
  function fallback(cv) {
    const ctx = cv.getContext("2d"); const w = cv.width = cv.height = 200;
    const g = ctx.createRadialGradient(80, 70, 10, 100, 100, 95);
    g.addColorStop(0, INK_COLORS.clear); g.addColorStop(0.5, INK_COLORS.tint); g.addColorStop(0.85, INK_COLORS.ink); g.addColorStop(1, INK_COLORS.deep);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(w / 2, w / 2, 84, 0, Math.PI * 2); ctx.fill();
  }
  // the orb's program and textures, bound on the shared context (the gradients bind theirs between orb frames)
  function bindOrb() {
    if (!prog || !HUB || !HUB.ok() || !gl || gl !== HUB.gl) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.disable(gl.BLEND); gl.bindVertexArray(VAO);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, noiseTex);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, lutTex);
    gl.useProgram(prog);
    return true;
  }
  // A window onto an orb much bigger than the canvas: o.d is the orb's diameter and o.cx, o.cy its centre, all as
  // fractions of the canvas (d and cx of its width, cy of its height; the centre may lie outside it). Drawn at the
  // canvas's own resolution, so a horizon can be the orb itself. o.theme: "dark" (default) or "light".
  function paintWindow(cv, o, st) {
    const r = cv.getBoundingClientRect();
    if (r.width < 2 || r.bottom < 0 || r.top > window.innerHeight) return;
    if (!bindOrb()) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(2, Math.round(r.width * dpr)), H = Math.max(2, Math.round(r.height * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    HUB.need(W, H);
    const size = o.size || 0.9, D = o.d * W, V = D / size;
    const cx = o.cx * W, cyUp = H - o.cy * H;           // GL counts rows from the bottom
    setShared(st);
    gl.viewport(0, 0, W, H);
    gl.uniform2f(U.u_res, V, V);
    gl.uniform2f(U.u_win, V / 2 - cx, V / 2 - cyUp);
    gl.uniform1f(U.u_size, size);
    gl.uniform1i(U.u_steps, 7);
    gl.uniform1f(U.u_theme, o.theme === "light" ? 0 : 1);
    gl.uniform1f(U.u_gseed, 4);
    const L = S();
    gl.uniform1f(U.u_soft, L.softness);
    gl.uniform1f(U.u_halo, L.halo);
    setEnergies(st, false);
    const iv = IDLE[o.idle] || IDLE[idle] || IDLE.now;
    gl.uniform1f(U.u_restE, iv.restE); gl.uniform1f(U.u_anod, iv.anod); gl.uniform1f(U.u_aura, iv.aura); gl.uniform1f(U.u_weight, iv.weight);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const ctx = cv._ctx || (cv._ctx = cv.getContext("2d"));
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(HUB.canvas, 0, HUB.canvas.height - H, W, H, 0, 0, W, H);
  }
  function render(root) {
    const list = (root || document).querySelectorAll("canvas.orb");
    if (!bindOrb()) {
      // no WebGL at all: the flat orb; a context taken away: every orb keeps its last frame
      if (!HUB || !HUB.ever) list.forEach(cv => { if (!cv._fb) { fallback(cv); cv._fb = 1; } });
      return;
    }
    HUB.need(GLSIZE, GLSIZE);
    // A canvas can ask for its own look (data-look), its own Ring at rest (data-idle) and its own Alice (data-agent,
    // from agent(name)); by default every canvas follows the page.
    const base = look, groups = new Map();
    list.forEach(cv => {
      if (cv.closest("[hidden]") || cv.offsetParent === null) return;
      const lk = cv.dataset.look && SET[cv.dataset.look] ? cv.dataset.look : base;
      const ag = cv.dataset.agent && AGENTS[cv.dataset.agent] ? cv.dataset.agent : "";
      const key = lk + "|" + ag;
      if (!groups.has(key)) groups.set(key, { lk, st: ag ? AGENTS[ag] : E, list: [] });
      groups.get(key).list.push(cv);
    });
    groups.forEach(g => {
      look = g.lk; fillScale = SET[g.lk].amount / SET[base].amount;
      setShared(g.st);
      g.list.forEach(cv => drawOrb(cv, g.st));
    });
    look = base; fillScale = 1;
  }
  // the same controls for the page's Alice and for every extra one
  function control(st) {
    return {
      setMode(m) { setModeOn(st, m); },
      progress(p) { if (st.mode !== "reading") setModeOn(st, "reading"); st.progress = clamp01(p); },
      done() { setModeOn(st, "idle"); st.exImp = K.finish; },
      pulse(x) { pulse(st, x || 0.35); },
      key() { keystroke(st); },
      word(w) { word(st, w); },
      state() { return { mode: st.mode, v: Object.assign({}, st.v) }; },
    };
  }
  const main = control(E);
  return {
    get ok() { return !!prog; },
    setLook(n) { if (SET[n]) look = n; },
    setIdle(n) { if (IDLE[n]) idle = n; },
    idles: Object.keys(IDLE),
    setContrast(n) { if (CONTRAST[n]) K = CONTRAST[n]; },
    contrasts: Object.keys(CONTRAST),
    setTheme(t) { theme = t ? 1 : 0; },
    setRenderScale(s) { renderScale = s || 1; },
    setMode: main.setMode,
    progress: main.progress,
    done: main.done,
    pulse: main.pulse,
    key: main.key,
    word: main.word,
    step(dt) { tAbs += dt; stepState(E, dt); for (const k in AGENTS) stepState(AGENTS[k], dt); },
    reset() { resetState(E); tAbs = 0; },
    render,
    paintWindow(cv, o) { o = o || {}; paintWindow(cv, o, o.agent ? (AGENTS[o.agent] || (AGENTS[o.agent] = makeState())) : E); },
    state: main.state,
    agent(name) { if (!AGENTS[name]) AGENTS[name] = makeState(); return control(AGENTS[name]); },
  };
})();

/* ===========================================================================
   site.js — the orb on alice.law.

   Every element the loader names gets a live orb over the still image inside it. On the homepage that is
   Alice in the middle of the sources diagram (the desktop and the phone version). It does what it does in
   homepage v9: when the light from the three sources reaches Alice she listens, takes each one in with a
   pulse, reads them, and lights up as she finishes; then she rests until the next round. The rounds follow
   the diagram's own light (a CSS animation on the page), so the orb and the lines stay in step.

   Kept cheap: the WebGL context and the orb's shaders are made while the browser is idle, shortly before
   the orb comes on screen; it draws only while it is on screen and the tab is visible; the canvas is the
   orb's own size (at most 2 device pixels per CSS pixel). People who turn motion off keep the still, and
   without WebGL 2 nothing happens and the still stays.

     <script src=".../alice-orb.min.js" data-targets=".home-flow_orb, .home-flow-v_orb"
             data-sync=".pl:not(.out)" data-fps="60" async></script>

   data-targets  the elements that get an orb (default [data-alice-orb]). Each needs a size; its still is an
                 <img> inside it, which fades out as the orb fades in.
   data-sync     the CSS animation the rounds follow: of the elements matching it near each orb, the one whose
                 animation starts first. Without it (or where a browser can't tell), a round every 6.4 s from
                 1.3 s after the orb comes on screen, as in v9.
   data-fps      frames a second, default 60.
   On alice.law the loader in the site's footer code adds that script tag (see the README).

   window.AliceOrbSite: version, items, scan(), attach(element), story, orb (the engine), setFps(n),
   and for testing: fps, running, drawn (frames drawn so far), webgl (true, false, or null before the first frame).
   =========================================================================== */
var VERSION = '1.0.0';
var me = document.currentScript;
function attr(n) { return me ? me.getAttribute(n) : null; }

// ---------------------------------------------------------------- settings
var TARGETS = attr('data-targets') || '[data-alice-orb]';
var SYNC = attr('data-sync') || '';
function readFps(v) { v = +v; return v > 0 ? Math.max(10, Math.min(120, v)) : 60; }
var fps = readFps(attr('data-fps'));
var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// The orb as homepage v9 shows it outside the app: the Ink look, light theme, the most expressive states.
var O = AliceOrb;
if (O) { O.setLook('ink'); O.setIdle('glow'); O.setContrast('high'); O.setTheme(0); }

// One round, as in v9, timed to the homepage's lines (home-pulse in the Home CSS): the light leaves the three
// sources at 0, 130 and 260 ms and takes 1100 ms to reach Alice; at 3000 ms it leaves her for the three steps.
var STORY = {
  listen: 0,                    // she listens as the light sets off
  pulses: [1080, 1210, 1340],   // takes each source in as its light arrives
  read: 1450, readFor: 1500,    // reads them
  done: 3000,                   // and lights up as she finishes, as the light leaves for the three steps
  round: 6400, first: 1300      // with no lines to follow: a round every 6.4 s, the first 1.3 s after she comes on screen
};
var JOIN = 250;                 // arriving this soon after a round has begun, she still plays it
var REST = 2500;                // after a round, how long the finish takes to settle
var LISTEN = 1, DONE = 64;      // bits in an item's "fired": 1 listen, 2/4/8 the pulses, 64 done

// ---------------------------------------------------------------- the orbs on the page
var items = [], uid = 0, raf = 0, last = 0, dead = false, drawn = 0, busyUntil = 0;
var root = { querySelectorAll: function () { return items.map(function (it) { return it.canvas; }); } };

function attach(el) {
  if (!el || el._aliceOrb) return el && el._aliceOrb;
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  var name = 'site-' + (uid++);
  var c = document.createElement('canvas');
  c.setAttribute('aria-hidden', 'true');
  c.setAttribute('data-theme', 'light');
  c.setAttribute('data-agent', name);
  c.style.cssText = 'position:absolute;left:0;top:0;display:block;width:100%;height:100%;pointer-events:none;opacity:0;transition:opacity 700ms cubic-bezier(.2,.8,.2,1)';
  var still = el.querySelector('img');
  if (still && still.parentNode) still.parentNode.insertBefore(c, still.nextSibling); else el.insertBefore(c, el.firstChild);
  var it = { el: el, canvas: c, still: still, agent: O.agent(name), visible: !hasIO, ready: false, ref: null, k: null, live: false, fired: 0, t0: 0 };
  el._aliceOrb = it;
  items.push(it);
  if (hasIO) { seen.observe(el); near.observe(el); } else { arrive(it, performance.now()); idle(prepare); kick(); }
  return it;
}
function scan(from) {
  var list;
  try { list = (from || document).querySelectorAll(TARGETS); } catch (e) { return; }   // a selector the browser can't read
  Array.prototype.forEach.call(list, attach);
}
// the first frame is on the canvas: the orb fades in and the still under it fades out
function show(it) {
  if (it.ready || !it.canvas._ctx) return;
  it.ready = true;
  it.canvas.setAttribute('data-ready', '');
  it.canvas.style.opacity = '1';
  if (it.still) { it.still.style.transition = 'opacity 700ms cubic-bezier(.2,.8,.2,1)'; it.still.style.opacity = '0'; }
}
// no WebGL 2 after all, or something failed: back to the stills, as if the script had never run
function die() {
  dead = true; stopLoop();
  items.forEach(function (it) {
    if (it.canvas.parentNode) it.canvas.parentNode.removeChild(it.canvas);
    if (it.still) it.still.style.opacity = '';
  });
}

// ---------------------------------------------------------------- the rounds
// the animation the rounds follow: of the elements matching data-sync in the nearest box round the orb that has
// any, the one that starts first (on the homepage: the light from the first source)
function findRef(it) {
  if (!SYNC) return null;
  for (var p = it.el.parentElement, n = 0; p && n < 6; p = p.parentElement, n++) {
    var list;
    try { list = p.querySelectorAll(SYNC); } catch (e) { return null; }
    if (!list.length) continue;
    var best = null;
    Array.prototype.forEach.call(list, function (el) {
      if (!el.getAnimations) return;
      el.getAnimations().forEach(function (a) {
        var t = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
        if (!t || !(t.duration > 0) || a.playState !== 'running') return;
        var d = +t.delay || 0;
        if (!best || d < best.delay) best = { a: a, delay: d, dur: +t.duration };
      });
    });
    return best;
  }
  return null;
}
// which round it is (k) and how far into it (ph, ms)
function phase(it, now) {
  var r = it.ref;
  if (r) {
    var t = r.a.currentTime;
    if (t != null && r.a.playState === 'running') { t = +t - r.delay; return t < 0 ? null : { k: Math.floor(t / r.dur), ph: t % r.dur, dur: r.dur }; }
    it.ref = r = null;                       // that animation stopped (the layout switched): look again on the next arrival
  }
  if (!it.t0) return null;
  var u = now - it.t0;
  return u < 0 ? null : { k: Math.floor(u / STORY.round), ph: u % STORY.round, dur: STORY.round };
}
function arrive(it, now) {
  it.ref = findRef(it) || it.ref;
  if (!(it.live && !(it.fired & DONE))) it.k = null;   // not in the middle of a round: the next one is played
  if (!it.t0) it.t0 = now + STORY.first;
}
function play(it, now) {
  var p = phase(it, now);
  if (!p) return;
  var c = it.agent;
  if (p.k !== it.k) {                                  // a new round
    if (it.live && !(it.fired & DONE)) c.done();       // the last one was cut short (the tab was away): finish it
    var first = it.k === null;
    it.k = p.k; it.fired = 0;
    it.live = it.visible && (!first || p.ph < JOIN);  // arriving in the middle of a round, she waits for the next
    if (it.live) busyUntil = Math.max(busyUntil, now + (STORY.done - p.ph) + REST);
  }
  if (!it.live) return;
  var ph = p.ph;
  if (!(it.fired & LISTEN) && ph >= STORY.listen) { it.fired |= LISTEN; c.setMode('listening'); }
  for (var i = 0; i < STORY.pulses.length; i++) {
    var bit = 2 << i;
    if (!(it.fired & bit) && ph >= STORY.pulses[i]) { it.fired |= bit; c.pulse(0.45); }
  }
  if (ph >= STORY.read && ph < STORY.done) c.progress(Math.min(1, (ph - STORY.read) / STORY.readFor));
  if (!(it.fired & DONE) && ph >= STORY.done) { it.fired |= DONE; c.done(); }
}

// ---------------------------------------------------------------- the loop
// While an orb is on screen, and after it has scrolled away until its round is over (so it never stops halfway).
function tick(now) {
  raf = 0;
  if (dead) return;
  var gap = now - last;
  if (last && gap < 1000 / fps - 2) { raf = requestAnimationFrame(tick); return; }   // hold to the frame rate
  var dt = last ? Math.min(0.05, gap / 1000) : 0; last = now;
  var any = false;
  try {
    items.forEach(function (it) { if (it.visible) any = true; play(it, now); });
    if (AliceGL.ok()) {
      if (!O.ok) { die(); return; }                    // the shaders failed on this device: the stills stay
      O.step(dt);
      O.render(root);
      drawn++;
      items.forEach(show);
    } else if (AliceGL.tried && !AliceGL.ever) { die(); return; }   // no WebGL 2 context to be had
  } catch (e) { die(); return; }
  if ((any || now < busyUntil) && !document.hidden) raf = requestAnimationFrame(tick);
}
function kick() {
  if (raf || dead || document.hidden) return;
  last = 0; raf = requestAnimationFrame(tick);
}
function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

// the context and the shaders, made while the browser is idle before the orb comes on screen
function prepare() {
  if (dead) return;
  try {
    if (AliceGL.ok()) { if (!O.ok) die(); }
    else if (AliceGL.tried && !AliceGL.ever) die();
  } catch (e) { die(); }
}
function idle(fn) { if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: 800 }); else setTimeout(fn, 60); }

var hasIO = 'IntersectionObserver' in window;
var seen = hasIO ? new IntersectionObserver(function (entries) {
  var now = performance.now();
  entries.forEach(function (e) {
    var it = e.target._aliceOrb; if (!it) return;
    var was = it.visible; it.visible = e.isIntersecting;
    if (it.visible && !was) arrive(it, now);
  });
  if (items.some(function (it) { return it.visible; })) kick();
}, { rootMargin: '100px 0px' }) : null;
var near = hasIO ? new IntersectionObserver(function (entries) {
  entries.forEach(function (e) {
    if (!e.isIntersecting) return;
    near.unobserve(e.target);
    idle(prepare);
  });
}, { rootMargin: '150% 0px' }) : null;
document.addEventListener('visibilitychange', function () { if (document.hidden) stopLoop(); else if (items.some(function (it) { return it.visible; })) kick(); });

// ---------------------------------------------------------------- start
if (reduced || !window.WebGL2RenderingContext || !O) dead = true;    // the stills stay
else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { scan(); });
else scan();

window.AliceOrbSite = {
  version: VERSION, items: items, scan: scan, attach: attach, story: STORY, orb: O,
  setFps: function (n) { fps = readFps(n); },
  get fps() { return fps; }, get running() { return !!raf; }, get drawn() { return drawn; },
  get webgl() { return dead ? false : AliceGL.ever ? true : null; }
};

})();
