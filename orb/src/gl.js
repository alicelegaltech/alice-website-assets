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
