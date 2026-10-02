import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodePairing, describePairing } from '../www/js/pairing.mjs';

// Same fixture the desktop's remoteauth tests use: the QR the desktop shows.
const pairing = JSON.parse(readFileSync(new URL('../../test/fixtures/remote-proto/pairing.json', import.meta.url)));

for (const { payload, encoded } of pairing.valid) {
  test(`decodes the desktop pairing code for ${payload.url}`, () => {
    assert.deepEqual(decodePairing(encoded), payload);
  });
}

for (const { why, encoded } of pairing.invalid) {
  test(`rejects: ${why}`, () => {
    assert.throws(() => decodePairing(encoded));
  });
}

test('tolerates surrounding whitespace from the scanner', () => {
  const { payload, encoded } = pairing.valid[0];
  assert.deepEqual(decodePairing(`  ${encoded}\n`), payload);
});

test('a non-pairing QR gets a human message', () => {
  assert.throws(() => decodePairing('https://example.com'), /Not a Command Center pairing code/);
});

test('describePairing shows where the phone will connect, never the token', () => {
  const { payload } = pairing.valid[0];
  const text = describePairing(payload);
  assert.match(text, /100\.101\.102\.103:47820/);
  assert.ok(!text.includes(payload.token));
});
