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
  var VERSION = '__VERSION__';
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
