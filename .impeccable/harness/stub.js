// Fake preload API for the preview harness. Event subscriptions are captured
// in window.__h so seed.mjs can push data/events like main would.
(() => {
  const theme = new URLSearchParams(location.search).get('theme') || 'dark';
  localStorage.clear();
  localStorage.setItem('settings', JSON.stringify({ theme }));
  window.__h = {};
  const DIFF = "diff --git a/renderer/settings.js b/renderer/settings.js\nindex 3f2a1c4..9b8e7d2 100644\n--- a/renderer/settings.js\n+++ b/renderer/settings.js\n@@ -208,12 +208,16 @@ function renderRemote(cfg) {\n   const status = cfg.status || {};\n   els.setRemoteStatus.textContent = statusText(cfg);\n   els.setRemoteStatus.classList.toggle('is-error', !!status.error);\n-  // TODO: pairing\n+  renderPairing(qrEl, status.pairingUrl);\n+  renderDevices(listEl, status.clients);\n   els.setRemotePort.value = cfg.port;\n   els.setRemoteBind.value = cfg.bindHost;\n+  els.setRemoteHost.value = cfg.host || '';\n }\n \n-function statusText(cfg) {\n+export function statusText(cfg) {\n   if (!cfg.enabled) return 'Off';\ndiff --git a/remoteserver.js b/remoteserver.js\nindex 11aa22b..33cc44d 100644\n--- a/remoteserver.js\n+++ b/remoteserver.js\n@@ -40,6 +40,9 @@ export function createRemoteServer(opts) {\n   const clients = new Set();\n+  function listClients() {\n+    return [...clients].map((c) => ({ ip: c.ip, since: c.since }));\n+  }\n   return { start, stop };\n }\n";
  const P = 'C:/dev/';
  // Fold one project and one workspace to show the collapsed form.
  localStorage.setItem('collapsedProjects', JSON.stringify([P + 'forthly', P + 'homeserver']));
  const projects = [
    { dir: P + 'claude-command-center', name: 'claude-command-center', isGit: true, type: 'node' },
    { dir: P + 'memorybank', name: 'memorybank', isGit: true, type: 'dotnet' },
    { dir: P + 'spendsense', name: 'spendsense', isGit: true, type: 'python' },
    { dir: P + 'forthly', name: 'forthly', isGit: true, type: 'dotnet' },
  ];
  const workspaces = [
    { dir: P + 'dno-platform', name: 'dno-platform', isGit: false },
    { dir: P + 'homeserver', name: 'homeserver', isGit: false },
  ];
  const fake = {
    listProjects: async () => projects,
    listWorkspaces: async () => workspaces,
    gitBranch: async (cwd) => (window.__branches || {})[cwd] || null,
    gitDiffStat: async (cwd) => (window.__diffs || {})[cwd] || null,
    getRemoteConfig: async () => ({ enabled: true, status: 'listening', port: 7443, bindHost: '0.0.0.0', advertisedHost: '', effectiveHost: '100.64.0.7', push: { configured: true, projectId: 'cc-push', phoneRegistered: true }, hosts: [], hostOptions: [{ value: '100.64.0.7', label: 'Tailscale 100.64.0.7' }], clients: [] }),
    getRemotePairing: async () => null,
    gitDiff: async () => ({ ok: true, base: 'origin/main', diff: DIFF }),
    listWorktrees: async (dir) => [
      { path: dir, branch: 'main', isMain: true, dirty: 3, ahead: 2, behind: 0 },
      { path: dir + '/.wt/phone-dialogs', branch: 'feat/phone-dialogs', isMain: false, dirty: 0, ahead: 0, behind: 1 },
    ],
    listBranches: async () => ({
      current: 'main',
      local: [{ name: 'main' }, { name: 'feat/phone-dialogs' }, { name: 'fix/scroll-replay' }],
      remote: [{ name: 'origin/feat/fcm-push' }],
    }),
  };
  window.api = new Proxy(fake, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string' && k.startsWith('on')) return (cb) => (window.__h[k] = cb);
      return async () => null;
    },
  });
})();
