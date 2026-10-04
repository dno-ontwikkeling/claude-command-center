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
// Only the notices Claude Code itself prints when a plan limit is hit ("Claude
// usage limit reached. Your limit will reset at 3pm", "5-hour limit reached ∙
// resets 3pm", "You've hit your limit · resets 3pm"), and only with the reset
// clause right after. Bare phrases like "usage limit reached" turn up in
// answers, docs and source code and must not flag the agent.
export const RATELIMIT_RE =
  /(?:\bclaude (?:ai )?usage limit reached|\b(?:\d+-hour|session|weekly|opus(?: weekly)?|sonnet(?: weekly)?) limit reached|\byou['’]ve hit your (?:\w+ )?limit)[\s\S]{0,60}?\breset/i;
export const RESET_AT_RE = /reset(?:s|ting)?\b[\s\S]{0,12}?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i;
// Claude's working line ("✶ Working… (esc to interrupt)") only shows while the
// agent is actively processing — never on a question or idle prompt.
export const WORKING_RE = /\besc to interrupt\b/i;

// Terminal output -> plain text. The TUI styles words with SGR codes and often
// moves the cursor right instead of printing a space, so a notice can arrive as
// "5-hour ESC[1C limit ESC[1C reached"; cursor-forward becomes a space and every
// other escape sequence (CSI, OSC, two-byte) is dropped.
export function toPlainText(data) {
  return String(data)
    .replace(/\x1b\[\d*C/g, ' ')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '');
}

/**
 * Classify a chunk of terminal output. Priority matches the live handler:
 * working (spinner) wins, then rate-limit, then a blocking question.
 * @returns {{ kind: 'working'|'rate-limited'|'needs-input'|null, resetAt: string|null }}
 */
export function classifyOutput(data) {
  const text = toPlainText(data);
  if (WORKING_RE.test(text)) return { kind: 'working', resetAt: null };
  if (RATELIMIT_RE.test(text)) {
    const m = text.match(RESET_AT_RE);
    return { kind: 'rate-limited', resetAt: m ? m[1] : null };
  }
  if (QUESTION_RE.test(text)) return { kind: 'needs-input', resetAt: null };
  return { kind: null, resetAt: null };
}
