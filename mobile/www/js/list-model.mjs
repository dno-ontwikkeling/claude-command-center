// Pure view-model helpers for the agent list (unit tested; no DOM).

export function dirName(dir) {
  const parts = String(dir).split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || String(dir);
}

// [{ dir, name, live: [...], dormant: [...], needsInput }] in first-seen order,
// with groups that have an agent waiting for input moved to the top.
export function groupAgents(list) {
  const byDir = new Map();
  for (const a of list) {
    let g = byDir.get(a.dir);
    if (!g) {
      g = { dir: a.dir, name: dirName(a.dir), live: [], dormant: [], needsInput: false };
      byDir.set(a.dir, g);
    }
    (a.dormant ? g.dormant : g.live).push(a);
    if (!a.dormant && a.status === 'needs-input') g.needsInput = true;
  }
  const groups = [...byDir.values()];
  return [...groups.filter((g) => g.needsInput), ...groups.filter((g) => !g.needsInput)];
}

// null when all is well; else { kind, text, action? }.
export function bannerFor(linkState, desktopUi) {
  switch (linkState) {
    case 'connected':
      return desktopUi ? null : { kind: 'warn', text: 'Desktop window unavailable — showing the last known list.' };
    case 'connecting':
      return { kind: 'warn', text: 'Connecting to PC…' };
    case 'offline':
      return { kind: 'warn', text: 'PC offline — reconnecting.' };
    case 'kicked':
      return { kind: 'error', text: 'Disconnected by the PC.', action: 'reconnect' };
    default:
      return { kind: 'error', text: 'Not connected.', action: 'reconnect' };
  }
}

const STATUS_TEXT = {
  busy: 'Working',
  idle: 'Idle',
  'needs-input': 'Needs input',
  done: 'Done',
  unseen: 'Done',
  error: 'Error',
  dead: 'Ended',
  'rate-limited': 'Rate limited',
};

export const statusText = (s) => STATUS_TEXT[s] || s;

// Where a new agent for `project` can run: its main worktree first, then the rest.
export function spawnTargets(project, worktrees) {
  if (!worktrees || !worktrees.length) return [{ label: dirName(project.dir), cwd: project.dir, dir: project.dir }];
  const sorted = [...worktrees].sort((a, b) => Number(!!b.isMain) - Number(!!a.isMain));
  return sorted.map((w) => ({ label: w.branch || dirName(w.path), cwd: w.path, dir: project.dir }));
}

// Rough cols/rows for a monospace font before any terminal exists (used to
// size a phone-spawned pty from the start). The terminal screen refines it.
export function estimateTermSize(width, height, fontSize) {
  const clamp = (n) => Math.min(500, Math.max(2, Math.floor(n)));
  return { cols: clamp(width / (fontSize * 0.6)), rows: clamp(height / (fontSize * 1.2)) };
}

export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'closed', label: 'Closed' },
];

/** 'active' = running agents, 'closed' = resumable sessions; anything else = all. */
export function filterAgents(list, filter) {
  if (filter === 'active') return list.filter((a) => !a.dormant);
  if (filter === 'closed') return list.filter((a) => a.dormant);
  return list;
}

/** The row menu, same entries as the desktop sidebar's kebab menus. */
export function agentActions(a) {
  if (a.dormant) {
    return [
      { id: 'resume', label: 'Resume' },
      { id: 'forget', label: 'Forget session', danger: true },
    ];
  }
  return [
    { id: 'rename', label: 'Rename' },
    // Only a separate worktree has a folder of its own to delete.
    ...(a.isMain === false ? [{ id: 'deleteWorktree', label: 'Delete worktree', danger: true }] : []),
    { id: 'close', label: 'Close', danger: true },
  ];
}
