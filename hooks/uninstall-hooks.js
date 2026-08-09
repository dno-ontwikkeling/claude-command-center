'use strict';

// Removes Command Center's status hooks from the shared Claude CLI config
// (~/.claude/settings.json) — the inverse of main.js's ensureHooksInstalled.
// Run by the NSIS uninstaller (see build/uninstaller.nsh) so uninstalling the
// app doesn't leave an orphaned hook pointing at a deleted report.js, which
// would make every future Claude Code session throw "Cannot find module".
//
// Matching: by this install's own resolved report.js path (the sibling of this
// script), so we only ever strip entries this exact install wrote — never
// another install's hooks, nor an unrelated tool's report.js. Pass `--all` to
// also strip any Command Center hook regardless of location (dev/build/older
// installs), used for a full manual cleanup.

const fs = require('fs');
const os = require('os');
const path = require('path');

// Sibling report.js — the exact path this install registers in settings.json.
const REPORT_SCRIPT = path.join(__dirname, 'report.js');

const stripAll = process.argv.includes('--all');

function isOurs(command) {
  if (typeof command !== 'string' || !command.includes('report.js')) return false;
  if (stripAll) {
    return command.includes('claude-command-center') || command.includes('Command Center');
  }
  return command.includes(REPORT_SCRIPT);
}

function main() {
  const file = path.join(os.homedir(), '.claude', 'settings.json');

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return 0; // no settings file -> nothing to clean
  }

  let settings;
  try {
    settings = JSON.parse(raw);
  } catch {
    // Corrupt/unparseable — never risk clobbering the user's real config.
    return 0;
  }

  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object') return 0;

  let removed = 0;
  for (const event of Object.keys(hooks)) {
    const arr = hooks[event];
    if (!Array.isArray(arr)) continue;
    const kept = arr.filter((entry) => {
      const ours = (entry.hooks || []).some((h) => isOurs(h.command));
      if (ours) removed++;
      return !ours;
    });
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;

  if (removed > 0) {
    // Backup before writing, mirroring the app's own settings-write safety.
    try {
      fs.writeFileSync(`${file}.bak-${Date.now()}`, raw);
    } catch {
      /* best-effort backup */
    }
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
    fs.renameSync(tmp, file);
  }
  return removed;
}

try {
  main();
} catch {
  // Uninstall must never fail because of hook cleanup.
}
process.exit(0);
