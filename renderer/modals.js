'use strict';

import { els } from './dom.js';

// ---------------------------------------------------------------------------
// Kebab dropdown menu
// ---------------------------------------------------------------------------

export function openMenu(anchor, items, opts = {}) {
  // Read the anchor rect before closeMenu — a submenu re-anchors to the same
  // (persistent) kebab button, but capturing first is cheap insurance.
  const r0 = anchor.getBoundingClientRect();
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  if (opts.className) menu.classList.add(opts.className);
  menu.id = 'kebab-menu';
  for (const it of items) {
    const b = document.createElement('button');
    if (it.icon) {
      // it.icon is trusted markup (a hardcoded <svg> literal from the
      // EDITORS table); it.label is not (can carry a repo/branch/user-
      // supplied name), so it must never be interpolated into innerHTML
      // alongside it. Build the icon as its own DOM node and set the label
      // via textContent instead.
      const iconEl = document.createElement('span');
      iconEl.innerHTML = it.icon;
      const labelEl = document.createElement('span');
      labelEl.textContent = it.label;
      b.append(iconEl, labelEl);
    } else {
      b.textContent = it.label;
    }
    if (it.danger) b.classList.add('danger');
    if (it.disabled) {
      b.disabled = true;
    } else if (it.submenu) {
      // Nested menu: reopen anchored to the original kebab (still in the DOM).
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        openMenu(anchor, it.submenu);
      });
    } else {
      b.addEventListener('click', () => {
        closeMenu();
        it.action();
      });
    }
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = r0;
  // Match the anchor's width so the menu sits flush beneath a button.
  if (opts.matchWidth) menu.style.minWidth = `${r.width}px`;
  // Flip above the anchor when there isn't room below (e.g. footer buttons).
  const below = r.bottom + 4;
  const top = below + menu.offsetHeight > window.innerHeight - 8 ? r.top - menu.offsetHeight - 4 : below;
  menu.style.top = `${Math.max(8, top)}px`;
  menu.style.left = `${Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)}px`;
}

export function closeMenu() {
  document.getElementById('kebab-menu')?.remove();
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#kebab-menu') && !e.target.classList.contains('kebab')) closeMenu();
});

// ---------------------------------------------------------------------------
// Text prompt modal (Electron renderer has no window.prompt)
// ---------------------------------------------------------------------------

// The overlay is a singleton: a second call before the first resolves would
// overwrite the shared handlers and strand the first Promise. Settle any
// pending dialog (as a cancel) before opening a new one so every caller's
// await resolves exactly once.
let pendingPromptDone = null;

// opts: { value, checkbox, checked }. Without `checkbox` this resolves the
// trimmed text (or null on cancel/empty) — the original contract. With
// `checkbox` (a label string) it resolves { text, checked } instead, or null
// on cancel, so a caller can collect a name plus a boolean in one dialog.
export function promptText(title, placeholder = '', opts = {}) {
  pendingPromptDone?.(null);
  return new Promise((resolve) => {
    const hasCheck = !!opts.checkbox;
    els.promptTitle.textContent = title;
    els.promptInput.value = opts.value || '';
    els.promptInput.placeholder = placeholder;
    els.promptCheckRow.hidden = !hasCheck;
    if (hasCheck) {
      els.promptCheckLabel.textContent = opts.checkbox;
      els.promptCheck.checked = !!opts.checked;
    }
    els.promptOverlay.hidden = false;
    els.promptInput.focus();
    els.promptInput.select();

    const done = (val) => {
      if (pendingPromptDone !== done) return;
      pendingPromptDone = null;
      els.promptOverlay.hidden = true;
      els.promptOk.onclick = null;
      els.promptCancel.onclick = null;
      els.promptInput.onkeydown = null;
      if (!hasCheck) return resolve(val);
      resolve(val === null ? null : { text: val, checked: els.promptCheck.checked });
    };
    pendingPromptDone = done;
    const submit = () => done(els.promptInput.value.trim() || null);
    els.promptOk.onclick = submit;
    els.promptCancel.onclick = () => done(null);
    els.promptInput.onkeydown = (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') done(null);
    };
  });
}

// title, message, { okLabel, danger, alert, checkbox } -> Promise<boolean>
// When `checkbox` (a label string) is given, resolves { ok, checked } instead.
let pendingConfirmDone = null;

export function confirmDialog(title, message, opts = {}) {
  // Same singleton-overlay reentrancy guard as promptText: settle any pending
  // dialog (as a cancel) so a superseded caller's Promise still resolves.
  pendingConfirmDone?.(false);
  return new Promise((resolve) => {
    els.confirmTitle.textContent = title;
    els.confirmMsg.textContent = message;
    els.confirmOk.textContent = opts.okLabel || 'OK';
    els.confirmOk.classList.toggle('danger', !!opts.danger);
    els.confirmCancel.style.display = opts.alert ? 'none' : '';

    const hasCheck = !!opts.checkbox;
    els.confirmCheckRow.hidden = !hasCheck;
    if (hasCheck) {
      els.confirmCheckLabel.textContent = opts.checkbox;
      els.confirmCheck.checked = false;
    }

    els.confirmOverlay.hidden = false;
    // For danger variants, default focus to Cancel so a stray/queued Enter
    // (common in a terminal-heavy UI) lands on the safe action rather than
    // the destructive one. Non-danger dialogs keep focusing OK.
    (opts.danger ? els.confirmCancel : els.confirmOk).focus();

    const done = (val) => {
      if (pendingConfirmDone !== done) return;
      pendingConfirmDone = null;
      els.confirmOverlay.hidden = true;
      els.confirmOk.onclick = null;
      els.confirmCancel.onclick = null;
      els.confirmX.onclick = null;
      els.confirmOverlay.onkeydown = null;
      resolve(hasCheck ? { ok: val, checked: els.confirmCheck.checked } : val);
    };
    pendingConfirmDone = done;
    els.confirmOk.onclick = () => done(true);
    els.confirmCancel.onclick = () => done(false);
    els.confirmX.onclick = () => done(false);
    // Scoped to the overlay (not document) so it doesn't leak globally once
    // the handler is cleared. Danger dialogs never auto-confirm on Enter —
    // it falls through to the focused Cancel button's native click instead.
    els.confirmOverlay.onkeydown = (e) => {
      if (e.key === 'Enter' && !opts.danger) done(true);
      if (e.key === 'Escape') done(false);
    };
  });
}
