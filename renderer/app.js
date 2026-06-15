'use strict';

/* global Terminal, FitAddon */

const api = window.cc;

// Per-agent terminal state: id -> { term, fit, el }
const terms = new Map();
let agentsCache = [];
let activeId = null;

// xterm theme matching the odysseus One-Dark palette.
const XTERM_THEME = {
  background: '#282c34',
  foreground: '#9cdef2',
  cursor: '#00aaff',
  selectionBackground: '#355a66',
  black: '#282c34',
  red: '#e06c75',
  green: '#50fa7b',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#9cdef2',
  brightBlack: '#828997',
  brightRed: '#ff4444',
  brightGreen: '#00ff00',
  brightYellow: '#f0ad4e',
  brightBlue: '#00aaff',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff',
};

// ── DOM refs ──────────────────────────────────────────────────────────
const el = (id) => document.getElementById(id);
const agentList = el('agentList');
const terminalEl = el('terminal');
const emptyState = el('emptyState');
const activeName = el('activeName');
const activeDir = el('activeDir');
const activeStatus = el('activeStatus');
const inputBox = el('inputBox');

// ── Terminal management ───────────────────────────────────────────────
function ensureTerm(id) {
  if (terms.has(id)) return terms.get(id);

  const container = document.createElement('div');
  container.className = 'term-instance';
  container.style.cssText = 'width:100%;height:100%;display:none;';
  terminalEl.appendChild(container);

  const term = new Terminal({
    fontFamily: '"Fira Code", "Cascadia Code", Consolas, monospace',
    fontSize: 13,
    cursorBlink: true,
    theme: XTERM_THEME,
    scrollback: 5000,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(container);

  // Keystrokes from the focused terminal go straight to the PTY.
  term.onData((data) => {
    if (activeId === id) api.sendInput(id, data);
  });

  const entry = { term, fit, el: container };
  terms.set(id, entry);
  return entry;
}

function fitActive() {
  if (activeId == null) return;
  const t = terms.get(activeId);
  if (!t) return;
  try {
    t.fit.fit();
    api.resize(activeId, t.term.cols, t.term.rows);
  } catch (_) {
    /* ignore */
  }
}

function selectAgent(id) {
  activeId = id;
  for (const [tid, t] of terms) {
    t.el.style.display = tid === id ? 'block' : 'none';
  }
  const a = agentsCache.find((x) => x.id === id);
  emptyState.style.display = a ? 'none' : 'flex';

  if (a) {
    ensureTerm(id);
    terms.get(id).el.style.display = 'block';
    activeName.textContent = a.name;
    activeDir.textContent = a.projectDir;
    setStatusPill(a.status);
    requestAnimationFrame(() => {
      fitActive();
      terms.get(id).term.focus();
    });
  } else {
    activeName.textContent = 'No agent selected';
    activeDir.textContent = '';
    activeStatus.className = 'status-pill';
    activeStatus.textContent = '';
  }
  renderSidebar();
}

function setStatusPill(status) {
  activeStatus.className = 'status-pill ' + status;
  activeStatus.textContent = status;
}

// ── Sidebar ───────────────────────────────────────────────────────────
function renderSidebar() {
  agentList.innerHTML = '';
  if (!agentsCache.length) {
    const hint = document.createElement('div');
    hint.className = 'agent-card';
    hint.style.cursor = 'default';
    hint.innerHTML =
      '<div class="dir">No agents yet. Click “+ New agent”.</div>';
    agentList.appendChild(hint);
    return;
  }
  for (const a of agentsCache) {
    const card = document.createElement('div');
    card.className = 'agent-card' + (a.id === activeId ? ' active' : '');
    card.onclick = () => selectAgent(a.id);

    const kindTag = a.kind === 'shell' ? ' ⌘' : '';
    card.innerHTML = `
      <div class="row">
        <span class="dot ${a.status}"></span>
        <span class="name">${escapeHtml(a.name)}${kindTag}</span>
      </div>
      <div class="dir">${escapeHtml(a.projectDir)}</div>
      <div class="last">${escapeHtml(a.lastLine || '')}</div>
    `;
    agentList.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ── IPC wiring ────────────────────────────────────────────────────────
api.onData(({ id, data }) => {
  ensureTerm(id).term.write(data);
});

api.onExit(({ id, exitCode }) => {
  const t = terms.get(id);
  if (t) t.term.write(`\r\n\x1b[31m[process exited: code ${exitCode}]\x1b[0m\r\n`);
});

api.onAgentsChanged((list) => {
  agentsCache = list;
  // Update status pill if the active agent changed state.
  if (activeId != null) {
    const a = agentsCache.find((x) => x.id === activeId);
    if (a) setStatusPill(a.status);
  }
  renderSidebar();
});

// ── Controls ──────────────────────────────────────────────────────────
el('inputForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (activeId == null) return;
  const v = inputBox.value;
  api.sendInput(activeId, v + '\r');
  inputBox.value = '';
  const t = terms.get(activeId);
  if (t) t.term.focus();
});

document.querySelectorAll('.key').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (activeId == null) return;
    // data-send uses literal escapes like \r, \x1b, \x03 — decode them.
    const raw = btn.getAttribute('data-send');
    api.sendInput(activeId, decodeEscapes(raw));
    const t = terms.get(activeId);
    if (t) t.term.focus();
  });
});

