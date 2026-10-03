'use strict';

// ---------------------------------------------------------------------------
// Firebase Cloud Messaging sender (HTTP v1), no dependencies: a service-account
// key signs a JWT (RS256), Google trades it for a short-lived OAuth token, and
// data messages go to the phone's FCM token. No electron dependency; `fetch`
// and `now` are injectable (see test/fcm.test.js).
// ---------------------------------------------------------------------------

const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const MAX_TOKEN_CHARS = 4096;

// The fields of a service-account key file we need, or throws with a reason
// fit for the settings UI.
function parseServiceAccount(text) {
  let k;
  try {
    k = JSON.parse(String(text));
  } catch {
    throw new Error('Not a JSON file.');
  }
  if (!k || typeof k !== 'object' || k.type !== 'service_account') {
    throw new Error('Not a service account key (Firebase console: Project settings, Service accounts, Generate new private key).');
  }
  const { project_id: projectId, client_email: clientEmail, private_key: privateKey } = k;
  if (![projectId, clientEmail, privateKey].every((v) => typeof v === 'string' && v)) {
    throw new Error('Service account key is missing project_id, client_email or private_key.');
  }
  try {
    crypto.createPrivateKey(privateKey);
  } catch {
    throw new Error('The private key in the file is not valid.');
  }
  return { projectId, clientEmail, privateKey };
}

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

function signJwt({ clientEmail, privateKey }, nowSec) {
  const head = b64url({ alg: 'RS256', typ: 'JWT' });
  const body = b64url({ iss: clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

// A phone's FCM registration token: opaque, but bounded and printable.
const isPushToken = (v) => typeof v === 'string' && v.length >= 20 && v.length <= MAX_TOKEN_CHARS && /^[\w:.\-]+$/.test(v);

// account: result of parseServiceAccount. Returns { send(token, data) }.
// send resolves 'ok', or 'invalid-token' when Google says the phone's token is
// dead (the caller should forget it); any other failure throws.
function createFcmClient(account, { fetch: doFetch = globalThis.fetch, now = Date.now } = {}) {
  let access = null; // { token, expiresAt }

  async function accessToken() {
    if (access && access.expiresAt - now() > 60_000) return access.token;
    const res = await doFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signJwt(account, Math.floor(now() / 1000)),
      }).toString(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) {
      throw new Error(`Google auth failed (${res.status}): ${json.error_description || json.error || 'no token'}`);
    }
    access = { token: json.access_token, expiresAt: now() + (Number(json.expires_in) || 3600) * 1000 };
    return access.token;
  }

  return {
    projectId: account.projectId,
    async send(deviceToken, data) {
      const body = {
        message: {
          token: deviceToken,
          // Data-only and high priority: the app builds the notification, and
          // Doze lets a high-priority message through right away.
          data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
          android: { priority: 'HIGH', ttl: '600s' },
        },
      };
      const res = await doFetch(`https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) return 'ok';
      const json = await res.json().catch(() => ({}));
      const status = json.error && json.error.status;
      if (status === 'NOT_FOUND' || status === 'UNREGISTERED') return 'invalid-token';
      if (res.status === 401) access = null; // stale token: refetch next time
      throw new Error(`FCM send failed (${res.status}): ${(json.error && json.error.message) || 'unknown error'}`);
    },
  };
}

module.exports = { parseServiceAccount, createFcmClient, isPushToken, signJwt };
