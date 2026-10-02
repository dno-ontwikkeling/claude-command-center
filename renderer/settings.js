'use strict';

import { els } from './dom.js';
import { agents, readLocalJson } from './state.js';
import { beep, SOUNDS } from './sound.js';
import { confirmDialog } from './modals.js';

// ---------------------------------------------------------------------------
// Terminal look — mirrors the user's Windows Terminal "Claude code" profile:
// Campbell color scheme, Cascadia Mono 12, bar cursor, 8px padding.
// ---------------------------------------------------------------------------

const CAMPBELL = {
  background: '#0C0C0C',
  foreground: '#CCCCCC',
  cursor: '#FFFFFF',
  cursorAccent: '#0C0C0C',
  selectionBackground: '#FFFFFF44',
  black: '#0C0C0C',
  red: '#C50F1F',
  green: '#13A10E',
  yellow: '#C19C00',
  blue: '#0037DA',
  magenta: '#881798',
  cyan: '#3A96DD',
  white: '#CCCCCC',
  brightBlack: '#767676',
  brightRed: '#E74856',
  brightGreen: '#16C60C',
  brightYellow: '#F9F1A5',
  brightBlue: '#3B78FF',
  brightMagenta: '#B4009E',
  brightCyan: '#61D6D6',
  brightWhite: '#F2F2F2',
};

// Light-mode terminal — mirrors Windows Terminal "One Half Light": light
// paper background, dark ink, same 16-color roles darkened for contrast on
// white so ANSI output stays legible.
const CAMPBELL_LIGHT = {
  background: '#FAFAFA',
  foreground: '#383A42',
  cursor: '#4F525E',
  cursorAccent: '#FAFAFA',
  selectionBackground: '#0037DA33',
  black: '#383A42',
  red: '#E45649',
  green: '#50A14F',
  yellow: '#C18401',
  blue: '#0184BC',
  magenta: '#A626A4',
  cyan: '#0997B3',
  white: '#FAFAFA',
  brightBlack: '#4F525E',
  brightRed: '#E45649',
  brightGreen: '#50A14F',
  brightYellow: '#C18401',
  brightBlue: '#0184BC',
  brightMagenta: '#A626A4',
  brightCyan: '#0997B3',
  brightWhite: '#FFFFFF',
};

// Terminal palette follows the app chrome theme.
function termTheme() {
  return settings.theme === 'light' ? CAMPBELL_LIGHT : CAMPBELL;
}

const DEFAULT_SETTINGS = {
  theme: null, // resolved from OS on first run
  fontSize: 12,
  fontFamily: 'Cascadia Mono, Consolas, monospace',
  cursorStyle: 'bar',
  cursorBlink: true,
  scrollback: 9001,
  copyOnSelect: true,
  bypass: true,
  notifications: true,
  sound: true,
  alwaysSound: false,
  soundType: 'beep',
  volume: 0.5,
};

function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...readLocalJson('settings', {}) };
}

export const settings = loadSettings();

function saveSettings() {
  localStorage.setItem('settings', JSON.stringify(settings));
}