function decodeEscapes(s) {
  return s
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\x1b/g, '\x1b')
    .replace(/\\x03/g, '\x03');
}

el('killBtn').addEventListener('click', () => {
  if (activeId != null) api.killAgent(activeId);
});

el('removeBtn').addEventListener('click', () => {
  if (activeId == null) return;
  const id = activeId;
  api.removeAgent(id);
  const t = terms.get(id);
  if (t) {
    t.term.dispose();
    t.el.remove();
    terms.delete(id);
  }
  activeId = null;
  selectAgent(null);
});

el('restartBtn').addEventListener('click', async () => {
  if (activeId == null) return;
  const oldId = activeId;
  const fresh = await api.restartAgent(oldId);
  const t = terms.get(oldId);
  if (t) {
    t.term.dispose();
    t.el.remove();
    terms.delete(oldId);
  }
  if (fresh) selectAgent(fresh.id);
});

// ── New-agent modal ───────────────────────────────────────────────────
const modal = el('modal');
const mName = el('mName');
const mDir = el('mDir');

function openModal() {
  mName.value = '';
  mDir.value = '';
  modal.classList.remove('hidden');
  mDir.focus();
}
function closeModal() {
  modal.classList.add('hidden');
}

el('newAgentBtn').addEventListener('click', openModal);
el('mCancel').addEventListener('click', closeModal);

el('mPick').addEventListener('click', async () => {
  const dir = await api.pickDir();
  if (dir) mDir.value = dir;
});

el('mCreate').addEventListener('click', async () => {
  const fresh = await api.spawnAgent({
    name: mName.value.trim(),
    projectDir: mDir.value.trim(),
    kind: 'claude',
  });
  closeModal();
  if (fresh) selectAgent(fresh.id);
});

el('newShellBtn').addEventListener('click', async () => {
  const dir = await api.pickDir();
  if (dir === null) return; // cancelled
  const fresh = await api.spawnAgent({ projectDir: dir, kind: 'shell' });
  if (fresh) selectAgent(fresh.id);
});

// Enter in modal dir field triggers create.
mDir.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el('mCreate').click();
});

// ── Resize handling ───────────────────────────────────────────────────
window.addEventListener('resize', () => fitActive());

// ── Boot ──────────────────────────────────────────────────────────────
(async () => {
  agentsCache = await api.listAgents();
  renderSidebar();
  if (agentsCache.length) selectAgent(agentsCache[0].id);
})();
