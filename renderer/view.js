'use strict';

import { els } from './dom.js';
import { state } from './state.js';

// ---------------------------------------------------------------------------
// Stage view: the active agent's terminal, or the dashboard (projects and
// workspaces). The dashboard also fills the stage whenever no agent is active,
// so there is never a blank stage. Kept in its own module so agents.js can
// switch views without importing the dashboard (which imports agents.js).
// ---------------------------------------------------------------------------

let dashboardOpen = false;
const shownSubs = new Set();

/** Register a listener fired each time the dashboard becomes visible. */
export function onDashboardShown(cb) {
  shownSubs.add(cb);
  return () => shownSubs.delete(cb);
}

export function isDashboardVisible() {
  return dashboardOpen || !state.activeId;
}

/** Open (true) or close (false) the dashboard. Closing with no active agent
 *  keeps it on screen: there is nothing else to show. */
export function setDashboard(open) {
  dashboardOpen = open;
  syncView();
}

/** Re-apply the view after the active agent changed. */
export function syncView() {
  const show = isDashboardVisible();
  const was = !els.dashboard.hidden;
  els.dashboard.hidden = !show;
  els.stage.classList.toggle('show-dash', show);
  els.dashboardBtn.classList.toggle('on', show);
  els.dashboardBtn.setAttribute('aria-pressed', String(show));
  if (show && !was) for (const cb of shownSubs) cb();
}
