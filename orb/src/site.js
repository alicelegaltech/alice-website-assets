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
var VERSION = '__VERSION__';
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
