// Terminal screen: attach to one agent's pty, replay its scrollback, stream
// live, type (with an extra-keys bar), resize the pty to fit the phone.
/* global Terminal, FitAddon */
import { ctx, screens, show, onChanged, onFrame } from './core.mjs';
import { attachFrame, detachFrame, inputFrame, resizeFrame, createStream } from './proto.mjs';
import { termSettings } from './settings-screen.mjs';
import { xtermOptions } from './term-settings.mjs';
import { EXTRA_KEYS, keySequence, applyCtrl } from './keys.mjs';
import { touchDistance, fontSizeFromPinch } from './pinch.mjs';
import { createLineAccumulator, wheelSequence } from './touch-scroll.mjs';
import { h } from './dom.mjs';

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

screens.terminal = (el, { id }) => {
  const agent = ctx.agents.get(id);
  const title = h('h1', { class: 'term-title' }, agent ? agent.label : id);
  const ended = h('div', { class: 'term-ended', hidden: true });
  const host = h('div', { class: 'term-host' });
  const ctrlBtn = h('button', { class: 'key' }, 'Ctrl');
  const keys = h(
    'div',
    { class: 'keys' },
    EXTRA_KEYS.map((k) => {
      if (k.id === 'ctrl') return ctrlBtn;
      // pointerdown + preventDefault keeps the soft keyboard (textarea focus) open.
      return h('button', { class: 'key', onpointerdown: (e) => (e.preventDefault(), sendKey(k.id)) }, k.label);
    }),
  );
  el.append(
    h(
      'div',
      { class: 'term-screen' },
      h(
        'header',
        { class: 'top' },
        h('button', { class: 'icon', 'aria-label': 'Back', onclick: () => show('list') }, '‹'),
        title,
        screens.git ? h('button', { class: 'small', onclick: () => show('git', { id }) }, 'Git') : h('span', { class: 'spacer' }),
      ),
      ended,
      host,
      keys,
    ),
  );

  const term = new Terminal({ ...xtermOptions(termSettings.get(), darkQuery.matches), cursorBlink: true });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);

  let stream = createStream();
  let attached = false;
  let sent = { cols: 0, rows: 0 };
  let ctrl = false;

  const send = (frame) => ctx.link.send(frame).catch(() => {});

  function setCtrl(on) {
    ctrl = on;
    ctrlBtn.classList.toggle('on', on);
  }
  ctrlBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    setCtrl(!ctrl);
  });

  function sendKey(keyId) {
    if (!attached) return;
    send(inputFrame(id, keySequence(keyId, { appCursor: term.modes.applicationCursorKeysMode })));
    setCtrl(false);
  }

  function attach() {
    if (attached || ctx.linkState !== 'connected') return;
    fit.fit();
    stream = createStream();
    sent = { cols: term.cols, rows: term.rows };
    attached = true;
    send(attachFrame(id, term.cols, term.rows));
  }

  function detach() {
    if (!attached) return;
    attached = false;
    send(detachFrame(id));
  }

  // Refit and tell the pty, only when the size really changed.
  function refit() {
    if (!host.clientWidth || !host.clientHeight) return;
    fit.fit();
    if (attached && (term.cols !== sent.cols || term.rows !== sent.rows)) {
      sent = { cols: term.cols, rows: term.rows };
      send(resizeFrame(id, term.cols, term.rows));
    }
  }

  term.onData((data) => {
    if (!attached) return;
    const { data: out, consumed } = applyCtrl(data, ctrl);
    if (consumed) setCtrl(false);
    send(inputFrame(id, out));
  });

  const offFrames = onFrame((f) => {
    if (f.id !== id) return;
    if (f.t === 'replay') {
      const { data } = stream.onReplay(f);
      term.reset();
      term.write(data);
      ended.hidden = true;
    } else if (f.t === 'data') {
      const data = stream.onData(f);
      if (data !== null) term.write(data);
    } else if (f.t === 'exit') {
      attached = false;
      showEnded(f);
    }
  });

  function showEnded(f) {
    const reason = f.error || (f.exitCode ? `exited with code ${f.exitCode}` : 'session ended');
    const resume = h('button', { class: 'small' }, 'Resume');
    resume.addEventListener('click', async () => {
      resume.disabled = true;
      try {
        const { id: newId } = await ctx.rpc.call('resume', { id, cols: term.cols, rows: term.rows });
        show('terminal', { id: newId });
      } catch (err) {
        resume.disabled = false;
        alert((err && err.message) || String(err));
      }
    });
    ended.replaceChildren(h('span', {}, `Agent ${reason}.`), resume);
    ended.hidden = false;
  }

  // Re-attach after a reconnect; mark detached when the link drops.
  const offChanged = onChanged(() => {
    const a = ctx.agents.get(id);
    if (a) title.textContent = a.label;
    if (ctx.linkState !== 'connected') attached = false;
    else if (!document.hidden) attach();
  });

  // Backgrounded: stop streaming pty output over the network (only agents
  // snapshots keep flowing for notifications); replay on return.
  const onVisibility = () => (document.hidden ? detach() : attach());
  document.addEventListener('visibilitychange', onVisibility);

  const ro = new ResizeObserver(() => requestAnimationFrame(refit));
  ro.observe(host);

  // Live settings (font, theme, scrollback) and OS theme changes.
  const applySettings = () => {
    const o = xtermOptions(termSettings.get(), darkQuery.matches);
    term.options.fontSize = o.fontSize;
    term.options.fontFamily = o.fontFamily;
    term.options.scrollback = o.scrollback;
    term.options.theme = o.theme;
    refit();
  };
  const offSettings = termSettings.subscribe(applySettings);
  darkQuery.addEventListener('change', applySettings);

  // Touch: one finger scrolls, two fingers pinch-zoom (live preview,
  // persisted on release). Capture phase + preventDefault so neither the
  // WebView nor xterm's own (unreliable) touch handling also reacts.
  let pinch = null;
  let swipe = null;
  const lineHeight = () => (host.querySelector('.xterm-screen')?.clientHeight || host.clientHeight) / term.rows;

  function scrollBy(lines) {
    if (!lines) return;
    // Full-screen apps that track the mouse get wheel events; otherwise
    // scroll our own scrollback.
    if (term.buffer.active.type === 'alternate' && term.modes.mouseTrackingMode !== 'none') {
      if (attached) send(inputFrame(id, wheelSequence(lines)));
    } else {
      term.scrollLines(lines);
    }
  }

  host.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length === 2) {
        swipe = null;
        pinch = { dist: touchDistance(e.touches[0], e.touches[1]), size: term.options.fontSize };
      } else if (e.touches.length === 1 && !pinch) {
        swipe = { y: e.touches[0].clientY, acc: createLineAccumulator(lineHeight()) };
      }
    },
    { capture: true, passive: true },
  );
  host.addEventListener(
    'touchmove',
    (e) => {
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        e.stopPropagation();
        const size = fontSizeFromPinch(pinch.size, touchDistance(e.touches[0], e.touches[1]) / pinch.dist);
        if (size !== term.options.fontSize) {
          term.options.fontSize = size;
          refit();
        }
      } else if (swipe && e.touches.length === 1) {
        e.preventDefault();
        e.stopPropagation();
        const y = e.touches[0].clientY;
        scrollBy(swipe.acc.move(y - swipe.y));
        swipe.y = y;
      }
    },
    { capture: true, passive: false },
  );
  host.addEventListener(
    'touchend',
    (e) => {
      if (e.touches.length) return;
      swipe = null;
      if (!pinch) return;
      pinch = null;
      termSettings.update({ fontSize: term.options.fontSize });
    },
    { capture: true },
  );

  host.addEventListener('click', () => term.focus());
  requestAnimationFrame(() => {
    attach();
    term.focus();
  });

  return () => {
    detach();
    offFrames();
    offChanged();
    offSettings();
    darkQuery.removeEventListener('change', applySettings);
    document.removeEventListener('visibilitychange', onVisibility);
    ro.disconnect();
    term.dispose();
  };
};
