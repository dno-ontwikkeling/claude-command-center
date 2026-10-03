// Phone settings: terminal look (stored on the phone only) and the pairing.
import { ctx, screens, show, onChanged } from './core.mjs';
import { createSettingsStore, FONT_FAMILIES } from './term-settings.mjs';
import { h, fill } from './dom.mjs';
import { confirmDialog } from './dialog.mjs';

/** The phone's terminal settings; the terminal screen subscribes for live updates. */
export const termSettings = createSettingsStore(window.localStorage);

function field(label, control) {
  return h('label', { class: 'field' }, h('span', {}, label), control);
}

function select(options, value, onchange) {
  const el = h('select', { onchange: (e) => onchange(e.target.value) });
  for (const o of options) {
    const opt = h('option', { value: o.value }, o.label);
    if (o.value === value) opt.selected = true;
    el.append(opt);
  }
  return el;
}

function number(value, min, max, step, onchange) {
  return h('input', {
    type: 'number',
    inputmode: 'numeric',
    min,
    max,
    step,
    value,
    onchange: (e) => onchange(Number(e.target.value)),
  });
}

screens.settings = (el) => {
  let pairedUrl = null;
  const render = () => {
    const s = termSettings.get();
    const st = ctx.linkState;
    fill(el,
      h(
        'header',
        { class: 'top' },
        h('button', { class: 'icon', 'aria-label': 'Back', onclick: () => show('list') }, '‹'),
        h('h1', {}, 'Settings'),
        h('span', { class: 'spacer' }),
      ),

      h('h2', { class: 'section' }, 'Terminal (this phone only)'),
      field('Font size', number(s.fontSize, 8, 24, 1, (v) => termSettings.update({ fontSize: v }))),
      field('Font', select(FONT_FAMILIES, s.fontFamily, (v) => termSettings.update({ fontFamily: v }))),
      field(
        'Theme',
        select(
          [
            { value: 'system', label: 'Follow phone' },
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ],
          s.theme,
          (v) => termSettings.update({ theme: v }),
        ),
      ),
      field('Scrollback lines', number(s.scrollback, 500, 20000, 500, (v) => termSettings.update({ scrollback: v }))),
      h('p', { class: 'muted hint' }, 'Pinch the terminal to change the font size too.'),

      h('h2', { class: 'section' }, 'Connection'),
      h('p', {}, pairedUrl ? `Paired with ${pairedUrl.replace(/^wss:\/\//, '')}` : 'Paired'),
      h('p', { class: 'muted' }, `Status: ${st}`),
      h(
        'div',
        { class: 'row' },
        st === 'connected' || st === 'connecting' || st === 'offline'
          ? h('button', { onclick: () => ctx.link.disconnect() }, 'Disconnect')
          : h('button', { onclick: () => ctx.link.connect() }, 'Reconnect'),
        h('button', { onclick: () => ctx.link.requestNotificationPermission() }, 'Allow notifications'),
      ),
      h(
        'button',
        {
          class: 'danger',
          onclick: async () => {
            const ok = await confirmDialog('You will need to scan the QR code again.', { title: 'Unpair this phone?', confirmLabel: 'Unpair', danger: true });
            if (ok) ctx.link.unpair();
          },
        },
        'Unpair',
      ),
    );
  };
  ctx.link.getState().then((st) => {
    pairedUrl = st.url;
    render();
  });
  render();
  const offLink = onChanged(render);
  const offSettings = termSettings.subscribe(render);
  return () => {
    offLink();
    offSettings();
  };
};