export function termOpts() {
  return {
    theme: termTheme(),
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    cursorStyle: settings.cursorStyle,
    cursorBlink: settings.cursorBlink,
    scrollback: settings.scrollback,
  };
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function applyTheme(theme) {
  settings.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  saveSettings();
  // Retint every live terminal to match the new chrome theme.
  const t = termTheme();
  for (const a of agents.values()) a.term.options.theme = t;
}

export function initTheme() {
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(settings.theme || (prefersLight ? 'light' : 'dark'));
}

els.themeBtn.addEventListener('click', () => {
  applyTheme(settings.theme === 'dark' ? 'light' : 'dark');
  els.setTheme.value = settings.theme;
});

// ---------------------------------------------------------------------------
// Settings modal
// ---------------------------------------------------------------------------

function applyTermSettings() {
  for (const a of agents.values()) {
    a.term.options.fontSize = settings.fontSize;
    a.term.options.fontFamily = settings.fontFamily;
    a.term.options.cursorStyle = settings.cursorStyle;
    a.term.options.cursorBlink = settings.cursorBlink;
    a.term.options.scrollback = settings.scrollback;
    a.refit();
  }
}

// Populate the sound picker from the shared preset map (single source of truth).
els.setSoundType.innerHTML = Object.entries(SOUNDS)
  .map(([id, def]) => `<option value="${id}">${def.label}</option>`)
  .join('');

// Tabbed panels: clicking a tab shows its matching panel, hides the rest.
const setTabs = [...document.querySelectorAll('.set-tab')];
const setPanels = [...document.querySelectorAll('.set-panel')];
function selectTab(name) {
  for (const t of setTabs) t.classList.toggle('is-active', t.dataset.tab === name);
  for (const p of setPanels) p.classList.toggle('is-active', p.dataset.panel === name);
}
for (const t of setTabs) t.addEventListener('click', () => selectTab(t.dataset.tab));

function openSettings() {
  selectTab('general'); // always open on the first tab
  els.setTheme.value = settings.theme;
  els.setFontSize.value = settings.fontSize;
  els.setFontFamily.value = settings.fontFamily;
  els.setCursor.value = settings.cursorStyle;
  els.setBlink.checked = settings.cursorBlink;
  els.setScrollback.value = settings.scrollback;
  els.setCopySelect.checked = settings.copyOnSelect;
  els.setBypass.checked = settings.bypass;
  els.setNotifications.checked = settings.notifications;
  els.setSound.checked = settings.sound;
  els.setAlwaysSound.checked = settings.alwaysSound;
  els.setSoundType.value = settings.soundType;
  els.setVolume.value = Math.round(settings.volume * 100);
  els.overlay.hidden = false;
}

function closeSettings() {
  els.overlay.hidden = true;
}

els.settingsBtn.addEventListener('click', openSettings);
els.settingsClose.addEventListener('click', closeSettings);
els.overlay.addEventListener('click', (e) => {
  if (e.target === els.overlay) closeSettings();
});

els.setTheme.addEventListener('change', () => applyTheme(els.setTheme.value));
els.setFontSize.addEventListener('change', () => {
  settings.fontSize = Number(els.setFontSize.value);
  saveSettings();
  applyTermSettings();
});
els.setFontFamily.addEventListener('change', () => {
  settings.fontFamily = els.setFontFamily.value;
  saveSettings();
  applyTermSettings();
});
els.setCursor.addEventListener('change', () => {
  settings.cursorStyle = els.setCursor.value;
  saveSettings();
  applyTermSettings();
});
els.setBlink.addEventListener('change', () => {
  settings.cursorBlink = els.setBlink.checked;
  saveSettings();
  applyTermSettings();
});
els.setScrollback.addEventListener('change', () => {
  settings.scrollback = Number(els.setScrollback.value);
  saveSettings();
  applyTermSettings();
});
els.setCopySelect.addEventListener('change', () => {
  settings.copyOnSelect = els.setCopySelect.checked;
  saveSettings();
});
els.setBypass.addEventListener('change', () => {
  settings.bypass = els.setBypass.checked;
  saveSettings();
});
els.setNotifications.addEventListener('change', () => {
  settings.notifications = els.setNotifications.checked;
  saveSettings();
});
els.setSound.addEventListener('change', () => {
  settings.sound = els.setSound.checked;
  saveSettings();
});
els.setAlwaysSound.addEventListener('change', () => {
  settings.alwaysSound = els.setAlwaysSound.checked;
  saveSettings();
});
els.setSoundType.addEventListener('change', () => {
  settings.soundType = els.setSoundType.value;
  saveSettings();
  beep('done', settings.soundType, settings.volume); // preview on change
});
els.setVolume.addEventListener('input', () => {
  settings.volume = Number(els.setVolume.value) / 100; // live update while dragging
});
els.setVolume.addEventListener('change', () => {
  settings.volume = Number(els.setVolume.value) / 100;
  saveSettings(); // persist once the drag ends, not on every tick
  beep('done', settings.soundType, settings.volume); // preview once the drag ends
});
els.setSoundTest.addEventListener('click', () => {
  beep('needs-input', settings.soundType, settings.volume);
});

// ---------------------------------------------------------------------------
// Remote access tab — config + live server state come from main
// (remote:getConfig); the pairing QR is rendered there too.
// ---------------------------------------------------------------------------

let remotePoll = null;

function renderRemote(cfg) {
  els.setRemoteEnabled.checked = cfg.enabled;
  // Don't clobber a field the user is typing in.
  if (document.activeElement !== els.setRemotePort) els.setRemotePort.value = cfg.port;
  if (document.activeElement !== els.setRemoteBind) els.setRemoteBind.value = cfg.bindHost;
  if (document.activeElement !== els.setRemoteHost) els.setRemoteHost.value = cfg.advertisedHost;
  els.setRemoteHost.placeholder = `auto: ${cfg.effectiveHost}`;
  els.setRemoteHosts.innerHTML = '';
  for (const h of cfg.hostOptions) {
    const opt = document.createElement('option');
    opt.value = h.address;
    opt.label = `${h.iface}${h.tailscale ? ' (Tailscale)' : ''}`;
    els.setRemoteHosts.appendChild(opt);
  }

  const status = els.setRemoteStatus;
  status.classList.toggle('is-error', cfg.status === 'error');
  status.textContent =
    cfg.status === 'listening'
      ? `Listening on ${cfg.bindHost}:${cfg.port} — phone connects to ${cfg.effectiveHost}:${cfg.port}`
      : cfg.status === 'starting'
        ? 'Starting…'
        : cfg.status === 'error'
          ? `${cfg.error} If Windows Firewall prompted, allow access for private networks.`
          : 'Off';
  if (cfg.error && cfg.status !== 'error') {
    status.classList.add('is-error');
    status.textContent = cfg.error; // a rejected setting
  }

  els.setRemoteBypass.hidden = !(cfg.enabled && settings.bypass);
  const listening = cfg.status === 'listening';
  els.setRemotePair.disabled = !listening;
  els.setRemoteKick.disabled = !cfg.clients.length;
  if (!listening) els.setRemoteQr.hidden = true;

  els.setRemoteClients.innerHTML = '';
  if (!cfg.clients.length) {
    const li = document.createElement('li');
    li.className = 'is-empty';
    li.textContent = 'None';
    els.setRemoteClients.appendChild(li);
  }
  for (const c of cfg.clients) {
    const li = document.createElement('li');
    li.textContent = `${c.ip.replace(/^::ffff:/, '')} — since ${new Date(c.since).toLocaleTimeString()}`;
    els.setRemoteClients.appendChild(li);
  }
}

async function refreshRemote() {
  renderRemote(await window.api.getRemoteConfig());
}

async function setRemote(patch) {
  renderRemote(await window.api.setRemoteConfig(patch));
}

// Poll only while the Remote tab is visible (connected-devices list).
function setRemotePolling(on) {
  clearInterval(remotePoll);
  remotePoll = on ? setInterval(refreshRemote, 3000) : null;
}

for (const t of setTabs) {
  t.addEventListener('click', () => {
    const remoteTab = t.dataset.tab === 'remote';
    setRemotePolling(remoteTab);
    if (remoteTab) refreshRemote();
  });
}
els.settingsClose.addEventListener('click', () => setRemotePolling(false));
els.overlay.addEventListener('click', (e) => {
  if (e.target === els.overlay) setRemotePolling(false);
});

els.setRemoteEnabled.addEventListener('change', () => setRemote({ enabled: els.setRemoteEnabled.checked }));
els.setRemotePort.addEventListener('change', () => setRemote({ port: Number(els.setRemotePort.value) }));
els.setRemoteBind.addEventListener('change', () => setRemote({ bindHost: els.setRemoteBind.value.trim() }));
els.setRemoteHost.addEventListener('change', () => setRemote({ advertisedHost: els.setRemoteHost.value.trim() }));

els.setRemotePair.addEventListener('click', async () => {
  if (!els.setRemoteQr.hidden) {
    els.setRemoteQr.hidden = true;
    els.setRemotePair.textContent = 'Show pairing QR';
    return;
  }
  const res = await window.api.getRemotePairing();
  if (res.error || !res.qr) {
    await confirmDialog('Pairing unavailable', res.error || 'Could not create the pairing code.', { alert: true });
    return;
  }
  els.setRemoteQrImg.src = res.qr;
  els.setRemoteQrUrl.textContent = res.url || '';
  els.setRemoteQr.hidden = false;
  els.setRemotePair.textContent = 'Hide pairing QR';
});

els.setRemoteKick.addEventListener('click', async () => {
  renderRemote(await window.api.disconnectRemoteClients());
});

els.setRemoteRegen.addEventListener('click', async () => {
  const ok = await confirmDialog(
    'Regenerate pairing',
    'This creates a new pairing code and certificate. Every paired phone is disconnected and must scan the new QR code.',
    { okLabel: 'Regenerate', danger: true }
  );
  if (!ok) return;
  const cfg = await window.api.regenerateRemote();
  renderRemote(cfg);
  if (!els.setRemoteQr.hidden) {
    const res = await window.api.getRemotePairing();
    if (res.qr) els.setRemoteQrImg.src = res.qr;
  }
});
