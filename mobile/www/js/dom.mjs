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
