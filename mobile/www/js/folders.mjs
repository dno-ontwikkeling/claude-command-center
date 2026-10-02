// Folder browser on the PC (rpc 'fs.list'), shown inside a bottom sheet. It
// stands in for the desktop's native folder picker in Add project / New
// workspace. Folders only.
import { ctx } from './core.mjs';
import { h, fill } from './dom.mjs';

/**
 * Renders into `sheet` and resolves with the chosen folder path, or null when
 * the user backs out at the top level.
 */
export function browseFolders(sheet, { title, actionLabel }) {
  return new Promise((resolve) => {
    let current = null; // null = the starting points (home + drives)

    async function open(path) {
      fill(sheet, h('h2', {}, title), h('p', { class: 'muted' }, 'Loading…'));
      let res;
      try {
        res = await ctx.rpc.call('fs.list', path ? { path } : {});
      } catch (err) {
        fill(
          sheet,
          h('h2', {}, title),
          h('p', { class: 'warn' }, (err && err.message) || String(err)),
          h('button', { onclick: () => open(current) }, 'Back'),
        );
        return;
      }
      current = res.path;
      const entries = res.path
        ? res.dirs.map((name) => ({ label: name, path: joinPath(res.path, name) }))
        : res.dirs.map((p) => ({ label: p, path: p }));
      fill(
        sheet,
        h('h2', {}, title),
        h('p', { class: 'muted folder-path' }, res.path || 'Choose a starting point'),
        h(
          'div',
          { class: 'row' },
          res.path
            ? h('button', { class: 'small', onclick: () => open(res.parent) }, '‹ Up')
            : h('button', { class: 'small', onclick: () => resolve(null) }, 'Cancel'),
          res.path ? h('button', { class: 'small primary', onclick: () => resolve(res.path) }, actionLabel) : null,
        ),
        entries.length
          ? h(
              'ul',
              { class: 'pick' },
              entries.map((e) => h('li', {}, h('button', { onclick: () => open(e.path) }, `📁 ${e.label}`))),
            )
          : h('p', { class: 'muted' }, 'No subfolders.'),
      );
    }

    open(null);
  });
}

// The PC's separator, taken from the path itself.
function joinPath(dir, name) {
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}
