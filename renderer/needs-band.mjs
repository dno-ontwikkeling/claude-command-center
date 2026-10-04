'use strict';

// Model for the yellow "Needs you" band at the top of the board. Pure (no DOM,
// no state.js import) so it can be unit-tested; sidebar.js renders it.

/** How many waiting agents the band shows before collapsing the rest to "+n". */
export const BAND_CAP = 3;

/**
 * @param {Iterable<[string, any]>} entries agentId -> agent
 * @param {(dir: string) => string | null} projectName name of the project/workspace owning `dir`
 * @returns {{ items: { id: string, label: string, project: string, message: string | null }[], more: number }}
 */
export function bandModel(entries, projectName) {
  const waiting = [...entries]
    .filter(([, a]) => a.status === 'needs-input')
    .sort(([, a], [, b]) => (a.needsSince ?? 0) - (b.needsSince ?? 0));
  const items = waiting.slice(0, BAND_CAP).map(([id, a]) => ({
    id,
    label: a.customLabel || a.branch || a.label,
    project: projectName(a.dir) ?? a.dir.split(/[\\/]/).filter(Boolean).pop(),
    message: a.blockMessage ?? null,
  }));
  return { items, more: waiting.length - items.length };
}
