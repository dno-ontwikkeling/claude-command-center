'use strict';

// ---------------------------------------------------------------------------
// Renderer logger. Mirrors to the devtools console and forwards to the main
// process so renderer errors land in the same durable log file as main. Also
// installs global handlers so uncaught renderer errors/rejections are recorded
// instead of only flashing in a console nobody has open.
// ---------------------------------------------------------------------------

function serialize(a) {
  if (a instanceof Error) return a.stack || a.message;
  if (typeof a === 'string') return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function emit(level, args) {
  const c = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  c(...args);
  try {
    window.api?.log?.(level, args.map(serialize));
  } catch {
    /* preload/api unavailable — console-only is fine */
  }
}

export const log = {
  error: (...a) => emit('error', a),
  warn: (...a) => emit('warn', a),
  info: (...a) => emit('info', a),
  debug: (...a) => emit('debug', a),
};

export function installGlobalHandlers() {
  window.addEventListener('error', (e) => {
    log.error('window.onerror', e.error || e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    log.error('unhandledrejection', e.reason);
  });
}
