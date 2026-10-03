// App-styled replacements for the browser's alert / confirm / prompt.
// Each returns a promise; Escape or a tap outside cancels.
import { h, NO_SUGGESTIONS } from './dom.mjs';

function open({ title, message, input, buttons }) {
  return new Promise((resolve) => {
    const field = input
      ? h('input', { type: 'text', value: input.value ?? '', ...NO_SUGGESTIONS, class: 'dialog-input' })
      : null;
    const done = (value) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const buttonEls = buttons.map((b) =>
      h('button', { class: b.class || null, onclick: () => done(b.value === 'input' ? field.value : b.value) }, b.label),
    );
    const cancelValue = input ? null : buttons.find((b) => b.cancel)?.value ?? null;
    const dialog = h(
      'div',
      { class: 'dialog', role: 'dialog', 'aria-modal': 'true' },
      title ? h('h2', {}, title) : null,
      message ? h('p', { class: 'dialog-message' }, message) : null,
      field,
      h('div', { class: 'dialog-actions' }, buttonEls),
    );
    const backdrop = h('div', { class: 'backdrop dialog-backdrop', onclick: (e) => e.target === backdrop && done(cancelValue) }, dialog);
    const onKey = (e) => {
      if (e.key === 'Escape') done(cancelValue);
      else if (e.key === 'Enter' && field) done(field.value);
    };
    document.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);
    if (field) {
      field.focus();
      field.select();
    } else {
      (buttonEls[buttonEls.length - 1]).focus();
    }
  });
}

export function alertDialog(message, title) {
  return open({ title, message, buttons: [{ label: 'OK', value: true, class: 'primary', cancel: true }] });
}

/** Resolves true / false. `danger` styles the confirm button as destructive. */
export function confirmDialog(message, { title, confirmLabel = 'OK', danger = false } = {}) {
  return open({
    title,
    message,
    buttons: [
      { label: 'Cancel', value: false, cancel: true },
      { label: confirmLabel, value: true, class: danger ? 'primary danger-fill' : 'primary' },
    ],
  });
}

/** Resolves the entered text, or null when cancelled. */
export function promptDialog(title, value = '', { confirmLabel = 'OK' } = {}) {
  return open({
    title,
    input: { value },
    buttons: [
      { label: 'Cancel', value: null },
      { label: confirmLabel, value: 'input', class: 'primary' },
    ],
  });
}
