// Decodes the desktop's pairing QR: "ccr1:" + base64url(JSON {v,url,token,certSha256}).
// Same rules as the desktop's remoteauth.js (both tested against
// test/fixtures/remote-proto/pairing.json). The decoded payload goes straight to
// the native plugin; the WebView never stores the token.

const PREFIX = 'ccr1:';
const HEX64 = /^[0-9a-f]{64}$/;
const WSS_URL = /^wss:\/\/(\[[0-9a-fA-F:]+\]|[^/:\s]+):(\d{1,5})\/?$/;

function base64UrlToText(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function decodePairing(code) {
  // Strip all whitespace: a pasted linking code may be wrapped over lines.
  const s = String(code ?? '').replace(/\s+/g, '');
  if (!s.startsWith(PREFIX)) throw new Error('Not a Command Center pairing code.');
  let p;
  try {
    p = JSON.parse(base64UrlToText(s.slice(PREFIX.length)));
  } catch {
    throw new Error('Pairing code is corrupt.');
  }
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Pairing code is corrupt.');
  if (p.v !== 1) throw new Error('This pairing code is from a newer Command Center. Update the app.');
  const m = WSS_URL.exec(String(p.url));
  if (!m || +m[2] < 1 || +m[2] > 65535) throw new Error('Pairing code has an invalid address.');
  if (!HEX64.test(String(p.token))) throw new Error('Pairing code has an invalid token.');
  if (!HEX64.test(String(p.certSha256))) throw new Error('Pairing code has an invalid certificate fingerprint.');
  return { v: 1, url: p.url, token: p.token, certSha256: p.certSha256 };
}

/** Human summary for the confirm screen (never includes the token). */
export function describePairing(p) {
  return `Connect to ${p.url.replace(/^wss:\/\//, '').replace(/\/$/, '')}`;
}
