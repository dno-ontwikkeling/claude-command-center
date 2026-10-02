// Copies third-party and shared files the WebView needs into www/vendor (no
// bundler, matching the desktop renderer). www/vendor is generated: gitignored.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(root, 'www', 'vendor');

const files = [
  ['node_modules/@xterm/xterm/lib/xterm.js', 'xterm.js'],
  ['node_modules/@xterm/xterm/css/xterm.css', 'xterm.css'],
  ['node_modules/@xterm/addon-fit/lib/addon-fit.js', 'addon-fit.js'],
  // Capacitor core as an IIFE: defines window.Capacitor.registerPlugin.
  ['node_modules/@capacitor/core/dist/capacitor.js', 'capacitor.js'],
  // Shared with the desktop diff viewer (pure ES module).
  ['../renderer/diff-parse.mjs', 'diff-parse.mjs'],
];

rmSync(vendor, { recursive: true, force: true });
mkdirSync(vendor, { recursive: true });
for (const [from, to] of files) cpSync(join(root, from), join(vendor, to));
console.log(`copied ${files.length} files to www/vendor`);
