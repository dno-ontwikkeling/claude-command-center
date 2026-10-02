// Pure view-model helpers for the git screen (unit tested; no DOM). Input
// diffs come from the desktop's shared parser (vendor/diff-parse.mjs).

export function statSummary(stat) {
  if (!stat || (!stat.added && !stat.removed)) return 'No uncommitted changes';
  return `+${stat.added} −${stat.removed}`;
}

const LETTER = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' };

export function fileRows(files) {
  return files
    .map((f) => {
      const i = f.path.lastIndexOf('/');
      return {
        path: f.path,
        name: i === -1 ? f.path : f.path.slice(i + 1),
        folder: i === -1 ? '' : f.path.slice(0, i),
        letter: LETTER[f.status] || 'M',
        status: f.status,
        added: f.added,
        removed: f.removed,
        binary: f.binary,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
}

const firstLine = (s) => String(s || '').split(/\r?\n/).find((l) => l.trim())?.trim() || '';

// Fetch/Pull result (desktop runGit: { ok, out?, error? }) -> toast.
export function opToast(op, result) {
  const label = op === 'pull' ? 'Pull' : 'Fetch';
  if (result && result.ok) return { kind: 'ok', text: firstLine(result.out) || `${label}ed.` };
  return { kind: 'error', text: firstLine(result && result.error) || `${label} failed.` };
}

// Keep whole files until the rendered line budget is spent (a huge diff would
// stall a phone WebView). The first file is always kept.
export function limitDiff(files, maxLines = 3000) {
  const out = [];
  let used = 0;
  for (const f of files) {
    const n = f.hunks.reduce((sum, h) => sum + h.lines.length, 0);
    if (out.length && used + n > maxLines) return { files: out, truncated: true };
    out.push(f);
    used += n;
  }
  return { files: out, truncated: false };
}
