'use strict';

import { els } from './dom.js';
import { state, agents } from './state.js';
import { groupDocs, filterDocs, docsSignature, buildFrame, newestDoc } from './docs-view.mjs';

// ---------------------------------------------------------------------------
// Docs panel — plans and reviews of the active agent's folder, rendered in a
// sandboxed iframe on the stage's right edge. Opens only on a user click; polls
// once a second while open so edits show up live. This module must not import
// stage.js (stage.js calls syncDocsPanel from updateStageBar).
// ---------------------------------------------------------------------------

const WIDTH_KEY = 'docsWidth';
const MIN_W = 280;
const MAX_W = 900;
const POLL_MS = 1000;
const THEME_TOKENS = ['--bg', '--fg', '--muted', '--border', '--elevated', '--select', '--add', '--del'];

const root = document.documentElement;
const remembered = new Map(); // cwd -> rel of the doc last shown there (in memory only)

let open = false;
let cwd = null; // folder the panel currently shows
let list = []; // DocEntry[] for cwd
let folders = ['plans', 'reviews']; // configured folders for cwd's project, in display order
let sig = ''; // docsSignature(list)
let currentRel = null; // doc shown in the frame
let currentStamp = ''; // `${mtimeMs}|${size}` of the shown doc when it was read
let lastHtml = null; // body html last put into the frame
let listReq = 0; // guards stale listDocs results
let docReq = 0; // guards stale readDoc results
let timer = null;

function activeAgent() {
  return (state.activeId && agents.get(state.activeId)) || null;
}

function dashboardShown() {
  return els.stage.classList.contains('show-dash');
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function baseName(rel) {
  return rel.slice(rel.lastIndexOf('/') + 1);
}

function age(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function clampWidth(w) {
  return Math.min(MAX_W, Math.max(MIN_W, w));
}

function refitAll() {
  for (const a of agents.values()) a.refit();
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

function themeTokens() {
  const cs = getComputedStyle(root);
  const tokens = {};
  for (const name of THEME_TOKENS) tokens[name] = cs.getPropertyValue(name).trim();
  return tokens;
}

// The sandbox has no allow-same-origin, so the iframe's scroll position is not
// readable: a re-render resets scroll, and we only re-render when the html differs.
function renderFrame(html, force = false) {
  if (!force && html === lastHtml) return;
  lastHtml = html;
  els.docsFrame.srcdoc = buildFrame(html, themeTokens());
}

function showEmpty(isEmpty) {
  els.docsEmpty.hidden = !isEmpty;
  els.docsFrame.hidden = isEmpty;
  if (isEmpty) {
    els.docsPickerLabel.textContent = 'No documents';
    currentRel = null;
    currentStamp = '';
    lastHtml = null;
  }
}

async function showDoc(rel) {
  const c = cwd;
  const id = ++docReq;
  const entry = list.find((d) => d.rel === rel);
  currentRel = rel;
  currentStamp = entry ? `${entry.mtimeMs}|${entry.size}` : '';
  remembered.set(c, rel);
  els.docsPickerLabel.textContent = baseName(rel);
  renderPicker();
  let res;
  try {
    res = await window.api.readDoc(c, rel);
  } catch (err) {
    res = { ok: false, error: err && err.message ? err.message : 'Could not read the document.' };
  }
  if (id !== docReq || c !== cwd || !open) return; // switched doc, folder or closed meanwhile
  const html = res && res.ok ? res.html : `<p>${esc((res && res.error) || 'Could not read the document.')}</p>`;
  renderFrame(html);
}

/** The doc to show for the current list: the remembered one if it still exists, else the newest. */
function pickDefault() {
  const mem = remembered.get(cwd);
  if (mem && list.some((d) => d.rel === mem)) return mem;
  const newest = newestDoc(list) || list[0] || null; // only archived docs left: still show one
  return newest ? newest.rel : null;
}

function applyList(next) {
  list = next;
  sig = docsSignature(list);
  renderPicker();
}

// ---------------------------------------------------------------------------
// Picker
// ---------------------------------------------------------------------------

function renderPicker() {
  const groups = groupDocs(filterDocs(list, els.docsFilter.value), folders);
  const items = [];
  for (const g of groups) {
    const head = document.createElement('li');
    head.setAttribute('role', 'presentation');
    head.className = 'docs-group';
    head.textContent = g.label;
    items.push(head);
    for (const d of g.docs) {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.tabIndex = -1;
      li.dataset.rel = d.rel;
      li.setAttribute('aria-selected', String(d.rel === currentRel));
      const name = document.createElement('span');
      name.className = 'docs-name';
      name.textContent = baseName(d.rel);
      const when = document.createElement('span');
      when.className = 'docs-age';
      when.textContent = age(d.mtimeMs);
      li.append(name, when);
      items.push(li);
    }
  }
  els.docsList.replaceChildren(...items);
}

function popupOpen() {
  return !els.docsPopup.hidden;
}

function openPopup() {
  els.docsPopup.hidden = false;
  els.docsPicker.setAttribute('aria-expanded', 'true');
  els.docsFilter.value = '';
  renderPicker();
  els.docsFilter.focus();
}

function closePopup() {
  els.docsPopup.hidden = true;
  els.docsPicker.setAttribute('aria-expanded', 'false');
}

function options() {
  return [...els.docsList.querySelectorAll('[role="option"]')];
}

function selectOption(li) {
  closePopup();
  els.docsPicker.focus();
  if (li.dataset.rel !== currentRel) showDoc(li.dataset.rel);
}

els.docsPicker.addEventListener('click', () => {
  if (popupOpen()) closePopup();
  else openPopup();
});

els.docsFilter.addEventListener('input', renderPicker);

els.docsPopup.addEventListener('keydown', (e) => {
  const opts = options();
  const idx = opts.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (opts.length) opts[Math.min(opts.length - 1, idx + 1)].focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (idx > 0) opts[idx - 1].focus();
    else els.docsFilter.focus();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const target = idx >= 0 ? opts[idx] : opts[0];
    if (target) selectOption(target);
  }
});

els.docsList.addEventListener('click', (e) => {
  const li = e.target instanceof Element ? e.target.closest('[role="option"]') : null;
  if (li) selectOption(li);
});

document.addEventListener('mousedown', (e) => {
  if (!popupOpen()) return;
  if (els.docsPopup.contains(e.target) || els.docsPicker.contains(e.target)) return;
  closePopup();
});

// Esc closes the picker first, then the panel. Only while focus is inside the
// panel, so Esc in the terminal still reaches the agent.
els.docsPanel.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  if (popupOpen()) {
    closePopup();
    els.docsPicker.focus();
  } else {
    setOpen(false);
    activeAgent()?.term.focus();
  }
});

