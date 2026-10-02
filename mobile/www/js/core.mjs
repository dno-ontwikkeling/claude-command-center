// Shared app state + screen router. Screens import this (never app.mjs), so
// screen modules can register themselves without an import cycle.
import * as link from './remote-link.mjs';
import { createAgentsState, createRpcClient } from './proto.mjs';

export const ctx = {
  link,
  agents: createAgentsState(),
  rpc: createRpcClient({ send: (frame) => link.send(frame) }),
  linkState: 'idle',
  linkDetail: null,
  /** every parsed server frame: (frame) => void */
  frameSubs: new Set(),
  /** agents list or link state changed: () => void */
  changeSubs: new Set(),
};

/** name -> (root, arg) => optional cleanup */
export const screens = {};
let current = { name: null, cleanup: null };
const root = () => document.getElementById('app');

export function show(name, arg) {
  current.cleanup?.();
  root().replaceChildren();
  current = { name, cleanup: screens[name](root(), arg) || null };
}

export const currentScreen = () => current.name;

export function notifyChanged() {
  for (const cb of ctx.changeSubs) cb();
}

/** Subscribe for the lifetime of a screen; returns the unsubscribe. */
export function onChanged(cb) {
  ctx.changeSubs.add(cb);
  return () => ctx.changeSubs.delete(cb);
}

export function onFrame(cb) {
  ctx.frameSubs.add(cb);
  return () => ctx.frameSubs.delete(cb);
}
