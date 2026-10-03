// Entry point: wires the native link to the shared state, owns pairing, boots.
// Screens live in their own modules and register into core.screens.
import * as link from './remote-link.mjs';
import { decodePairing, describePairing } from './pairing.mjs';
import { parseServerFrame } from './proto.mjs';
import { ctx, screens, show, currentScreen, notifyChanged } from './core.mjs';
import { h } from './dom.mjs';
import './list.mjs';
import './settings-screen.mjs';
import './terminal.mjs';
import './git.mjs';
import './history.mjs';

const Scanner = window.Capacitor?.registerPlugin('CapacitorBarcodeScanner');
const QR_CODE = 0; // html5-qrcode Html5QrcodeSupportedFormats.QR_CODE

// ---- link events ------------------------------------------------------------

link.onMessage((text) => {
  const frame = parseServerFrame(text);
  if (!frame) return;
  if (frame.t === 'agents') {
    if (ctx.agents.apply(frame)) notifyChanged();
  } else if (frame.t === 'rpc-result') {
    ctx.rpc.onResult(frame);
  }
  for (const cb of ctx.frameSubs) cb(frame);
});

link.onState(({ state, detail }) => {
  const was = ctx.linkState;
  ctx.linkState = state;
  ctx.linkDetail = detail;
  if (state === 'connecting') ctx.agents.reset(); // a restarted desktop restarts its seq
  if (was === 'connected' && state !== 'connected') ctx.rpc.failAll(new Error('Disconnected from PC'));
  if (state === 'unpaired' || state === 'auth-failed') show('pairing', { reason: state });
  else if (currentScreen() === 'pairing') show('list');
  else notifyChanged();
});

// Tapping a needs-input notification opens that agent (or the list if gone).
link.onNotificationTap((agentId) => {
  const a = ctx.agents.get(agentId);
  if (a && !a.dormant && screens.terminal) show('terminal', { id: agentId });
  else show('list');
});

// ---- pairing ----------------------------------------------------------------

// `getCode` returns the pairing code: from the QR scanner, or typed/pasted.
async function pair(status, getCode) {
  status.textContent = '';
  try {
    const pairing = decodePairing(await getCode());
    status.textContent = `${describePairing(pairing)}…`;
    await link.requestNotificationPermission();
    await link.connect(pairing);
    show('list');
  } catch (err) {
    // A cancelled scan rejects too; only surface real problems.
    const msg = (err && err.message) || String(err);
    if (!/cancel/i.test(msg)) status.textContent = msg;
  }
}

async function scanCode() {
  const { ScanResult } = await Scanner.scanBarcode({
    hint: QR_CODE,
    scanInstructions: 'Scan the QR code in Command Center → Settings → Remote',
    scanButton: false,
    android: { scanningLibrary: 'zxing' }, // works without Google Play services
  });
  return ScanResult;
}

screens.pairing = (el, { reason } = {}) => {
  const status = h('p', { class: 'status error' });
  const codeInput = h('textarea', {
    class: 'link-code',
    rows: 3,
    placeholder: 'ccr1:…',
    autocapitalize: 'off',
    autocomplete: 'off',
    spellcheck: false,
  });
  el.append(
    h(
      'section',
      { class: 'pairing' },
      h('h1', {}, 'CommandCenter remote'),
      reason === 'auth-failed'
        ? h('p', { class: 'warn' }, 'Your PC no longer accepts this phone (pairing regenerated). Scan the new QR code.')
        : h('p', {}, 'Open Command Center on your PC → Settings → Remote, turn on remote access and show the pairing QR.'),
      h('button', { class: 'primary', onclick: () => pair(status, scanCode) }, 'Scan pairing QR'),
      h('p', { class: 'muted' }, 'Or paste the linking code (PC: Copy linking code):'),
      codeInput,
      h('button', { onclick: () => pair(status, () => codeInput.value) }, 'Link with code'),
      status,
    ),
  );
};

// ---- boot -------------------------------------------------------------------

(async () => {
  if (!window.Capacitor?.isNativePlatform?.()) {
    document.getElementById('app').replaceChildren(h('p', { class: 'muted' }, 'CommandCenter remote runs inside the Android app.'));
    return;
  }
  const st = await link.getState();
  ctx.linkState = st.state;
  if (!st.paired) return show('pairing', {});
  if (st.state === 'auth-failed') return show('pairing', { reason: 'auth-failed' });
  show('list');
  // Paired but the service isn't running (app was closed): reconnect — except
  // after a kick from the desktop, which waits for the user to tap Reconnect.
  if (st.state === 'idle') link.connect();
})();
