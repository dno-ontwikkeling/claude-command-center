// Dev-only preview harness: renders the real renderer in a browser with a fake
// window.api and seeded agents, so the design can be screenshotted without
// launching a second Electron instance. Run: node .impeccable/harness/build.mjs
// then serve the repo root over http and open /.impeccable/harness/index.html
// (?theme=light for the light theme).
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../../renderer/index.html', import.meta.url), 'utf8');
let html = src
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, '')
  .replace('<head>', '<head>\n    <base href="/renderer/" />')
  .replace('<script src="../node_modules/@xterm/xterm/lib/xterm.js"></script>', '<script src="/.impeccable/harness/stub.js"></script>\n    <script src="../node_modules/@xterm/xterm/lib/xterm.js"></script>')
  .replace('<script type="module" src="app.js"></script>', '<script type="module" src="app.js"></script>\n    <script type="module" src="/.impeccable/harness/seed.mjs"></script>');
fs.writeFileSync(new URL('./index.html', import.meta.url), html);
console.log('harness written');
