'use strict';

import { els } from './dom.js';
import { state, agents } from './state.js';

// ---------------------------------------------------------------------------
// GitKraken-style diff viewer. Opens from the stage toolbar for the active
// worktree. Two modes: "wip" (uncommitted vs HEAD) and "branch" (this branch
// vs its base). Left = file list, right = stacked unified diffs.
// ---------------------------------------------------------------------------

let mode = 'wip';
let activeCwd = null; // guards against a stale async load landing after a switch
let fileView = localStorage.getItem('diffFileView') === 'tree' ? 'tree' : 'flat';
let currentFiles = []; // last parsed diff, so the view toggle re-renders without a git call

function activeAgent() {
  return (state.activeId && agents.get(state.activeId)) || null;
}

export async function openDiff() {
  const a = activeAgent();
  if (!a || !a.branch) return; // git actions only make sense on a real branch
  activeCwd = a.cwd;
  mode = 'wip';
  applyLeftWidth();
  updateTabs();
  updateViewTabs();
  els.diffViewer.hidden = false;
  await load();
}

function close() {
  els.diffViewer.hidden = true;
  activeCwd = null;
}

function switchMode(next) {
  if (next === mode) return;
  mode = next;
  updateTabs();
  load();
}

function updateTabs() {
  els.diffModeWip.classList.toggle('active', mode === 'wip');
  els.diffModeBranch.classList.toggle('active', mode === 'branch');
}

function showMessage(text) {
  els.diffContent.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'diff-empty';
  div.textContent = text;
  els.diffContent.appendChild(div);
}

async function load() {
  const cwd = activeCwd;
  if (!cwd) return;
  const requestedMode = mode;

  const a = activeAgent();
  els.diffTitle.textContent = a && a.branch ? `⎇ ${a.branch}` : 'Diff';
  els.diffSub.textContent = '';
  els.diffFiles.innerHTML = '';
  showMessage('Loading…');

  const res = await window.api.gitDiff(cwd, requestedMode);
  // The user may have closed the viewer, switched worktree, or switched mode while git ran.
  if (els.diffViewer.hidden || cwd !== activeCwd || requestedMode !== mode) return;

  els.diffSub.textContent =
    requestedMode === 'branch' ? (res.base ? `vs ${res.base}` : '') : 'uncommitted vs HEAD';

  if (!res.ok) {
    showMessage(res.error || 'git reported an error.');
    return;
  }

  currentFiles = parseDiff(res.diff);
  if (!currentFiles.length) {
    showMessage(requestedMode === 'branch' ? 'No differences from the base branch.' : 'No uncommitted changes.');
    return;
  }
  renderFiles(currentFiles);
}

function updateViewTabs() {
  els.diffViewFlat.classList.toggle('active', fileView === 'flat');
  els.diffViewTree.classList.toggle('active', fileView === 'tree');
}

function setView(next) {
  if (next === fileView) return;
  fileView = next;
  localStorage.setItem('diffFileView', next);
  updateViewTabs();
  if (currentFiles.length) renderNav(currentFiles);
}

// ---------------------------------------------------------------------------
// Unified-diff parser -> [{ path, oldPath, status, binary, added, removed,
//                            hunks: [{ oldNo, newNo, header, lines: [{type,text}] }] }]
// ---------------------------------------------------------------------------

function stripPrefix(p) {
  return p.startsWith('a/') || p.startsWith('b/') ? p.slice(2) : p;
}

