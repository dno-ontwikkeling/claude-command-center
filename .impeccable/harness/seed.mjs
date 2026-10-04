// Seeds the preview harness with realistic agents across projects and
// workspaces, drives their states through the real code paths (spawn,
// onData, onEvent, forceStatus) and selects one.
import { spawn, activate, forceStatus } from '/renderer/agents.js';
import { dormant, notifyAgentsChanged } from '/renderer/state.js';

const P = 'C:/dev/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(300); // let app.js finish its first render

window.__branches = {};
window.__diffs = {};
const AGENTS = [
  // dir, cwd suffix, branch, customLabel, state, diff
  ['claude-command-center', '', 'main', null, 'busy', { added: 214, removed: 12 }],
  ['claude-command-center', '.wt/phone-dialogs', 'feat/phone-dialogs', null, 'needs-input', { added: 38, removed: 4 }],
  ['claude-command-center', '.wt/qr', 'feat/settings-qr', 'Settings QR review', 'unseen', null],
  ['memorybank', '', 'main', null, 'busy', { added: 91, removed: 40 }],
  ['memorybank', '.wt/recall', 'feat/recall-filters', null, 'idle', null],
  ['spendsense', '', 'main', null, 'rate-limited', { added: 3, removed: 0 }],
  ['forthly', '', 'main', null, 'idle', null],
  ['forthly', '.wt/ledger', 'fix/ledger-rounding', null, 'done', null],
  ['dno-platform', '', null, 'Cross-repo auth refactor', 'busy', null],
  ['dno-platform', '/chore', null, 'chore/deps', 'error', null],
  ['homeserver', '', null, 'Jellyfin scripts', 'idle', null],
];

const ids = [];
for (const [i, [proj, suffix, branch, custom, , diff]] of AGENTS.entries()) {
  const dir = P + proj;
  const cwd = dir + (suffix ? '/' + suffix : '');
  if (branch) window.__branches[cwd] = branch;
  if (diff) window.__diffs[cwd] = diff;
  const id = spawn(dir, cwd, branch, !suffix, custom ? { id: `h${i}`, customLabel: custom, label: custom, order: i } : { id: `h${i}`, label: `Session ${i}`, order: i }, { background: true });
  ids.push(id);
}

// A sleeping (dormant) session under claude-command-center.
dormant.set('d1', { id: 'd1', dir: P + 'claude-command-center', cwd: P + 'claude-command-center/.wt/scroll', branch: 'fix/scroll-replay', isMain: false, sessionId: 's', label: 'fix/scroll-replay' });

const TERM = [
  '\x1b[2m╭─ claude-command-center · main\x1b[0m',
  '',
  '\x1b[1m> Make the remote settings tab show the pairing QR and connected devices\x1b[0m',
  '',
  '\x1b[37m●\x1b[0m I\'ll read the current settings panel and the remote server status API first.',
  '',
  '  \x1b[2mRead(renderer/settings.js)\x1b[0m  ⎿ 412 lines',
  '  \x1b[2mRead(remoteserver.js)\x1b[0m       ⎿ 286 lines',
  '  \x1b[2mGrep("listenStatus")\x1b[0m        ⎿ 6 matches in 3 files',
  '',
  '\x1b[37m●\x1b[0m The server already emits listen status over IPC. I\'ll add a devices list',
  '  and a Disconnect all action, then render the QR from the pairing token.',
  '',
  '  \x1b[2mUpdate(renderer/settings.js)\x1b[0m',
  '  \x1b[32m+ 214 │   renderPairing(qrEl, status.pairingUrl);\x1b[0m',
  '  \x1b[32m+ 215 │   renderDevices(listEl, status.clients);\x1b[0m',
  '  \x1b[31m- 216 │   // TODO: pairing\x1b[0m',
  '',
  '  \x1b[2mBash(npm test)\x1b[0m',
  '  \x1b[32m⎿ ✔ 148 passing (2.1s)\x1b[0m',
  '',
  '\x1b[33mwarning\x1b[0m: \x1b[36mrenderer/settings.js\x1b[0m has \x1b[35m2\x1b[0m unused imports \x1b[34m(info)\x1b[0m',
  '',
  '\x1b[36m✻ Thinking… (14s · esc to interrupt)\x1b[0m',
].join('\r\n');
await wait(200);
window.__h.onData?.({ id: ids[0], data: TERM });

await wait(100);
AGENTS.forEach(([, , , , st], i) => {
  if (st === 'needs-input') {
    window.__h.onEvent?.({ agentId: ids[i], status: 'needs-input', message: 'Claude needs your permission to use Bash' });
  } else {
    forceStatus(ids[i], st);
  }
});
notifyAgentsChanged();
activate(ids[0]);
document.documentElement.dataset.harnessReady = '1';
