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
