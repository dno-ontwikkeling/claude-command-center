'use strict';

import { els } from './dom.js';
import { ICONS } from './icons.mjs';

// ---------------------------------------------------------------------------
// Docs folders overlay — edit which folders the Docs panel lists for one
// project or workspace. The list is saved on that record in main
// (docs:folders-set), so every worktree of the project shares it and it goes
// away when the project is forgotten. Main validates and normalizes; this
// module only edits a draft and shows main's error inline.
// ---------------------------------------------------------------------------

let draft = []; // folders being edited
let target = null; // { cwd, dir } of the agent the overlay was opened for
let onSaved = null;
let session = 0; // bumps on every open/close so a late picker or save result is dropped

/**
 * @param {{ cwd: string, dir: string }} agent the active agent: `dir` owns the config, `cwd` anchors the picker
 * @param {string[]} current the folders the panel shows now
 * @param {(folders: string[]) => void} saved called with the normalized list after a successful save
 */
export function openFoldersDialog(agent, current, saved) {
  session++;
  target = { cwd: agent.cwd, dir: agent.dir };
  draft = [...current];
  onSaved = saved;
  showError('');
  render();
  els.dfOverlay.hidden = false;
  els.dfAdd.focus();
}

function close() {
  session++;
  els.dfOverlay.hidden = true;
  target = null;
  onSaved = null;
}

function showError(msg) {
  els.dfError.textContent = msg;
  els.dfError.hidden = !msg;
}

function render() {
  if (!draft.length) {
    const li = document.createElement('li');
    li.className = 'pm-empty';
    li.textContent = 'No folders: the panel will list plans and reviews.';
    els.dfList.replaceChildren(li);
    return;
  }
  els.dfList.replaceChildren(
    ...draft.map((folder, i) => {
      const row = document.createElement('li');
      row.className = 'pm-card df-row';
      const icon = document.createElement('span');
      icon.className = 'df-icon';
      icon.innerHTML = ICONS.folder; // trusted literal from icons.mjs
      const name = document.createElement('span');
      name.className = 'pm-label';
      name.textContent = folder === '.' ? 'Project root' : folder; // user text: textContent only
      name.title = folder === '.' ? 'Files directly in the project folder' : folder;
      const del = document.createElement('button');
      del.className = 'icon-btn pm-del';
      del.innerHTML = ICONS.trash;
      del.title = 'Remove from the list (files are not touched)';
      del.addEventListener('click', () => {
        draft.splice(i, 1);
        showError('');
        render();
      });
      row.append(icon, name, del);
      return row;
    })
  );
}

els.dfAdd.addEventListener('click', async () => {
  if (!target) return;
  const s = session;
  let res;
  try {
    res = await window.api.pickDocFolder(target.cwd);
  } catch (err) {
    res = { error: err && err.message ? err.message : 'Could not open the folder picker.' };
  }
  if (s !== session || !res || res.canceled) return; // closed meanwhile, or cancelled
  if (res.error) {
    showError(res.error);
    return;
  }
  const rel = res.rel;
  if (!rel) return;
  if (draft.some((f) => f.toLowerCase() === rel.toLowerCase())) {
    showError(`${rel === '.' ? 'The project root' : rel} is already in the list.`);
    return;
  }
  draft.push(rel);
  showError('');
  render();
});

els.dfSave.addEventListener('click', async () => {
  if (!target) return;
  const s = session;
  const { dir } = target;
  els.dfSave.disabled = true;
  let res;
  try {
    res = await window.api.setDocFolders({ dir, folders: draft });
  } catch (err) {
    res = { ok: false, error: err && err.message ? err.message : 'Could not save the folders.' };
  } finally {
    els.dfSave.disabled = false;
  }
  if (s !== session) return;
  if (!res || !res.ok) {
    showError((res && res.error) || 'Could not save the folders.'); // stays open so nothing is lost
    return;
  }
  const done = onSaved;
  close();
  done?.(res.folders);
});

els.dfCancel.addEventListener('click', close);
els.dfClose.addEventListener('click', close);
els.dfOverlay.addEventListener('click', (e) => {
  if (e.target === els.dfOverlay) close();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.dfOverlay.hidden) {
    e.stopPropagation();
    close();
  }
});
