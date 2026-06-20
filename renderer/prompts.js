'use strict';

import { els } from './dom.js';
import { state, agents } from './state.js';
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
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (Array.isArray(saved)) return saved;
  } catch {
    /* fall through to seed */
  }
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

let editingId = null;

function openManager() {
  renderList();
  hideEditor();
  els.promptsMgr.hidden = false;
}

function closeManager() {
  els.promptsMgr.hidden = true;
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
  for (const p of prompts) {
    const row = document.createElement('li');
    row.className = 'pm-row';

    const label = document.createElement('span');
    label.className = 'pm-rowlabel';
    label.textContent = p.label;
    label.title = p.text;

    const edit = document.createElement('button');
    edit.className = 'sb-btn';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => showEditor(p.id));

    const del = document.createElement('button');
    del.className = 'sb-btn';
    del.textContent = 'Delete';
    del.addEventListener('click', () => {
      prompts = prompts.filter((x) => x.id !== p.id);
      save();
      renderList();
      if (editingId === p.id) hideEditor();
    });

    row.append(label, edit, del);
    els.pmList.appendChild(row);
  }
}

function showEditor(id) {
  editingId = id;
  const p = prompts.find((x) => x.id === id);
  els.pmLabel.value = p ? p.label : '';
  els.pmText.value = p ? p.text : '';
  els.pmEditor.hidden = false;
  els.pmLabel.focus();
}

function hideEditor() {
  editingId = null;
  els.pmEditor.hidden = true;
  els.pmLabel.value = '';
  els.pmText.value = '';
}

function saveEditor() {
  const label = els.pmLabel.value.trim();
  const text = els.pmText.value.trim();
  if (!label || !text) return;
  if (editingId) {
    const p = prompts.find((x) => x.id === editingId);
    if (p) {
      p.label = label;
      p.text = text;
    }
  } else {
    prompts.push({ id: `p${Date.now()}`, label, text });
  }
  save();
  renderList();
  hideEditor();
}

els.pmAdd.addEventListener('click', () => showEditor(null));
els.pmSave.addEventListener('click', saveEditor);
els.pmCancel.addEventListener('click', hideEditor);
els.pmClose.addEventListener('click', closeManager);
els.promptsMgr.addEventListener('click', (e) => {
  if (e.target === els.promptsMgr) closeManager();
});