function parseDiff(text) {
  const files = [];
  let file = null;
  let hunk = null;

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');

    if (line.startsWith('diff --git')) {
      const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      file = {
        path: m ? m[2] : '',
        oldPath: m ? m[1] : null,
        status: 'modified',
        binary: false,
        added: 0,
        removed: 0,
        hunks: [],
      };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;

    if (line.startsWith('new file')) file.status = 'added';
    else if (line.startsWith('deleted file')) file.status = 'deleted';
    else if (line.startsWith('rename from')) {
      file.oldPath = line.slice('rename from '.length);
      file.status = 'renamed';
    } else if (line.startsWith('rename to')) {
      file.path = line.slice('rename to '.length);
      file.status = 'renamed';
    } else if (line.startsWith('Binary files')) file.binary = true;
    else if (line.startsWith('--- ')) {
      const p = line.slice(4);
      if (p !== '/dev/null') file.oldPath = stripPrefix(p);
    } else if (line.startsWith('+++ ')) {
      const p = line.slice(4);
      if (p !== '/dev/null') file.path = stripPrefix(p);
    } else if (line.startsWith('@@')) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      hunk = { oldNo: m ? +m[1] : 0, newNo: m ? +m[2] : 0, header: m ? m[3].trim() : '', lines: [] };
      file.hunks.push(hunk);
    } else if (hunk) {
      const t = line[0];
      if (t === '+') {
        file.added++;
        hunk.lines.push({ type: 'add', text: line.slice(1) });
      } else if (t === '-') {
        file.removed++;
        hunk.lines.push({ type: 'del', text: line.slice(1) });
      } else if (t === ' ') {
        hunk.lines.push({ type: 'ctx', text: line.slice(1) });
      }
      // '\' (no newline at EOF) and blank trailing lines are ignored.
    }
  }

  for (const f of files) if (!f.path && f.oldPath) f.path = f.oldPath;
  return files;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const STATUS_MARK = { added: 'A', deleted: 'D', renamed: 'R', modified: 'M' };

function statCounts(f) {
  const wrap = document.createElement('span');
  wrap.className = 'diff-stat';
  if (f.added) {
    const a = document.createElement('span');
    a.className = 'add';
    a.textContent = `+${f.added}`;
    wrap.appendChild(a);
  }
  if (f.removed) {
    const d = document.createElement('span');
    d.className = 'del';
    d.textContent = `-${f.removed}`;
    wrap.appendChild(d);
  }
  return wrap;
}

function renderFiles(files) {
  els.diffContent.innerHTML = '';
  files.forEach((f, i) => els.diffContent.appendChild(buildSection(f, i)));
  renderNav(files);
}

// Left panel — flat list or a collapsible folder tree, per `fileView`.
function renderNav(files) {
  els.diffFiles.innerHTML = '';
  els.diffFiles.classList.toggle('tree', fileView === 'tree');
  if (fileView === 'tree') renderTree(files);
  else files.forEach((f, i) => els.diffFiles.appendChild(buildFileRow(f, i, filePath(f), 0, true)));
  els.diffFiles.querySelector('.diff-nav')?.classList.add('active');
}

function filePath(f) {
  return f.path || f.oldPath || '(unknown)';
}

