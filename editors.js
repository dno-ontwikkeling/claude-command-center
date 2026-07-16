'use strict';

// ---------------------------------------------------------------------------
// External editor launchers (Visual Studio, VS Code). Electron-free (execFile /
// fs / path only), split out of main.js. Each returns { ok } or { error }.
// Explorer is a one-liner on electron's shell, so it stays in main.js.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { errMsg } = require('./util');

// Locate devenv.exe via vswhere (ships with every VS 2017+ installer). Returns
// null when neither vswhere nor a VS install is present.
function resolveDevenv() {
  return new Promise((resolve) => {
    const pf = process.env['ProgramFiles(x86)'] || process.env.ProgramFiles || 'C:\\Program Files (x86)';
    const vswhere = path.join(pf, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    if (!fs.existsSync(vswhere)) {
      resolve(null);
      return;
    }
    execFile(vswhere, ['-latest', '-prerelease', '-property', 'productPath'], (err, stdout) => {
      const p = (stdout || '').trim();
      resolve(!err && p && fs.existsSync(p) ? p : null);
    });
  });
}

// Open a worktree in Visual Studio. Prefer a top-level .sln (single match opens
// directly; multiple -> open the folder so the user picks). Windows only.
async function openInVisualStudio(cwd) {
  if (process.platform !== 'win32') {
    return { error: 'Visual Studio is only available on Windows.' };
  }
  const devenv = await resolveDevenv();
  if (!devenv) {
    return { error: 'Visual Studio not found (vswhere reported no install).' };
  }
  let target = cwd;
  try {
    const slns = fs.readdirSync(cwd).filter((f) => f.toLowerCase().endsWith('.sln'));
    if (slns.length === 1) target = path.join(cwd, slns[0]);
  } catch {
    /* unreadable dir — fall back to opening cwd */
  }
  return new Promise((resolve) => {
    // detached so VS outlives this app; unref so we don't hold the child.
    const child = execFile(devenv, [target], (err) => {
      if (err) resolve({ error: errMsg(err).trim() });
    });
    child.on('spawn', () => resolve({ ok: true }));
    child.on('error', (err) => resolve({ error: errMsg(err).trim() }));
    child.unref();
  });
}

// Resolve the `code` CLI's real path once and cache it. Never route the launch
// through a shell (the old shell:true fed a git-branch-derived path to cmd.exe,
// allowing command injection via metacharacters in a hostile branch name).
//   undefined = not resolved yet, null = looked up but not found, string = path.
let vscodeCliPath;

function resolveVSCode() {
  return new Promise((resolve) => {
    if (vscodeCliPath !== undefined) {
      resolve(vscodeCliPath);
      return;
    }
    const finder = process.platform === 'win32' ? 'where' : 'which';
    execFile(finder, ['code'], { windowsHide: true }, (err, stdout) => {
      const first = (stdout || '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)[0];
      vscodeCliPath = !err && first ? first : null;
      resolve(vscodeCliPath);
    });
  });
}

// Open a worktree in VS Code via the resolved `code` CLI. On Windows `code` is
// the code.cmd shim which must run through cmd.exe. cmd re-parses its command
// line, so an UNQUOTED metacharacter (& | ^ …) in the path would be treated as
// a command separator — real injection, since the target IS cmd.exe. libuv only
// auto-quotes args containing whitespace/quotes, so we must quote explicitly and
// pass the line verbatim (windowsVerbatimArguments) using cmd's `/s` convention
// (outer quotes stripped, the rest taken literally). A path containing a literal
// `"` cannot be safely quoted, so we refuse it. This keeps legitimate paths
// (e.g. a folder named "R&D") working while making metacharacters inert.
async function openInVSCode(cwd) {
  const code = await resolveVSCode();
  if (!code) {
    return {
      error:
        "VS Code CLI (`code`) not found on PATH. In VS Code run: Shell Command: Install 'code' command in PATH.",
    };
  }
  if (process.platform === 'win32') {
    if (String(cwd).includes('"') || String(code).includes('"')) {
      return { error: 'Path contains an unsupported character (") and cannot be opened.' };
    }
    const comspec = process.env.ComSpec || 'cmd.exe';
    const line = `""${code}" "${cwd}""`;
    return new Promise((resolve) => {
      execFile(
        comspec,
        ['/d', '/s', '/c', line],
        { shell: false, windowsHide: true, windowsVerbatimArguments: true },
        (err, _stdout, stderr) => {
          if (err) resolve({ error: (stderr || '').trim() || errMsg(err).trim() });
          else resolve({ ok: true });
        }
      );
    });
  }
  return new Promise((resolve) => {
    execFile(code, [cwd], { shell: false, windowsHide: true }, (err, _stdout, stderr) => {
      if (err) resolve({ error: (stderr || '').trim() || errMsg(err).trim() });
      else resolve({ ok: true });
    });
  });
}

module.exports = { openInVisualStudio, openInVSCode };
