'use strict';

// ---------------------------------------------------------------------------
// TUI output classification. Claude's inline permission prompts, rate-limit
// notices, and working spinner don't all fire hooks, so we sniff them out of the
// terminal stream (tuicommander-style). This module is the PURE part — given a
// chunk of pty output it returns which signal it represents — so it can be unit
// tested (see test/tui-signals.test.mjs). agents.js applies the side effects.
// ---------------------------------------------------------------------------

export const QUESTION_RE =
  /❯\s*1\.\s|\bDo you want to (?:proceed|continue|create|run|make)\b|\b(?:y\/n|yes\/no)\b/i;
export const RATELIMIT_RE = /(?:usage|rate)\s*limit\s*reached|limit reached[\s\S]{0,40}reset/i;
export const RESET_AT_RE = /reset(?:s|ting)?\b[\s\S]{0,12}?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i;
// Claude's working line ("✶ Working… (esc to interrupt)") only shows while the
// agent is actively processing — never on a question or idle prompt.
export const WORKING_RE = /\besc to interrupt\b/i;

/**
 * Classify a chunk of terminal output. Priority matches the live handler:
 * working (spinner) wins, then rate-limit, then a blocking question.
 * @returns {{ kind: 'working'|'rate-limited'|'needs-input'|null, resetAt: string|null }}
 */
export function classifyOutput(data) {
  const text = String(data);
  if (WORKING_RE.test(text)) return { kind: 'working', resetAt: null };
  if (RATELIMIT_RE.test(text)) {
    const m = text.match(RESET_AT_RE);
    return { kind: 'rate-limited', resetAt: m ? m[1] : null };
  }
  if (QUESTION_RE.test(text)) return { kind: 'needs-input', resetAt: null };
  return { kind: null, resetAt: null };
}
