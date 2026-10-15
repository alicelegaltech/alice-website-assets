// Builds alice-orb.js (readable) and alice-orb.min.js (what the site loads) from src/.
//   node tools/build.mjs        (needs Node 18+; npx fetches esbuild the first time)
// Everything goes into one function, in this order: the shared WebGL context (src/gl.js), the orb itself
// (src/lib/orb.js, copied unchanged from homepage v9), then the website's part (src/site.js).
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const order = ['src/gl.js', 'src/lib/orb.js', 'src/site.js'];

const head = `/*! Alice orb ${pkg.version}: the orb on alice.law. Built from src/ by tools/build.mjs. */\n`;
const open = "(function () {\n'use strict';\nif (window.AliceOrbSite) return;   // loaded twice: the first one runs the page\nvar AliceOrb;\n\n";
const close = '\n})();\n';
const body = open + order.map(f => readFileSync(join(root, f), 'utf8')).join('\n') + close;
writeFileSync(join(root, 'alice-orb.js'), head + body.replace(/__VERSION__/g, pkg.version));

const min = execFileSync('npx', ['--yes', 'esbuild@0.24.0', join(root, 'alice-orb.js'),
  '--minify', '--target=es2017', '--legal-comments=none', '--charset=utf8'], { encoding: 'utf8' });
writeFileSync(join(root, 'alice-orb.min.js'), head + min.trim() + '\n');
console.log('alice-orb.js', Buffer.byteLength(head + body), 'bytes; alice-orb.min.js', Buffer.byteLength(head + min), 'bytes');
