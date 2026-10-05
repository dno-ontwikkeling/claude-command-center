// Minimal CDP client for the running app (launched with --remote-debugging-port=9333).
//   node cdp.js eval "<js expr>"      evaluate in the renderer page, print JSON (awaits promises)
//   node cdp.js shot <name>           screenshot the page -> %TEMP%\cc-docs-e2e\shots\<name>.png
//   node cdp.js click "<css>"         DOM .click() on the first match
//   node cdp.js key <Key>             dispatch a key press (e.g. Escape, Enter, ArrowDown)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = process.env.CDP_PORT || 9333;
const SHOTS = path.join(fs.realpathSync.native(os.tmpdir()), 'cc-docs-e2e', 'shots');

async function page() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const t = targets.find((x) => x.type === 'page' && x.url.includes('index.html'));
  if (!t) throw new Error(`no app page: ${targets.map((x) => `${x.type} ${x.url}`).join(', ')}`);
  return t.webSocketDebuggerUrl;
}

async function session(fn) {
  const ws = new WebSocket(await page());
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  try {
    return await fn(send);
  } finally {
    ws.close();
  }
}

async function evaluate(send, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
  return r.result.result.value;
}

const [cmd, arg] = process.argv.slice(2);
session(async (send) => {
  if (cmd === 'eval') {
    console.log(JSON.stringify(await evaluate(send, arg), null, 1));
  } else if (cmd === 'click') {
    console.log(
      await evaluate(send, `(() => { const e = document.querySelector(${JSON.stringify(arg)}); if (!e) return 'NOT_FOUND'; e.click(); return 'OK'; })()`)
    );
  } else if (cmd === 'key') {
    for (const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', { type, key: arg, code: arg, windowsVirtualKeyCode: { Escape: 27, Enter: 13, ArrowDown: 40, ArrowUp: 38 }[arg] || 0 });
    }
    console.log('OK');
  } else if (cmd === 'shot') {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(SHOTS, { recursive: true });
    const f = path.join(SHOTS, `${arg}.png`);
    fs.writeFileSync(f, Buffer.from(r.result.data, 'base64'));
    console.log(f);
  } else {
    console.log('usage: eval <expr> | click <css> | key <Key> | shot <name>');
  }
}).catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
