// Renders the stills that sit under each gradient (images/*.webp) and the grain tile laid over them (images/grain.png).
//   node tools/stills.mjs          (needs Node 18+ and Playwright: npm install, then npx playwright install chromium)
//
// A still is the look's first frame with its grain left out, averaged down to a quarter of its size (a smooth field
// loses nothing at that size, and the browser scales it back up smoothly) and saved without loss: nothing in it for
// compression to break into squares, and a few kilobytes. The grain goes back on in CSS, drawn at the same density
// as the live canvas: the tile twice over, once added (mix-blend-mode: plus-lighter) and once taken off (difference),
// which adds up to the engine's grain, about 2.9% of full range, centred on the frame. Blending clips at white
// before the second layer can take anything off, so the still's values go through LUT first: it lifts the light
// end a little so that, with the grain on, every level comes out at the live frame's average (within a level or
// two; the very brightest stay up to 5 levels short, the very darkest up to 3 over).
// Rendered with SwiftShader (software WebGL), so the result is the same on every machine.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'images');
mkdirSync(out, { recursive: true });

const SHRINK = 4;                  // stills are saved at a quarter of the size they are rendered at
const TILE = 17;                   // the grain tile's values run 0..TILE

// LUT[v]: the value to store so that the still, with both grain layers on, averages what the live frame averages at v.
// Live: v plus uniform grain of +-12.8 levels (the engine's 2.9%), clipped. Still: |min(255, v + a) - b|, a and b 0..TILE.
function lut() {
  const live = [], comp = [], out = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    let s = 0; const n = 2001;
    for (let i = 0; i < n; i++) s += Math.min(255, Math.max(0, v - 12.81 + 25.62 * i / (n - 1)));
    live.push(s / n);
    let t = 0;
    for (let a = 0; a <= TILE; a++) for (let b = 0; b <= TILE; b++) t += Math.abs(Math.min(255, v + a) - b);
    comp.push(t / ((TILE + 1) * (TILE + 1)));
  }
  for (let v = 0; v < 256; v++) {
    let best = 0;
    for (let w = 0; w < 256; w++) if (Math.abs(comp[w] - live[v]) < Math.abs(comp[best] - live[v])) best = w;
    out[v] = best;
  }
  return out;
}
// name, look, width, height: v9's sizes for each place (the image is stretched to its box like v9's).
const STILLS = [
  ['close-desktop', 'close', 1440, 778], ['close-phone', 'close-phone', 390, 694],
  ['hero-desktop', 'hero', 1440, 1125], ['hero-phone', 'hero-phone', 390, 413],
  ['plan-desktop', 'plan', 792, 631], ['plan-phone', 'plan-phone', 358, 833]
];

// ---------------------------------------------------------------- the grain tile
// 128 x 128, one channel, values 0..TILE spread evenly. Two layers of it (one added, one taken off) have a standard
// deviation of 7.3 levels, the engine's 2.9%. Fixed seed, so it is the same every time.
function grainTile(size) {
  let s = 7 >>> 0;
  const rand = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const px = Buffer.alloc(size * size);
  for (let i = 0; i < px.length; i++) px[i] = Math.floor(rand() * (TILE + 1));
  return px;
}
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function grayPng(px, w, h) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; px.copy(raw, y * (w + 1) + 1, y * w, y * w + w); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- the stills
async function main() {
  const LUT = lut();
  writeFileSync(join(out, 'grain.png'), grayPng(grainTile(128), 128, 128));
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
  });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body style="margin:0"></body></html>');
  await page.addScriptTag({ content: readFileSync(join(root, 'alice-ground.js'), 'utf8') });
  for (const [file, name, w, h] of STILLS) {
    const url = await page.evaluate(async ([name, w, h, k, table]) => {
      const G = window.AliceGround, base = G.LOOKS[name];
      // the look with its grain off (its 1-level dither averages away when the image is shrunk)
      const spec = base.ds
        ? { ds: Object.assign({}, base.ds, { params: Object.assign({}, base.ds.params, { grain: 0 }) }) }
        : { params: Object.assign({}, base.params, { grain: 0 }), sources: base.sources, time: base.time };
      const img = new Image(); img.src = G.still(spec, w, h); await img.decode();
      // soften by about a pixel first, so the dither is gone before the image is shrunk
      const b = document.createElement('canvas'); b.width = w; b.height = h;
      const bx = b.getContext('2d'); bx.filter = 'blur(' + (k / 2) + 'px)'; bx.drawImage(img, 0, 0);
      const c = document.createElement('canvas'); c.width = Math.round(w / k); c.height = Math.round(h / k);
      const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(b, 0, 0, c.width, c.height);
      const d = x.getImageData(0, 0, c.width, c.height), a = d.data;
      for (let i = 0; i < a.length; i += 4) { a[i] = table[a[i]]; a[i + 1] = table[a[i + 1]]; a[i + 2] = table[a[i + 2]]; }
      x.putImageData(d, 0, 0);
      return c.toDataURL('image/webp', 1);              // quality 1: lossless
    }, [name, w, h, SHRINK, Array.from(LUT)]);
    const buf = Buffer.from(url.split(',')[1], 'base64');
    writeFileSync(join(out, file + '.webp'), buf);
    console.log(file + '.webp', Math.round(w / SHRINK) + 'x' + Math.round(h / SHRINK), '(for ' + w + 'x' + h + ')', buf.length, 'bytes');
  }
  await browser.close();
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
