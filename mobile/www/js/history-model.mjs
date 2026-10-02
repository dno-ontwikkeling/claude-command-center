// Pure helpers for the history screen (unit tested).

/** Splits a reply into prose and ``` fenced code blocks (language tag dropped). */
export function splitBlocks(text) {
  const out = [];
  const lines = String(text).split('\n');
  let code = false;
  let buf = [];
  const flush = () => {
    const t = buf.join('\n').replace(/^\n+|\n+$/g, '');
    if (t) out.push({ code, text: t });
    buf = [];
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      flush();
      code = !code;
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

/** True when a scroll container is at (or within `slack` px of) the bottom. */
export function isNearBottom({ scrollTop, clientHeight, scrollHeight }, slack = 48) {
  return scrollHeight - (scrollTop + clientHeight) <= slack;
}