// ---------------------------------------------------------------------------
// Loading and polling
// ---------------------------------------------------------------------------

/** (Re)load the list for the current folder and show the remembered or newest doc. */
async function loadFolder() {
  const c = cwd;
  const id = ++listReq;
  ++docReq;
  list = [];
  sig = '';
  currentRel = null;
  currentStamp = '';
  lastHtml = null;
  els.docsFilter.value = '';
  closePopup();
  renderPicker();
  els.docsPickerLabel.textContent = '';
  let next;
  try {
    next = (await window.api.listDocs(c)) || [];
  } catch {
    next = [];
  }
  if (id !== listReq || c !== cwd || !open) return;
  applyList(next);
  const rel = pickDefault();
  if (rel === null) {
    showEmpty(true);
    return;
  }
  showEmpty(false);
  showDoc(rel);
}

async function poll() {
  if (!open || document.visibilityState !== 'visible' || !activeAgent()) return;
  const c = cwd;
  const id = ++listReq;
  let next;
  try {
    next = await window.api.listDocs(c);
  } catch {
    return;
  }
  if (id !== listReq || c !== cwd || !open || !Array.isArray(next)) return;
  const nextSig = docsSignature(next);
  if (nextSig === sig) return;
  applyList(next);
  const entry = currentRel === null ? null : list.find((d) => d.rel === currentRel);
  if (!entry) {
    const rel = pickDefault();
    if (rel === null) {
      showEmpty(true);
      return;
    }
    showEmpty(false);
    showDoc(rel);
  } else if (`${entry.mtimeMs}|${entry.size}` !== currentStamp) {
    showDoc(entry.rel);
  }
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------

/** Keeps show-docs, the hidden attributes and the poll timer in sync. */
function applyOpen() {
  els.stage.classList.toggle('show-docs', open);
  els.docsPanel.hidden = !open;
  els.docsResizer.hidden = !open;
  els.sbDocs.classList.toggle('on', open);
  els.sbDocs.setAttribute('aria-pressed', String(open));
  if (open && !timer) timer = setInterval(poll, POLL_MS);
  else if (!open && timer) {
    clearInterval(timer);
    timer = null;
  }
  if (!open) {
    closePopup();
    ++listReq;
    ++docReq;
  }
  requestAnimationFrame(refitAll); // the terminal column changed width
}

function setOpen(next) {
  if (open === next) return;
  open = next;
  applyOpen();
  if (open) {
    cwd = activeAgent().cwd;
    loadFolder();
  } else {
    cwd = null;
  }
}

els.sbDocs.addEventListener('click', () => {
  if (open) {
    setOpen(false);
    return;
  }
  if (!activeAgent() || dashboardShown()) return;
  setOpen(true);
});

els.docsClose.addEventListener('click', () => {
  setOpen(false);
  activeAgent()?.term.focus();
});

/** Called from updateStageBar (every activate) and when the dashboard toggles. */
export function syncDocsPanel() {
  if (!open) return;
  const a = activeAgent();
  if (!a || dashboardShown()) {
    setOpen(false);
    return;
  }
  if (a.cwd !== cwd) {
    cwd = a.cwd;
    loadFolder();
  }
}

new MutationObserver(syncDocsPanel).observe(els.stage, { attributes: true, attributeFilter: ['class'] });

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

new MutationObserver(() => {
  if (open && lastHtml !== null) renderFrame(lastHtml, true);
}).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

// ---------------------------------------------------------------------------
// Resize — drag the splitter to set --docs-w (clamped, persisted)
// ---------------------------------------------------------------------------

try {
  const saved = Number(localStorage.getItem(WIDTH_KEY));
  if (saved) root.style.setProperty('--docs-w', `${clampWidth(saved)}px`);
} catch {
  /* storage unavailable: keep the default width */
}

let resizing = false;
els.docsResizer.addEventListener('mousedown', (e) => {
  resizing = true;
  document.body.classList.add('resizing');
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!resizing) return;
  const w = clampWidth(els.stage.getBoundingClientRect().right - e.clientX);
  root.style.setProperty('--docs-w', `${w}px`);
});
window.addEventListener('mouseup', () => {
  if (!resizing) return;
  resizing = false;
  document.body.classList.remove('resizing');
  const w = parseInt(getComputedStyle(root).getPropertyValue('--docs-w'), 10);
  try {
    localStorage.setItem(WIDTH_KEY, String(w));
  } catch {
    /* storage unavailable: width just won't persist */
  }
  refitAll();
});
