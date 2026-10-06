// Pure helpers for the docs viewer panel: grouping and filtering the picker
// list, change detection for the poll, and the sandboxed iframe document.
// No DOM, no electron imports, so it can be unit-tested; docs-panel.js renders it.

/** Picker heading for a configured folder: '.' is the project root. */
export function folderLabel(folder) {
  return folder === '.' ? 'Root' : folder.charAt(0).toUpperCase() + folder.slice(1);
}

/**
 * @param {{ rel: string, folder: string, archived: boolean, mtimeMs: number, size: number }[]} list
 * @param {string[]} folders the project's configured folders, in display order
 * @returns {{ folder: string, archived: boolean, label: string, docs: typeof list }[]}
 *   one group per folder, its Archived group right after it, newest first, empty groups omitted
 */
export function groupDocs(list, folders) {
  const groups = [];
  for (const folder of folders) {
    for (const archived of [false, true]) {
      const docs = list
        .filter((d) => d.folder === folder && d.archived === archived)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      if (docs.length) groups.push({ folder, archived, label: archived ? 'Archived' : folderLabel(folder), docs });
    }
  }
  return groups;
}

/** The doc to open by default: the newest one that is not archived, or null. */
export function newestDoc(list) {
  let newest = null;
  for (const d of list) if (!d.archived && (!newest || d.mtimeMs > newest.mtimeMs)) newest = d;
  return newest;
}

/** Case-insensitive match on the file name only (not the folder). Blank query keeps everything. */
export function filterDocs(list, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((d) => d.rel.slice(d.rel.lastIndexOf('/') + 1).toLowerCase().includes(q));
}

/** Changes whenever a file is added, removed, renamed, archived, modified or resized. */
export function docsSignature(list) {
  return list.map((d) => `${d.rel}|${d.archived}|${d.mtimeMs}|${d.size}`).join('\n');
}

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

const BASE_CSS = `
html { background: var(--bg); color: var(--fg); }
body {
  margin: 0 auto;
  max-width: 78ch;
  padding: 20px 24px 48px;
  background: var(--bg);
  color: var(--fg);
  font: 14px/1.6 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
  overflow-wrap: anywhere;
}
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 0.5em; font-weight: 600; }
h1 { font-size: 1.7em; margin-top: 0; padding-bottom: 0.3em; border-bottom: 1px solid var(--border); }
h2 { font-size: 1.35em; padding-bottom: 0.25em; border-bottom: 1px solid var(--border); }
h3 { font-size: 1.15em; }
h4, h5, h6 { font-size: 1em; }
p, ul, ol, blockquote, table, pre { margin: 0 0 1em; }
ul, ol { padding-left: 1.6em; }
a { color: var(--select); text-decoration: none; }
a:hover { text-decoration: underline; }
hr { border: 0; border-top: 1px solid var(--border); margin: 1.5em 0; }
blockquote { padding: 0 1em; color: var(--muted); border-left: 3px solid var(--border); }
code, pre { font-family: 'Cascadia Mono', Consolas, monospace; font-size: 0.9em; }
code { background: var(--elevated); padding: 0.15em 0.35em; border-radius: 4px; }
pre { background: var(--elevated); border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px; overflow-x: auto; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--border); padding: 6px 12px; text-align: left; }
th { background: var(--elevated); font-weight: 600; }
img { max-width: 100%; }
ins { color: var(--add); }
del { color: var(--del); }
`;

/** A token is a custom property name with a value that cannot leave its declaration. */
function rootDeclarations(tokens) {
  return Object.entries(tokens ?? {})
    .filter(([name, value]) => /^--[a-z0-9-]+$/.test(name) && typeof value === 'string')
    .filter(([, value]) => !/[<>{};\r\n]/.test(value))
    .map(([name, value]) => `${name}: ${value.trim()};`)
    .join(' ');
}

/**
 * Full document for the sandboxed iframe's srcdoc. The body html is placed as-is.
 * @param {string} html rendered document body
 * @param {Record<string, string>} tokens theme CSS variables, e.g. { '--bg': '#fff' }
 */
export function buildFrame(html, tokens) {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `<base target="_blank">` +
    `<style>:root { ${rootDeclarations(tokens)} }${BASE_CSS}</style>` +
    `</head><body>${html}</body></html>`
  );
}
