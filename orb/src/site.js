/* ===========================================================================
   site.js — the orb on alice.law.

   Every element the loader names gets a live orb over the still image inside it. On the homepage that is
   Alice in the middle of the sources diagram (the desktop and the phone version). It does what it does in
   homepage v9: when the light from the three sources reaches Alice she listens, takes each one in with a
   pulse, reads them, and lights up as she finishes; then she rests until the next round. The rounds follow
   the diagram's own light (a CSS animation on the page), so the orb and the lines stay in step.

   Kept cheap: the WebGL context and the orb's shaders are made while the browser is idle, shortly before
   the orb comes on screen; it draws only while it is on screen and the tab is visible; the canvas is the
   orb's own size, at 2 pixels per CSS pixel. People who turn motion off keep the still, and without WebGL 2
   nothing happens and the still stays.

   1.1.0: the orb is drawn straight into the canvas on the page (see src/gl.js), one canvas that goes into
   whichever orb is showing. And it is drawn at 2 pixels per CSS pixel on every screen: on a standard screen
   (1 pixel per CSS pixel) the browser shrinks it to fit, which makes it as sharp as on a Retina screen; in
   1.0.0 it was drawn at the screen's own density, which left it soft at 1x.

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
var host = null;                 // the orb whose element has the canvas
var root = { querySelectorAll: function () { return host && AliceGL.canvas ? [AliceGL.canvas] : []; } };
var DENSITY = 2;                 // pixels drawn per CSS pixel, on every screen
var density = DENSITY, avg = 0, since = 0, slowFor = 0;   // see pace()

function attach(el) {
  if (!el || el._aliceOrb) return el && el._aliceOrb;
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  var name = 'site-' + (uid++);
  var it = { el: el, name: name, still: el.querySelector('img'), agent: O.agent(name), visible: !hasIO, ready: false, ref: null, k: null, live: false, fired: 0, t0: 0 };
  el._aliceOrb = it;
  items.push(it);
  if (hasIO) { seen.observe(el); near.observe(el); } else { arrive(it, performance.now()); idle(prepare); kick(); }
  return it;
}
// the orb to draw: the first on screen that has a size (on the homepage, the desktop or the phone diagram's)
function showing() {
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (it.visible && it.el.getBoundingClientRect().width >= 2) return it;
  }
  return null;
}
// the canvas goes into that orb's element, over its still; the orb it leaves gets its still back
function place(it) {
  var c = AliceGL.canvas;
  if (!c || (host === it && c.parentNode === it.el)) return;
  if (host && host !== it) unshow(host);
  c.setAttribute('data-agent', it.name);
  c.style.opacity = '0'; c.removeAttribute('data-ready'); c._drawn = 0;
  if (it.still && it.still.parentNode) it.still.parentNode.insertBefore(c, it.still.nextSibling); else it.el.insertBefore(c, it.el.firstChild);
  host = it;
}
function scan(from) {
  var list;
  try { list = (from || document).querySelectorAll(TARGETS); } catch (e) { return; }   // a selector the browser can't read
  Array.prototype.forEach.call(list, attach);
}
// the first frame is on the canvas: the orb fades in and the still under it fades out
function show(it) {
  var c = AliceGL.canvas;
  if (it.ready || !c || c.parentNode !== it.el || !c._drawn) return;
  it.ready = true;
  c.setAttribute('data-ready', '');
  c.style.opacity = '1';
  if (it.still) { it.still.style.transition = 'opacity 700ms cubic-bezier(.2,.8,.2,1)'; it.still.style.opacity = '0'; }
}
// the still back (the canvas moved to the other orb, or the context was taken away)
function unshow(it, now) {
  it.ready = false;
  if (it.still) { it.still.style.transition = now ? 'none' : 'opacity 700ms cubic-bezier(.2,.8,.2,1)'; it.still.style.opacity = ''; }
  var c = AliceGL.canvas;
  if (c && c.parentNode === it.el) { c.style.opacity = '0'; c.removeAttribute('data-ready'); c._drawn = 0; }
}
// a context taken away: the still at once (the canvas has nothing to show); given back: the orb fades in again
AliceGL.client({ init: function () { if (items.some(function (it) { return it.visible; })) kick(); }, lost: function () { if (host) unshow(host, true); } });
// no WebGL 2 after all, or something failed: back to the stills, as if the script had never run
function die() {
  dead = true; stopLoop();
  var c = AliceGL.canvas;
  if (c && c.parentNode) c.parentNode.removeChild(c);
  host = null;
  items.forEach(function (it) { if (it.still) it.still.style.opacity = ''; });
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
      var it = showing();
      if (it) place(it);
      // 2 pixels per CSS pixel on every screen (the engine itself goes up to the screen's density, at most 2)
      O.setRenderScale(density / Math.min(Math.max(window.devicePixelRatio || 1, 0.5), DENSITY));
      O.step(dt);
      O.render(root);
      drawn++;
      if (host) { show(host); if (host.ready && last && dt) pace(gap, now); }
    } else if (AliceGL.tried && !AliceGL.ever) { die(); return; }   // no WebGL 2 context to be had
  } catch (e) { die(); return; }
  if (dead) return;
  if ((any || now < busyUntil) && !document.hidden) raf = requestAnimationFrame(tick);
}
function kick() {
  if (raf || dead || document.hidden) return;
  last = 0; raf = requestAnimationFrame(tick);
}
// A device that can't keep up (under 70% of the frame rate, on average, once the orb has been showing for 2.5 s):
// the orb is drawn at the screen's own density instead of 2 pixels per CSS pixel. Under 12 frames a second for
// 2.5 seconds even so: back to the still, as the gradient stops on such a device. Pauses (the tab away, the orb off
// screen) don't count.
function pace(gap, now) {
  if (gap > 250) return;
  if (!since) since = now;
  avg = avg ? avg * 0.94 + gap * 0.06 : gap;
  if (now - since < 2500) return;
  var base = Math.max(1, Math.min(window.devicePixelRatio || 1, DENSITY));
  if (density > base && avg > 1000 / fps / 0.7) { density = base; avg = 0; since = 0; slowFor = 0; return; }
  if (gap > 1000 / 12) { slowFor += gap; if (slowFor > 2500) die(); }
  else slowFor = 0;
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
