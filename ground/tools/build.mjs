// Builds alice-ground.js (readable) and alice-ground.min.js (what the site loads) from src/.
//   node tools/build.mjs        (needs Node 18+; npx fetches esbuild the first time)
// The order matters: the library first (src/lib, copied unchanged from the Alice-gradient-background
// sandbox), then the design system's field (the hero), then the website's runtime.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const order = ['src/lib/ramp.js', 'src/lib/shaders.js', 'src/lib/renderer.js', 'src/ds-field.js', 'src/site.js'];

const head = `/*! Alice Ground ${pkg.version}: the moving gradient on alice.law. Built from src/ by tools/build.mjs. */\n`;
const body = order.map(f => readFileSync(join(root, f), 'utf8')).join('\n').replace(/__VERSION__/g, pkg.version);
writeFileSync(join(root, 'alice-ground.js'), head + body);

const min = execFileSync('npx', ['--yes', 'esbuild@0.24.0', join(root, 'alice-ground.js'),
  '--minify', '--target=es2017', '--legal-comments=none', '--charset=utf8'], { encoding: 'utf8' });
writeFileSync(join(root, 'alice-ground.min.js'), head + min.trim() + '\n');
console.log('alice-ground.js', Buffer.byteLength(head + body), 'bytes; alice-ground.min.js', Buffer.byteLength(head + min), 'bytes');
