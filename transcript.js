'use strict';

// Turns a Claude Code session transcript (~/.claude/projects/<dir>/<id>.jsonl)
// into a short, readable history for the phone: the user's prompts, the
// assistant's replies and one line per tool call. Thinking, tool results,
// subagent (sidechain) turns and bookkeeping lines are dropped. Pure (tested
// in test/transcript.test.js); main.js does the file IO.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Session ids become file names: only accept a plain UUID. */
function isSessionId(s) {
  return typeof s === 'string' && UUID.test(s);
}

const basename = (p) => String(p).split(/[\\/]/).pop();
const firstLine = (s) => String(s).split('\n')[0];

// The one field that says what a tool call did.
function toolSummary(name, input) {
  const i = input && typeof input === 'object' ? input : {};
  if (name === 'Bash' || name === 'PowerShell') return i.description || firstLine(i.command || '');
  if (i.file_path) return basename(i.file_path);
  if (i.notebook_path) return basename(i.notebook_path);
  for (const key of ['description', 'pattern', 'query', 'url', 'skill', 'prompt']) {
    if (typeof i[key] === 'string' && i[key]) return firstLine(i[key]);
  }
  return '';
}

// Wrappers Claude Code writes into user messages that aren't something the
// user typed.
const NOISE = /^\s*<(local-command-stdout|local-command-stderr|local-command-caveat|system-reminder|bash-input|bash-stdout|bash-stderr)>/;

function userText(content) {
  const raw =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
            .map((c) => c.text)
            .join('\n')
        : '';
  if (!raw.trim() || NOISE.test(raw)) return '';
  const cmd = /<command-name>([^<]*)<\/command-name>/.exec(raw);
  if (cmd) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(raw);
    const name = cmd[1].trim();
    return `${name.startsWith('/') ? name : `/${name}`}${args && args[1].trim() ? ` ${args[1].trim()}` : ''}`;
  }
  return raw.trim();
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * @returns {{k:'user'|'text'|'tool', t:string, name?:string, ts?:string}[]}
 *   oldest first, at most `maxEntries`, JSON size within `maxBytes`.
 */
function parseTranscript(text, { maxEntries = 600, maxChars = 4000, maxBytes = 512 * 1024 } = {}) {
  const out = [];
  for (const l of String(text).split('\n')) {
    if (!l.trim()) continue;
    let o;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    if (!o || typeof o !== 'object' || o.isSidechain || o.isMeta || !o.message) continue;
    const ts = o.timestamp;
    if (o.type === 'user') {
      const t = userText(o.message.content);
      if (t) out.push({ k: 'user', t: clip(t, maxChars), ts });
    } else if (o.type === 'assistant' && Array.isArray(o.message.content)) {
      for (const c of o.message.content) {
        if (!c) continue;
        if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
          out.push({ k: 'text', t: clip(c.text.trim(), maxChars), ts });
        } else if (c.type === 'tool_use' && typeof c.name === 'string') {
          out.push({ k: 'tool', name: c.name, t: clip(toolSummary(c.name, c.input), 200), ts });
        }
      }
    }
  }
  let entries = out.slice(-maxEntries);
  // Drop the oldest until the JSON fits the budget (keeps the newest).
  let size = JSON.stringify(entries).length;
  while (entries.length > 1 && size > maxBytes) {
    size -= JSON.stringify(entries[0]).length + 1;
    entries = entries.slice(1);
  }
  return entries;
}

module.exports = { parseTranscript, toolSummary, isSessionId };
