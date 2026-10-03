'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { parseServiceAccount, createFcmClient, isPushToken } = require('../fcm');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const keyFile = (over = {}) =>
  JSON.stringify({ type: 'service_account', project_id: 'proj', client_email: 'sa@proj.iam.gserviceaccount.com', private_key: pem, ...over });

test('parseServiceAccount accepts a key file and rejects bad ones', () => {
  assert.deepEqual(Object.keys(parseServiceAccount(keyFile())).sort(), ['clientEmail', 'privateKey', 'projectId']);
  assert.throws(() => parseServiceAccount('nope'), /JSON/);
  assert.throws(() => parseServiceAccount(JSON.stringify({ type: 'authorized_user' })), /service account/);
  assert.throws(() => parseServiceAccount(keyFile({ project_id: '' })), /missing/);
  assert.throws(() => parseServiceAccount(keyFile({ private_key: 'junk' })), /not valid/);
});

test('isPushToken', () => {
  assert.equal(isPushToken('abc:APA91b-_x.yzabcdefghijkl'), true);
  assert.equal(isPushToken('short'), false);
  assert.equal(isPushToken('has space has space has space'), false);
  assert.equal(isPushToken(5), false);
});

function fakeFetch(handlers) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    const h = handlers.shift();
    return { ok: h.status < 400, status: h.status, json: async () => h.json || {} };
  };
  return { f, calls };
}

test('send signs a verifiable JWT, caches the access token and posts a data message', async () => {
  const { f, calls } = fakeFetch([
    { status: 200, json: { access_token: 'AT', expires_in: 3600 } },
    { status: 200 },
    { status: 200 },
  ]);
  const client = createFcmClient(parseServiceAccount(keyFile()), { fetch: f, now: () => 1_000_000 });
  assert.equal(await client.send('tok', { type: 'finished', n: 3 }), 'ok');
  assert.equal(await client.send('tok', { type: 'dismiss' }), 'ok');
  assert.equal(calls.length, 3); // one token exchange, two sends

  const assertion = new URLSearchParams(calls[0].init.body).get('assertion');
  const [h, b, s] = assertion.split('.');
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${b}`), publicKey, Buffer.from(s, 'base64url')));
  assert.equal(JSON.parse(Buffer.from(b, 'base64url')).iss, 'sa@proj.iam.gserviceaccount.com');

  assert.match(calls[1].url, /projects\/proj\/messages:send$/);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer AT');
  const msg = JSON.parse(calls[1].init.body).message;
  assert.deepEqual(msg.data, { type: 'finished', n: '3' });
  assert.equal(msg.android.priority, 'HIGH');
});

test('send reports a dead device token and throws on other failures', async () => {
  const { f } = fakeFetch([
    { status: 200, json: { access_token: 'AT', expires_in: 3600 } },
    { status: 404, json: { error: { status: 'NOT_FOUND' } } },
    { status: 500, json: { error: { message: 'boom' } } },
  ]);
  const client = createFcmClient(parseServiceAccount(keyFile()), { fetch: f });
  assert.equal(await client.send('tok', {}), 'invalid-token');
  await assert.rejects(client.send('tok', {}), /boom/);
});
