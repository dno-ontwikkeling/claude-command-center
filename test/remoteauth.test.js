'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  generateToken,
  checkBearer,
  createLockout,
  encodePairing,
  decodePairing,
  normalizeFingerprint,
} = require('../remoteauth');

const pairing = require(path.join(__dirname, 'fixtures', 'remote-proto', 'pairing.json'));

test('generateToken returns 64 lowercase hex chars and differs per call', () => {
  const a = generateToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, generateToken());
});

test('checkBearer accepts the exact Bearer token', () => {
  const tok = generateToken();
  assert.equal(checkBearer(`Bearer ${tok}`, tok), true);
});

test('checkBearer rejects wrong, missing, malformed and differently-cased schemes', () => {
  const tok = generateToken();
  assert.equal(checkBearer(`Bearer ${generateToken()}`, tok), false);
  assert.equal(checkBearer(undefined, tok), false);
  assert.equal(checkBearer('', tok), false);
  assert.equal(checkBearer(tok, tok), false);
  assert.equal(checkBearer(`Basic ${tok}`, tok), false);
  assert.equal(checkBearer(`Bearer ${tok} extra`, tok), false);
});

test('checkBearer never matches when no token is configured', () => {
  assert.equal(checkBearer('Bearer ', ''), false);
  assert.equal(checkBearer('Bearer undefined', undefined), false);
});

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

test('lockout blocks an IP after 5 failures for 15 minutes', () => {
  const c = clock();
  const lo = createLockout({ now: c.now });
  for (let i = 0; i < 4; i++) lo.recordFailure('1.2.3.4');
  assert.equal(lo.isLocked('1.2.3.4'), false);
  lo.recordFailure('1.2.3.4');
  assert.equal(lo.isLocked('1.2.3.4'), true);
  c.advance(15 * 60 * 1000 - 1);
  assert.equal(lo.isLocked('1.2.3.4'), true);
  c.advance(1);
  assert.equal(lo.isLocked('1.2.3.4'), false);
});

test('lockout is per IP', () => {
  const lo = createLockout({ now: clock().now });
  for (let i = 0; i < 5; i++) lo.recordFailure('1.1.1.1');
  assert.equal(lo.isLocked('1.1.1.1'), true);
  assert.equal(lo.isLocked('2.2.2.2'), false);
});

test('failures older than the block window are forgotten', () => {
  const c = clock();
  const lo = createLockout({ now: c.now });
  for (let i = 0; i < 4; i++) lo.recordFailure('1.2.3.4');
  c.advance(15 * 60 * 1000 + 1);
  lo.recordFailure('1.2.3.4');
  assert.equal(lo.isLocked('1.2.3.4'), false);
});

test('a success clears the failure count', () => {
  const lo = createLockout({ now: clock().now });
  for (let i = 0; i < 4; i++) lo.recordFailure('1.2.3.4');
  lo.recordSuccess('1.2.3.4');
  lo.recordFailure('1.2.3.4');
  assert.equal(lo.isLocked('1.2.3.4'), false);
});

test('lockout tracking is bounded in size (many spoofed IPs cannot exhaust memory)', () => {
  const lo = createLockout({ now: clock().now, maxEntries: 100 });
  for (let i = 0; i < 1000; i++) lo.recordFailure(`10.0.${i >> 8}.${i & 255}`);
  assert.ok(lo.size() <= 100, `size ${lo.size()}`);
});

test('normalizeFingerprint strips colons and lowercases Node fingerprint256 output', () => {
  assert.equal(normalizeFingerprint('AB:CD:0F'), 'abcd0f');
  assert.equal(normalizeFingerprint('abcd0f'), 'abcd0f');
});

for (const { payload, encoded } of pairing.valid) {
  test(`decodePairing accepts fixture ${payload.url}`, () => {
    assert.deepEqual(decodePairing(encoded), payload);
  });
  test(`encodePairing reproduces fixture ${payload.url}`, () => {
    assert.equal(encodePairing(payload), encoded);
  });
}

for (const { why, encoded } of pairing.invalid) {
  test(`decodePairing rejects: ${why}`, () => {
    assert.throws(() => decodePairing(encoded));
  });
}

test('encodePairing refuses to encode an invalid payload', () => {
  assert.throws(() => encodePairing({ ...pairing.valid[0].payload, url: 'ws://x:1' }));
});
