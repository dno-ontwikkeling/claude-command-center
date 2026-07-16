'use strict';

import { els } from './dom.js';
import { state, agents, readLocalJson } from './state.js';
import { openMenu } from './modals.js';

// ---------------------------------------------------------------------------
// Smart Prompts — user-editable templates injected into the active agent's pty.
// Text is *typed* (no trailing Enter) so you can edit before submitting.
// {branch} / {cwd} are resolved from the active agent. Stored in localStorage,
// seeded with the defaults below on first run.
// ---------------------------------------------------------------------------

const STORE_KEY = 'smartPrompts';

const DEFAULT_PROMPTS = [
  { label: 'Review changes', text: 'Review my uncommitted changes for bugs, edge cases, and security issues. Be concise.' },
  { label: 'Commit (no push)', text: 'Stage and commit my changes with a clear Conventional Commits message. Do not push.' },
  { label: 'Write tests', text: 'Write tests for the code you just changed. Cover the edge cases and failure paths.' },
  { label: 'Fix failing tests', text: 'Run the test suite, identify the failures, and fix the root cause — not the symptom.' },
  { label: 'Explain this branch', text: 'Summarize what changed on branch {branch} compared to the main branch.' },
  { label: 'Open a PR', text: 'Push branch {branch} and open a pull request with a clear title and description.' },
];

function load() {
  const saved = readLocalJson(STORE_KEY, null);
  if (Array.isArray(saved)) return saved;
  const seeded = DEFAULT_PROMPTS.map((p, i) => ({ id: `p${i}`, ...p }));
  localStorage.setItem(STORE_KEY, JSON.stringify(seeded));
  return seeded;
}

let prompts = load();

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(prompts));
}

function runSmartPrompt(text) {
  const id = state.activeId;
  const a = id && agents.get(id);
  if (!a) return;
  const filled = text
    .replaceAll('{branch}', a.branch || 'the current branch')
    .replaceAll('{cwd}', a.cwd);
  window.api.sendInput(id, filled);
  a.term.focus();
}

// ---- menu ----

els.promptsBtn.addEventListener('click', (e) => {
  // Stop the bubble to the document handler that would instantly close the menu.
  e.stopPropagation();
  const hasAgent = state.activeId && agents.has(state.activeId);
  const items = prompts.map((p) => ({
    label: p.label,
    action: () => runSmartPrompt(p.text),
    disabled: !hasAgent,
  }));
  items.push({ label: '⚙ Manage prompts…', action: openManager });
  openMenu(els.promptsBtn, items);
});

// ---- manager modal ----
// Single scrollable list of prompt cards. A card is either in display mode
// (label + text preview, hover reveals edit/delete) or edit mode (inline
// label/textarea). `editingId` tracks which card is open; `draftId` marks a
// freshly-added card that is discarded if cancelled before its first save.

let editingId = null;
let draftId = null;

function openManager() {
  editingId = null;
  draftId = null;
  renderList();
  els.promptsMgr.hidden = false;
}

function closeManager() {
  discardDraft();
  els.promptsMgr.hidden = true;
}

// Drop an unsaved new card if the user leaves it without saving.
function discardDraft() {
  if (draftId) {
    prompts = prompts.filter((x) => x.id !== draftId);
    draftId = null;
  }
  editingId = null;
}

function renderList() {
  els.pmList.innerHTML = '';
  if (!prompts.length) {
    const li = document.createElement('li');
    li.className = 'pm-empty';
    li.textContent = 'No prompts yet — add one below.';
    els.pmList.appendChild(li);
    return;
  }
  prompts.forEach((p, i) => {
    els.pmList.appendChild(p.id === editingId ? editCard(p) : displayCard(p, i));
  });
}

function displayCard(p, index) {
  const row = document.createElement('li');
  row.className = 'pm-card';
  row.draggable = true;
  attachDrag(row, index);

  const handle = document.createElement('span');
  handle.className = 'pm-drag';
  handle.textContent = '⠿';
  handle.title = 'Drag to reorder';

  const body = document.createElement('div');
  body.className = 'pm-body';
  body.addEventListener('click', () => startEdit(p.id));
  const label = document.createElement('span');
  label.className = 'pm-label';
  label.textContent = p.label;
  const preview = document.createElement('span');
  preview.className = 'pm-preview';
  preview.textContent = p.text;
  body.append(label, preview);

  const acts = document.createElement('div');
  acts.className = 'pm-acts';
  const edit = iconBtn('✎', 'Edit', () => startEdit(p.id));
  const del = iconBtn('🗑', 'Delete', () => {
    prompts = prompts.filter((x) => x.id !== p.id);
    save();
    renderList();
  });
  del.classList.add('pm-del');
  acts.append(edit, del);

  row.append(handle, body, acts);
  return row;
}

function editCard(p) {
  const row = document.createElement('li');
  row.className = 'pm-card pm-card-edit';

  const label = document.createElement('input');
  label.type = 'text';
  label.className = 'pm-ed-label';
  label.placeholder = 'Label';
  label.value = p.label;

  const text = document.createElement('textarea');
  text.className = 'pm-ed-text';
  text.rows = 4;
  text.placeholder = 'Prompt text — use {branch} / {cwd}';
  text.value = p.text;

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const cancel = document.createElement('button');
  cancel.className = 'btn-ghost';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    discardDraft();
    renderList();
  });
  const ok = document.createElement('button');
  ok.className = 'btn-primary';
  ok.textContent = 'Save';
  const commit = () => {
    const l = label.value.trim();
    const t = text.value.trim();
    if (!l || !t) return;
    p.label = l;
    p.text = t;
    draftId = null;
    editingId = null;
    save();
    renderList();
  };
  ok.addEventListener('click', commit);
  // Ctrl/Cmd+Enter saves from the textarea.
  text.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') commit();
  });
  actions.append(cancel, ok);

  row.append(label, text, actions);
  setTimeout(() => label.focus(), 0);
  return row;
}

function iconBtn(glyph, title, onClick) {
  const b = document.createElement('button');
  b.className = 'icon-btn';
  b.textContent = glyph;
  b.title = title;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function startEdit(id) {
  discardDraft();
  editingId = id;
  renderList();
}

// ---- drag reorder ----

let dragFrom = null;

function attachDrag(row, index) {
  row.addEventListener('dragstart', (e) => {
    dragFrom = index;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  row.addEventListener('dragend', () => {
    dragFrom = null;
    row.classList.remove('dragging');
    els.pmList.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
  });
  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (dragFrom !== null && dragFrom !== index) row.classList.add('drop-target');
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    row.classList.remove('drop-target');
    if (dragFrom === null || dragFrom === index) return;
    const [moved] = prompts.splice(dragFrom, 1);
    prompts.splice(index, 0, moved);
    save();
    renderList();
  });
}

els.pmAdd.addEventListener('click', () => {
  discardDraft();
  const p = { id: `p${Date.now()}`, label: '', text: '' };
  prompts.push(p);
  draftId = p.id;
  editingId = p.id;
  renderList();
});
els.pmClose.addEventListener('click', closeManager);
els.promptsMgr.addEventListener('click', (e) => {
  if (e.target === els.promptsMgr) closeManager();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.promptsMgr.hidden) closeManager();
});
