'use strict';

// ---------------------------------------------------------------------------
// Leveled logger (main process). Writes to userData/logs/main.log with simple
// size-based rotation, and mirrors to the console. The app previously had zero
// logging, so every swallowed error was invisible after the fact — this gives
// failures a durable trail without changing control flow.
// ---------------------------------------------------------------------------

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const MAX_BYTES = 1024 * 1024; // rotate at 1 MB, keep one previous file

// CC_LOG_LEVEL env can raise/lower verbosity; default info.
const threshold = LEVELS[process.env.CC_LOG_LEVEL] ?? LEVELS.info;

let logFile = null;
let logDir = null;

function ensurePaths() {
  if (logFile) return;
  // app.getPath('userData') is only valid once app is constructed; logger.js is
  // required after that in main.js, so this is safe.
  logDir = path.join(app.getPath('userData'), 'logs');
  logFile = path.join(logDir, 'main.log');
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    /* if we can't make the dir we fall back to console-only below */
  }
}

function rotateIfNeeded() {
  try {
    const { size } = fs.statSync(logFile);
    if (size < MAX_BYTES) return;
    fs.renameSync(logFile, `${logFile}.1`); // overwrites any previous .1
  } catch {
    /* file missing (first write) or rename raced — nothing to rotate */
  }
}

function write(level, source, args) {
  if (LEVELS[level] > threshold) return;
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${source}] ${args
    .map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : safeJson(a)))
    .join(' ')}\n`;

  // Always mirror to console so `npm start` shows it live.
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line.trimEnd());

  ensurePaths();
  if (!logDir) return; // dir creation failed — console-only
  try {
    rotateIfNeeded();
    fs.appendFileSync(logFile, line);
  } catch {
    /* disk full / locked — never let logging throw into the caller */
  }
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// `source` tags where a line came from (e.g. 'main', 'git', 'renderer').
function make(source) {
  return {
    error: (...a) => write('error', source, a),
    warn: (...a) => write('warn', source, a),
    info: (...a) => write('info', source, a),
    debug: (...a) => write('debug', source, a),
  };
}

const log = make('main');
log.make = make;
log.logFilePath = () => {
  ensurePaths();
  return logFile;
};

module.exports = log;