// One clickable file entry, shared by both views. `label` is what's shown
// (full path in flat, basename in tree); `rtl` clips the long path from the left.
function buildFileRow(f, i, label, depth, rtl) {
  const li = document.createElement('li');
  li.className = 'diff-nav';
  if (depth) li.style.paddingLeft = `${depth * 12 + 6}px`;

  const mark = document.createElement('span');
  mark.className = `diff-mark ${f.status}`;
  mark.textContent = STATUS_MARK[f.status] || 'M';

  const name = document.createElement('span');
  name.className = 'diff-nav-path';
  if (rtl) name.classList.add('rtl');
  name.textContent = label;
  name.title = f.status === 'renamed' && f.oldPath ? `${f.oldPath} → ${f.path}` : filePath(f);

  li.append(mark, name, statCounts(f));
  li.addEventListener('click', () => {
    document.getElementById(`diff-file-${i}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    for (const el of els.diffFiles.querySelectorAll('.diff-nav')) el.classList.remove('active');
    li.classList.add('active');
  });
  return li;
}

// ---- tree view -----------------------------------------------------------

// Build a nested { dirs: Map, files: [] } tree keyed on the path segments.
function buildTree(files) {
  const root = { dirs: new Map(), files: [] };
  files.forEach((f, i) => {
    const parts = filePath(f).split('/');
    const name = parts.pop();
    let node = root;
    for (const part of parts) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }
    node.files.push({ f, i, name });
  });
  return root;
}

function renderTree(files) {
  fillTree(els.diffFiles, buildTree(files), 0);
}

function fillTree(ul, node, depth) {
  for (const [name, child] of [...node.dirs].sort((a, b) => a[0].localeCompare(b[0]))) {
    const li = document.createElement('li');
    li.className = 'diff-tree-dir';

    const head = document.createElement('div');
    head.className = 'diff-tree-dirhead';
    head.style.paddingLeft = `${depth * 12 + 6}px`;
    const chev = document.createElement('span');
    chev.className = 'diff-chev';
    chev.textContent = '▾';
    const nm = document.createElement('span');
    nm.className = 'diff-dirname';
    nm.textContent = name;
    head.append(chev, nm);

    const childUl = document.createElement('ul');
    childUl.className = 'diff-tree-children';
    fillTree(childUl, child, depth + 1);

    head.addEventListener('click', () => {
      const collapsed = li.classList.toggle('collapsed');
      chev.textContent = collapsed ? '▸' : '▾';
    });

    li.append(head, childUl);
    ul.appendChild(li);
  }
  for (const { f, i, name } of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
    ul.appendChild(buildFileRow(f, i, name, depth, false));
  }
}

function buildSection(f, i) {
  const sec = document.createElement('section');
  sec.className = 'diff-file';
  sec.id = `diff-file-${i}`;

  const head = document.createElement('div');
  head.className = 'diff-file-head';
  const path = document.createElement('span');
  path.className = 'diff-file-path';
  path.textContent =
    f.status === 'renamed' && f.oldPath ? `${f.oldPath} → ${f.path}` : f.path || f.oldPath || '(unknown)';
  head.append(path, statCounts(f));
  sec.appendChild(head);

  if (f.binary) {
    const note = document.createElement('div');
    note.className = 'diff-note';
    note.textContent = 'Binary file — no textual diff.';
    sec.appendChild(note);
    return sec;
  }
  if (!f.hunks.length) {
    const note = document.createElement('div');
    note.className = 'diff-note';
    note.textContent = f.status === 'renamed' ? 'Renamed with no content change.' : 'No line changes.';
    sec.appendChild(note);
    return sec;
  }

  const body = document.createElement('div');
  body.className = 'diff-lines';
  for (const h of f.hunks) appendHunk(body, h);
  sec.appendChild(body);
  return sec;
}

function appendHunk(body, hunk) {
  const head = document.createElement('div');
  head.className = 'diff-hunk-head';
  const span = document.createElement('span');
  span.className = 'code';
  span.textContent = `@@ ${hunk.header}`.trim();
  head.appendChild(span);
  body.appendChild(head);

  let oldNo = hunk.oldNo;
  let newNo = hunk.newNo;
  for (const ln of hunk.lines) {
    const row = document.createElement('div');
    row.className = `diff-line ${ln.type}`;

    const oldCell = document.createElement('span');
    oldCell.className = 'ln';
    const newCell = document.createElement('span');
    newCell.className = 'ln';

    if (ln.type === 'ctx') {
      oldCell.textContent = oldNo++;
      newCell.textContent = newNo++;
    } else if (ln.type === 'add') {
      newCell.textContent = newNo++;
    } else {
      oldCell.textContent = oldNo++;
    }

    const sign = document.createElement('span');
    sign.className = 'sign';
    sign.textContent = ln.type === 'add' ? '+' : ln.type === 'del' ? '-' : '';

    const code = document.createElement('span');
    code.className = 'code';
    code.textContent = ln.text;

    row.append(oldCell, newCell, sign, code);
    body.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

// ---- resizable file panel -------------------------------------------------

const LEFT_W_KEY = 'diffLeftW';

function applyLeftWidth() {
  const w = Number(localStorage.getItem(LEFT_W_KEY));
  if (w) els.diffBody.style.setProperty('--diff-left-w', `${w}px`);
}

let dragging = false;
els.diffSplitter.addEventListener('mousedown', (e) => {
  dragging = true;
  els.diffSplitter.classList.add('dragging');
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const r = els.diffBody.getBoundingClientRect();
  const w = Math.min(560, Math.max(140, e.clientX - r.left));
  els.diffBody.style.setProperty('--diff-left-w', `${w}px`);
});
window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  els.diffSplitter.classList.remove('dragging');
  const w = parseInt(getComputedStyle(els.diffBody).getPropertyValue('--diff-left-w'), 10);
  if (w) localStorage.setItem(LEFT_W_KEY, w);
});

els.sbDiff.addEventListener('click', openDiff);
els.diffClose.addEventListener('click', close);
els.diffRefresh.addEventListener('click', load);
els.diffModeWip.addEventListener('click', () => switchMode('wip'));
els.diffModeBranch.addEventListener('click', () => switchMode('branch'));
els.diffViewFlat.addEventListener('click', () => setView('flat'));
els.diffViewTree.addEventListener('click', () => setView('tree'));
els.diffViewer.addEventListener('click', (e) => {
  if (e.target === els.diffViewer) close();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.diffViewer.hidden) {
    e.preventDefault();
    close();
  }
});
