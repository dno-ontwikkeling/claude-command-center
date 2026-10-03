// Children as h() takes them: nested arrays flattened, null/false skipped.
function nodes(children) {
  return children
    .flat(Infinity)
    .filter((c) => c != null && c !== false)
    .map((c) => (c instanceof Node ? c : String(c)));
}

/** Replace el's children (unlike el.replaceChildren, arrays and null are handled). */
export function fill(el, ...children) {
  el.replaceChildren(...nodes(children));
}

// Attributes that tell the keyboard not to suggest, autocorrect or capitalize
// (a terminal and paths/names don't want any of it). String values: h() skips
// a plain `false`.
export const NO_SUGGESTIONS = { autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false' };

/** Apply NO_SUGGESTIONS to an existing element (e.g. xterm's hidden textarea). */
export function noSuggestions(el) {
  for (const [k, v] of Object.entries(NO_SUGGESTIONS)) el.setAttribute(k, v);
  return el;
}

// Tiny DOM helper: h('button', { class: 'x', onclick }, 'text', child...).
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  el.append(...nodes(children));
  return el;
}
