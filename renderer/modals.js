'use strict';

import { els } from './dom.js';

// ---------------------------------------------------------------------------
// Kebab dropdown menu
// ---------------------------------------------------------------------------

export function openMenu(anchor, items) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.id = 'kebab-menu';
  for (const it of items) {
    const b = document.createElement('button');
    b.textContent = it.label;
    if (it.danger) b.classList.add('danger');
    b.addEventListener('click', () => {
      closeMenu();
      it.action();
    });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 4}px`;
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

// title, message, { okLabel, danger, alert } -> Promise<boolean>
export function confirmDialog(title, message, opts = {}) {
  return new Promise((resolve) => {
    els.confirmTitle.textContent = title;
    els.confirmMsg.textContent = message;
    els.confirmOk.textContent = opts.okLabel || 'OK';
    els.confirmOk.classList.toggle('danger', !!opts.danger);
    els.confirmCancel.style.display = opts.alert ? 'none' : '';
    els.confirmOverlay.hidden = false;
    els.confirmOk.focus();

    const done = (val) => {
      els.confirmOverlay.hidden = true;
      els.confirmOk.onclick = null;
      els.confirmCancel.onclick = null;
      els.confirmX.onclick = null;
      document.onkeydown = null;
      resolve(val);
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
