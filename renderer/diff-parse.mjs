'use strict';

// ---------------------------------------------------------------------------
// Unified-diff parser. Pure string logic (no DOM), extracted from diff.js so it
// can be unit tested under `node --test` (see test/diffparse.test.mjs). Turns
// `git diff` text into structured files -> hunks -> lines for the viewer.
// ---------------------------------------------------------------------------

export function stripPrefix(p) {
  return p.startsWith('a/') || p.startsWith('b/') ? p.slice(2) : p;
}

export function parseDiff(text) {
  const files = [];
  let file = null;
  let hunk = null;

  for (const raw of String(text).split('\n')) {
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
