'use strict';

import { els } from './dom.js';

// ---------------------------------------------------------------------------
// Kebab dropdown menu
// ---------------------------------------------------------------------------

export function openMenu(anchor, items) {
  // Read the anchor rect before closeMenu — a submenu re-anchors to the same
  // (persistent) kebab button, but capturing first is cheap insurance.
  const r0 = anchor.getBoundingClientRect();
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.id = 'kebab-menu';
  for (const it of items) {
    const b = document.createElement('button');
    b.textContent = it.label;
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

export function promptText(title, placeholder = '') {
  return new Promise((resolve) => {
    els.promptTitle.textContent = title;
    els.promptInput.value = '';
    els.promptInput.placeholder = placeholder;
    els.promptOverlay.hidden = false;
    els.promptInput.focus();

    const done = (val) => {
      els.promptOverlay.hidden = true;
      els.promptOk.onclick = null;
      els.promptCancel.onclick = null;
      els.promptInput.onkeydown = null;
      resolve(val);
    };
    els.promptOk.onclick = () => done(els.promptInput.value.trim() || null);
    els.promptCancel.onclick = () => done(null);
    els.promptInput.onkeydown = (e) => {
      if (e.key === 'Enter') done(els.promptInput.value.trim() || null);
      if (e.key === 'Escape') done(null);
    };
  });
}

// title, message, { okLabel, danger, alert, checkbox } -> Promise<boolean>
// When `checkbox` (a label string) is given, resolves { ok, checked } instead.
export function confirmDialog(title, message, opts = {}) {
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
    els.confirmOk.focus();

    const done = (val) => {
      els.confirmOverlay.hidden = true;
      els.confirmOk.onclick = null;
      els.confirmCancel.onclick = null;
      els.confirmX.onclick = null;
      document.onkeydown = null;
      resolve(hasCheck ? { ok: val, checked: els.confirmCheck.checked } : val);
    };
    els.confirmOk.onclick = () => done(true);
    els.confirmCancel.onclick = () => done(false);
    els.confirmX.onclick = () => done(false);
    document.onkeydown = (e) => {
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    };
  });
}
