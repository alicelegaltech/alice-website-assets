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
