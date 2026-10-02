import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionCode } from '../scripts/version-code.mjs';

test('maps semver to major*10000 + minor*100 + patch', () => {
  assert.equal(versionCode('0.1.0'), 100);
  assert.equal(versionCode('1.2.3'), 10203);
  assert.equal(versionCode('12.99.99'), 129999);
});

test('accepts a leading v', () => {
  assert.equal(versionCode('v1.2.3'), 10203);
});

test('is monotonic across normal bumps', () => {
  const order = ['0.1.0', '0.1.1', '0.2.0', '0.99.99', '1.0.0', '1.0.1', '2.0.0'];
  const codes = order.map(versionCode);
  for (let i = 1; i < codes.length; i++) assert.ok(codes[i] > codes[i - 1], `${order[i]} > ${order[i - 1]}`);
});

test('rejects minor or patch >= 100 (would break monotonicity)', () => {
  assert.throws(() => versionCode('1.100.0'), /minor/);
  assert.throws(() => versionCode('1.0.100'), /patch/);
});

test('rejects 0.0.0 (versionCode must be >= 1) and malformed input', () => {
  assert.throws(() => versionCode('0.0.0'));
  for (const bad of ['', '1.2', '1.2.3.4', 'a.b.c', '1.2.3-beta', undefined]) {
    assert.throws(() => versionCode(bad), `should reject ${bad}`);
  }
});

test('rejects codes beyond the Android maximum (2100000000)', () => {
  assert.equal(versionCode('210000.0.0'), 2100000000);
  assert.throws(() => versionCode('210000.0.1'));
});
