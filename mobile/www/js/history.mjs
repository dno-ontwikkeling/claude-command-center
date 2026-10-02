// History screen: the agent's conversation read from its Claude Code
// transcript (rpc 'transcript'), as plain HTML so it scrolls natively. The
// live terminal can't scroll smoothly: in fullscreen mode every scroll step is
// a round trip to the PC and a full redraw.
import { ctx, screens, show } from './core.mjs';
import { splitBlocks, isNearBottom } from './history-model.mjs';
import { h, fill } from './dom.mjs';

const REFRESH_MS = 4000;

function renderEntry(e) {
  if (e.k === 'user') return h('div', { class: 'h-user' }, e.t);
  if (e.k === 'tool') return h('div', { class: 'h-tool' }, h('b', {}, e.name), e.t ? ` ${e.t}` : '');
  return h(
    'div',
    { class: 'h-text' },
    splitBlocks(e.t).map((b) => (b.code ? h('pre', {}, b.text) : h('p', {}, b.text))),
  );
}

screens.history = (el, { id }) => {
  const agent = ctx.agents.get(id);
  const status = h('p', { class: 'muted h-status' }, 'Loading…');
  const list = h('div', { class: 'history' }, status);
  const refreshBtn = h('button', { class: 'small', onclick: () => load() }, 'Refresh');
  el.append(
    h(
      'div',
      { class: 'term-screen' },
      h(
        'header',
        { class: 'top' },
        h('button', { class: 'icon', 'aria-label': 'Back', onclick: () => show(agent && !agent.dormant ? 'terminal' : 'list', { id }) }, '‹'),
        h('h1', { class: 'term-title' }, agent ? `${agent.label} — history` : 'History'),
        refreshBtn,
      ),
      list,
    ),
  );

  let last = '';
  let busy = false;
  let first = true;
  async function load() {
    if (busy || ctx.linkState !== 'connected') return;
    busy = true;
    try {
      const { entries } = await ctx.rpc.call('transcript', { id });
      const sig = JSON.stringify(entries.at(-1) || null) + entries.length;
      if (sig === last) return;
      last = sig;
      const stick = first || isNearBottom(list);
      fill(list, entries.length ? entries.map(renderEntry) : h('p', { class: 'muted h-status' }, 'No conversation yet.'));
      if (stick) list.scrollTop = list.scrollHeight;
      first = false;
    } catch (err) {
      status.textContent = (err && err.message) || String(err);
      if (first) fill(list, status);
    } finally {
      busy = false;
    }
  }

  load();
  // Follow a working agent, but only re-read while visible.
  const timer = setInterval(() => {
    if (!document.hidden) load();
  }, REFRESH_MS);
  return () => clearInterval(timer);
};
