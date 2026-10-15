/* src/gl.js: the orb's WebGL context.
   1.1.0: the context is made on the canvas that is on the page, and the orb is drawn straight into it. In 1.0.0 (and in
   v9) every orb and every gradient drew into one hidden canvas, and each frame was copied from there onto the canvas on
   the page; on some computers the page could show a copy that was only partly updated. Drawn straight into the canvas
   on the page, a frame reaches the screen whole, and there is no copy to make. site.js puts this one canvas into the
   orb that is showing (on the homepage, the desktop or the phone diagram). The gradient (Alice Ground 1.3.0) has
   contexts of its own; nothing is shared through window.AliceGL any more.
   The interface is v9's (ok, gl, canvas, ever, tried, client, res, need), so src/lib/orb.js keeps working with it. */
var AliceGL = (function () {
  var canvas = null, gl = null, clients = [], res = {}, lostAt = 0, ever = false, tried = false;
  // a frame is shown whole once it is finished (no preserveDrawingBuffer), the orb's edge is see-through (alpha),
  // and the computer's everyday graphics chip is asked for
  var ATTRS = { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
  function make() {
    var old = canvas;
    canvas = document.createElement('canvas');
    canvas.width = 2; canvas.height = 2;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.setAttribute('data-theme', 'light');
    canvas.style.cssText = 'position:absolute;left:0;top:0;display:block;width:100%;height:100%;pointer-events:none;opacity:0;transition:opacity 700ms cubic-bezier(.2,.8,.2,1)';
    if (old) {                                             // a new canvas after a context that never came back: same place
      if (old.hasAttribute('data-agent')) canvas.setAttribute('data-agent', old.getAttribute('data-agent'));
      if (old.parentNode) old.parentNode.replaceChild(canvas, old);
    }
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();                                  // ask for it back
      lostAt = performance.now(); res = {};
      clients.forEach(function (c) { if (c.lost) c.lost(); });
    });
    canvas.addEventListener('webglcontextrestored', function () { lostAt = 0; res = {}; ready(); });
    gl = null; tried = true;
    try { gl = canvas.getContext('webgl2', ATTRS); } catch (e) { gl = null; }
    if (gl && !gl.isContextLost()) ready();
  }
  function ready() { ever = true; clients.forEach(function (c) { c.init(gl); }); }
  function ok() {
    if (!canvas) make();
    if (gl && !gl.isContextLost()) return true;
    // taken and not given back: a new canvas and context
    if (lostAt && performance.now() - lostAt > 2500) { lostAt = performance.now(); make(); }
    return !!(gl && !gl.isContextLost());
  }
  return {
    ok: ok,
    direct: true,
    get gl() { return gl; },
    get canvas() { return canvas; },
    get ever() { return ever; },
    get tried() { return tried; },
    client: function (c) { clients.push(c); if (gl && !gl.isContextLost()) c.init(gl); },
    res: function (key, build) { if (!(key in res)) res[key] = build(); return res[key]; },
    need: function () {}                                   // the canvas is sized to the orb when it is drawn
  };
})();
