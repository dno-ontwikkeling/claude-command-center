'use strict';

// ---------------------------------------------------------------------------
// Command-line arguments for a `claude` session. Electron-free so it can be
// unit tested; main.js spawnAgent passes the result to node-pty.
// ---------------------------------------------------------------------------

// Cap on a first prompt (the brief plus the starting skill). Far below
// CreateProcessW's 32,767-character command-line limit.
const MAX_PROMPT = 8000;

// The prompt as it should be passed through node-pty. node-pty's Windows
// argsToCommandLine passes an argument that starts and ends with `"` and
// contains whitespace through unquoted, so it gets split (Step 1 spike,
// test/ptyargv.test.js). A trailing space stops that. A leading `-` would make
// claude parse the prompt as an option, so it gets a leading space.
function safePrompt(prompt) {
  let p = prompt;
  if (p.startsWith('-')) p = ' ' + p;
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"') && /\s/.test(p)) p += ' ';
  return p;
}

// `--resume <id>` first, then the permission flag (so it applies to a resumed
// run too), then the first prompt as the last positional. A prompt is never
// sent with `resume`: that session already has its conversation.
function buildClaudeArgs({ resume, bypass, prompt } = {}) {
  const args = [];
  if (resume) args.push('--resume', resume);
  if (bypass) args.push('--dangerously-skip-permissions');
  if (!resume && typeof prompt === 'string' && prompt) {
    if (prompt.includes('\0')) throw new Error('The prompt contains a NUL character.');
    if (prompt.length > MAX_PROMPT) throw new Error(`The prompt is too long (${prompt.length} > ${MAX_PROMPT} characters).`);
    args.push(safePrompt(prompt));
  }
  return args;
}

module.exports = { buildClaudeArgs, MAX_PROMPT };
