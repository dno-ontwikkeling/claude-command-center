'use strict';

/* global Terminal, FitAddon */

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

const DEFAULT_SETTINGS = {
  theme: null, // resolved from OS on first run
  fontSize: 12,
  fontFamily: 'Cascadia Mono, Consolas, monospace',
  cursorStyle: 'bar',
  cursorBlink: true,
  scrollback: 9001,
  bypass: true,
};

function loadSettings() {
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem('settings')) || {};
  } catch {
    s = {};
  }
  return { ...DEFAULT_SETTINGS, ...s };
}

const settings = loadSettings();

function saveSettings() {
  localStorage.setItem('settings', JSON.stringify(settings));
}

function termOpts() {
  return {
    theme: CAMPBELL,
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    cursorStyle: settings.cursorStyle,
    cursorBlink: settings.cursorBlink,
    scrollback: settings.scrollback,
  };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** agentId -> { dir, label, term, fit, el, ro, refit, status, dotEl } */
const agents = new Map();
/** dir -> running agent counter (for labels) */
const agentSeq = new Map();
/** cached project list [{ dir, name, branch }] */
let projectsData = [];
let activeId = null;
/** agentId -> resolver, awaiting the pty's exit (to release file locks) */
const pendingExit = new Map();

function agentsForDir(dir) {
  return [...agents.entries()].filter(([, a]) => a.dir === dir);
}

const els = {
  list: document.getElementById('project-list'),
  terminals: document.getElementById('terminals'),
  empty: document.getElementById('empty'),
  addBtn: document.getElementById('add-project'),
  themeBtn: document.getElementById('theme-toggle'),
  settingsBtn: document.getElementById('settings-btn'),
  settingsClose: document.getElementById('settings-close'),
  overlay: document.getElementById('settings'),
  setTheme: document.getElementById('set-theme'),
  setFontSize: document.getElementById('set-fontsize'),
  setFontFamily: document.getElementById('set-fontfamily'),
  setCursor: document.getElementById('set-cursor'),
  setBlink: document.getElementById('set-blink'),
  setScrollback: document.getElementById('set-scrollback'),
  setBypass: document.getElementById('set-bypass'),
  wtPicker: document.getElementById('wt-picker'),
  wtTitle: document.getElementById('wt-title'),
  wtList: document.getElementById('wt-list'),
  wtClose: document.getElementById('wt-close'),
  wtCreate: document.getElementById('wt-create'),
  wtNewName: document.getElementById('wt-newname'),
  wtNewErr: document.getElementById('wt-newname-err'),
  wtBranches: document.getElementById('wt-branches'),
  promptOverlay: document.getElementById('prompt'),
  promptTitle: document.getElementById('prompt-title'),
  promptInput: document.getElementById('prompt-input'),
  promptOk: document.getElementById('prompt-ok'),
  promptCancel: document.getElementById('prompt-cancel'),
  confirmOverlay: document.getElementById('confirm'),
  confirmTitle: document.getElementById('confirm-title'),
  confirmMsg: document.getElementById('confirm-msg'),
  confirmOk: document.getElementById('confirm-ok'),
  confirmCancel: document.getElementById('confirm-cancel'),
  confirmX: document.getElementById('confirm-x'),
};

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function applyTheme(theme) {
  settings.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  saveSettings();
  // Terminal keeps the Campbell scheme regardless of app chrome theme.
}

function initTheme() {
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

function openSettings() {
  els.setTheme.value = settings.theme;
  els.setFontSize.value = settings.fontSize;
  els.setFontFamily.value = settings.fontFamily;
  els.setCursor.value = settings.cursorStyle;
  els.setBlink.checked = settings.cursorBlink;
  els.setScrollback.value = settings.scrollback;
  els.setBypass.checked = settings.bypass;
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
els.setBypass.addEventListener('change', () => {
  settings.bypass = els.setBypass.checked;
  saveSettings();
});

// ---------------------------------------------------------------------------
// Projects sidebar
// ---------------------------------------------------------------------------

function renderSidebar() {
  els.list.innerHTML = '';

  for (const p of projectsData) {
    const item = document.createElement('li');
    item.className = 'project-item';

    // ---- project header ----
    const header = document.createElement('div');
    header.className = 'project';
    header.dataset.dir = p.dir;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.name;
    name.title = p.dir;

    const kebab = document.createElement('button');
    kebab.className = 'kebab';
    kebab.textContent = '⋮';
    kebab.title = 'Project options';

    header.append(name, kebab);
    item.appendChild(header);

    header.addEventListener('click', (e) => {
      if (e.target === kebab) return;
      const list = agentsForDir(p.dir);
      if (list.length) activate(list[0][0]);
      else newAgent(p);
    });

    kebab.addEventListener('click', (e) => {
      e.stopPropagation();
      openMenu(kebab, [
        { label: 'New agent', action: () => newAgent(p) },
        { label: 'Remove project', danger: true, action: () => removeProject(p.dir) },
      ]);
    });

    // ---- agent rows ----
    const sub = document.createElement('ul');
    sub.className = 'agents';
    for (const [id, a] of agentsForDir(p.dir)) {
      const row = document.createElement('li');
      row.className = 'agent';
      row.dataset.id = id;
      if (id === activeId) row.classList.add('active');

      const dot = document.createElement('span');
      dot.className = `dot ${a.status}`;
      a.dotEl = dot;

      const label = document.createElement('span');
      label.className = 'agent-label';
      label.textContent = a.customLabel || (a.branch ? `⎇ ${a.branch}` : a.label);
      label.title = a.cwd;

      const kebab = document.createElement('button');
      kebab.className = 'kebab';
      kebab.textContent = '⋮';
      kebab.title = 'Agent options';

      row.append(dot, label, kebab);
      sub.appendChild(row);

      row.addEventListener('click', (e) => {
        if (e.target === kebab) return;
        activate(id);
      });
      kebab.addEventListener('click', (e) => {
        e.stopPropagation();
        const items = [{ label: 'Rename', action: () => renameAgent(id) }];
        if (!a.isMain) {
          items.push({ label: 'Remove worktree', danger: true, action: () => deleteWorktree(id) });
        }
        items.push({ label: 'Remove agent', danger: true, action: () => removeAgent(id) });
        openMenu(kebab, items);
      });
    }
    item.appendChild(sub);
    els.list.appendChild(item);
  }
}

async function refreshProjects() {
  projectsData = await window.api.listProjects();
  renderSidebar();
}

async function removeProject(dir) {
  for (const [id] of agentsForDir(dir)) removeAgent(id, true);
  projectsData = await window.api.removeProject(dir);
  renderSidebar();
}

els.addBtn.addEventListener('click', async () => {
  projectsData = await window.api.addProject();
  renderSidebar();
});

// ---------------------------------------------------------------------------
// Kebab dropdown menu
// ---------------------------------------------------------------------------

function openMenu(anchor, items) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.id = 'kebab-menu';
  for (const it of items) {
    const b = document.createElement('button');
    b.textContent = it.label;
    if (it.danger) b.classList.add('danger');
    b.addEventListener('click', () => {
      closeMenu();
      it.action();
    });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 4}px`;
  menu.style.left = `${Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)}px`;
}

function closeMenu() {
  document.getElementById('kebab-menu')?.remove();
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#kebab-menu') && !e.target.classList.contains('kebab')) closeMenu();
});

// ---------------------------------------------------------------------------
// New agent — for git projects, choose a worktree first
// ---------------------------------------------------------------------------

async function newAgent(p) {
  if (!p.isGit) {
    spawn(p.dir, p.dir, null, false);
    return;
  }
  await openWorktreePicker(p);
}

async function openWorktreePicker(p) {
  const [worktrees, branches] = await Promise.all([
    window.api.listWorktrees(p.dir),
    window.api.listBranches(p.dir),
  ]);

  // --- existing worktrees ---
  els.wtList.innerHTML = '';
  for (const w of worktrees) {
    const row = document.createElement('li');
    row.className = 'wt-row';
    row.innerHTML = `<span class="wt-branch">${w.branch ? `⎇ ${w.branch}` : '(detached)'}</span>`;
    const pathEl = document.createElement('span');
    pathEl.className = 'wt-path';
    pathEl.textContent = w.path;
    row.appendChild(pathEl);
    row.addEventListener('click', () => {
      els.wtPicker.hidden = true;
      spawn(p.dir, w.path, w.branch, w.isMain);
    });
    els.wtList.appendChild(row);
  }

  // --- existing branches without a worktree ---
  els.wtBranches.innerHTML = '';
  const free = branches.filter((b) => !b.hasWorktree);
  if (!free.length) {
    const li = document.createElement('li');
    li.className = 'wt-empty';
    li.textContent = 'No spare branches — every branch already has a worktree.';
    els.wtBranches.appendChild(li);
  }
  for (const b of free) {
    const row = document.createElement('li');
    row.className = 'wt-row';
    row.innerHTML = `<span class="wt-branch">⎇ ${b.name}</span>`;
    row.addEventListener('click', () => createWorktreeFlow(p, b.name, false));
    els.wtBranches.appendChild(row);
  }

  // --- new branch (validated against existing names) ---
  const existing = new Set(branches.map((b) => b.name));
  els.wtNewName.value = '';
  els.wtNewErr.textContent = '';
  els.wtNewName.oninput = () => {
    const v = els.wtNewName.value.trim();
    els.wtNewErr.textContent = existing.has(v) ? 'Branch already exists — pick it below instead.' : '';
  };
  els.wtCreate.onclick = () => {
    const name = els.wtNewName.value.trim();
    if (!name) return;
    if (existing.has(name)) {
      els.wtNewErr.textContent = 'Branch already exists — pick it below instead.';
      return;
    }
    createWorktreeFlow(p, name, true);
  };

  els.wtPicker.hidden = false;
}

async function createWorktreeFlow(p, branch, newBranch) {
  const res = await window.api.createWorktree(p.dir, branch, newBranch);
  if (res.canceled) return;
  if (res.error) {
    await confirmDialog('Worktree creation failed', res.error, { alert: true });
    return;
  }
  els.wtPicker.hidden = true;
  spawn(p.dir, res.path, res.branch, false);
}

els.wtClose.addEventListener('click', () => (els.wtPicker.hidden = true));
els.wtPicker.addEventListener('click', (e) => {
  if (e.target === els.wtPicker) els.wtPicker.hidden = true;
});

// ---------------------------------------------------------------------------
// Text prompt modal (Electron renderer has no window.prompt)
// ---------------------------------------------------------------------------

function promptText(title, placeholder = '') {
  return new Promise((resolve) => {
    els.promptTitle.textContent = title;
    els.promptInput.value = '';
    els.promptInput.placeholder = placeholder;
    els.promptOverlay.hidden = false;
    els.promptInput.focus();

    const done = (val) => {
      els.promptOverlay.hidden = true;
      els.promptOk.onclick = null;
      els.promptCancel.onclick = null;
      els.promptInput.onkeydown = null;
      resolve(val);
    };
    els.promptOk.onclick = () => done(els.promptInput.value.trim() || null);
    els.promptCancel.onclick = () => done(null);
    els.promptInput.onkeydown = (e) => {
      if (e.key === 'Enter') done(els.promptInput.value.trim() || null);
      if (e.key === 'Escape') done(null);
    };
  });
}

// title, message, { okLabel, danger, alert } -> Promise<boolean>
function confirmDialog(title, message, opts = {}) {
  return new Promise((resolve) => {
    els.confirmTitle.textContent = title;
    els.confirmMsg.textContent = message;
    els.confirmOk.textContent = opts.okLabel || 'OK';
    els.confirmOk.classList.toggle('danger', !!opts.danger);
    els.confirmCancel.style.display = opts.alert ? 'none' : '';
    els.confirmOverlay.hidden = false;
    els.confirmOk.focus();

    const done = (val) => {
      els.confirmOverlay.hidden = true;
      els.confirmOk.onclick = null;
      els.confirmCancel.onclick = null;
      els.confirmX.onclick = null;
      document.onkeydown = null;
      resolve(val);
    };
    els.confirmOk.onclick = () => done(true);
    els.confirmCancel.onclick = () => done(false);
    els.confirmX.onclick = () => done(false);
    document.onkeydown = (e) => {
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    };
  });
}

// ---------------------------------------------------------------------------
// Agents / terminals
// ---------------------------------------------------------------------------

function spawn(dir, cwd, branch, isMain) {
  const id = `a${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const seq = (agentSeq.get(dir) || 0) + 1;
  agentSeq.set(dir, seq);

  const el = document.createElement('div');
  el.className = 'term';
  els.terminals.appendChild(el);

  const term = new Terminal(termOpts());
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);

  term.onData((data) => window.api.sendInput(id, data));

  // Refit whenever the panel changes size. Skipped while hidden (0 size),
  // so the pty is sized to the real visible panel, not the initial 80x30.
  const refit = () => {
    if (el.clientHeight === 0 || el.clientWidth === 0) return;
    try {
      fit.fit();
      window.api.resize(id, term.cols, term.rows);
    } catch {
      /* terminal disposed */
    }
  };
  const ro = new ResizeObserver(() => requestAnimationFrame(refit));
  ro.observe(el);
  document.fonts.ready.then(refit);

  agents.set(id, {
    dir,
    cwd,
    branch,
    isMain,
    label: `Agent ${seq}`,
    term,
    fit,
    el,
    ro,
    refit,
    status: 'busy',
    dotEl: null,
  });

  window.api.spawn(id, cwd, { bypass: settings.bypass });
  renderSidebar();
  activate(id);
}

async function renameAgent(id) {
  const a = agents.get(id);
  if (!a) return;
  const current = a.customLabel || (a.branch ? `⎇ ${a.branch}` : a.label);
  const name = await promptText('Rename agent', current);
  if (!name) return;
  a.customLabel = name;
  renderSidebar();
}

async function deleteWorktree(id) {
  const a = agents.get(id);
  if (!a) return;
  const { dir, cwd } = a;
  const ok = await confirmDialog('Remove worktree', `This deletes the worktree from disk:\n\n${cwd}`, {
    okLabel: 'Remove',
    danger: true,
  });
  if (!ok) return;

  // Kill the agent first and wait for the process to exit, otherwise its cwd
  // keeps a file lock on the folder and git/Windows can't remove it.
  await killAndWait(id);

  let res = await window.api.removeWorktree(dir, cwd, false);
  if (res.error) {
    const force = await confirmDialog('Force remove worktree', `git refused:\n\n${res.error}\n\nForce remove? This discards uncommitted changes.`, {
      okLabel: 'Force remove',
      danger: true,
    });
    if (force) res = await window.api.removeWorktree(dir, cwd, true);
  }
  if (res.error) await confirmDialog('Removal failed', res.error, { alert: true });

  // The agent is already dead; drop its row regardless of removal outcome.
  cleanupAgent(id);
}

// Kill the agent's pty and resolve once it has actually exited (with a short
// grace period for the OS to release the cwd handle). Falls back on timeout.
function killAndWait(id) {
  return new Promise((resolve) => {
    if (!agents.has(id)) {
      resolve();
      return;
    }
    pendingExit.set(id, resolve);
    window.api.kill(id);
    setTimeout(() => {
      if (pendingExit.delete(id)) resolve();
    }, 2500);
  });
}

// Dispose the terminal + remove the row, without killing (caller handles kill).
function cleanupAgent(id, skipRender = false) {
  const a = agents.get(id);
  if (!a) return;
  try {
    a.ro.disconnect();
    a.term.dispose();
  } catch {
    /* already gone */
  }
  a.el.remove();
  agents.delete(id);
  if (activeId === id) activeId = null;
  if (agents.size === 0) els.empty.style.display = '';
  if (!skipRender) renderSidebar();
}

function removeAgent(id, skipRender = false) {
  window.api.kill(id);
  cleanupAgent(id, skipRender);
}

function activate(id) {
  activeId = id;
  els.empty.style.display = 'none';
  for (const [aid, a] of agents) {
    a.el.classList.toggle('active', aid === id);
  }
  for (const row of els.list.querySelectorAll('.agent')) {
    row.classList.toggle('active', row.dataset.id === id);
  }
  const a = agents.get(id);
  if (a) {
    requestAnimationFrame(() => {
      a.refit();
      a.term.focus();
    });
  }
}

function setStatus(id, status) {
  const a = agents.get(id);
  if (!a) return;
  a.status = status;
  if (a.dotEl) a.dotEl.className = `dot ${status}`;
}

// ---------------------------------------------------------------------------
// Main-process streams
// ---------------------------------------------------------------------------

window.api.onData(({ id, data }) => agents.get(id)?.term.write(data));

window.api.onExit(({ id }) => {
  setStatus(id, 'dead');
  const resolve = pendingExit.get(id);
  if (resolve) {
    pendingExit.delete(id);
    setTimeout(resolve, 250); // grace for OS to release the cwd handle
  }
});

window.api.onEvent(({ agentId, status }) => {
  if (agents.has(agentId)) setStatus(agentId, status);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

initTheme();
refreshProjects();

// Branch can change while you work; refresh the sidebar periodically.
setInterval(refreshProjects, 15000);
window.addEventListener('focus', refreshProjects);

// Char metrics depend on Cascadia Mono being loaded; once fonts are ready,
// refit every terminal so row/col counts match the real glyph size.
document.fonts.ready.then(() => {
  for (const a of agents.values()) a.refit();
});
