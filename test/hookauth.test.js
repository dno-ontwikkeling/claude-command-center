'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { agentSecret, secretMatches, eventHasReport } = require('../hookauth');

const MASTER = 'deadbeef'.repeat(8);

test('agentSecret is deterministic for the same master+id', () => {
  assert.equal(agentSecret(MASTER, 'agent-1'), agentSecret(MASTER, 'agent-1'));
});

test('agentSecret differs per agent id', () => {
  assert.notEqual(agentSecret(MASTER, 'agent-1'), agentSecret(MASTER, 'agent-2'));
});

test('agentSecret differs per master (an agent cannot derive another master)', () => {
  assert.notEqual(agentSecret(MASTER, 'agent-1'), agentSecret('another-master', 'agent-1'));
});

test('secretMatches accepts the correct token', () => {
  const tok = agentSecret(MASTER, 'agent-1');
  assert.equal(secretMatches(tok, tok), true);
});

test('secretMatches rejects a wrong token, missing token, and length mismatch', () => {
  const tok = agentSecret(MASTER, 'agent-1');
  assert.equal(secretMatches(agentSecret(MASTER, 'agent-2'), tok), false);
  assert.equal(secretMatches(undefined, tok), false);
  assert.equal(secretMatches('', tok), false);
  assert.equal(secretMatches('short', tok), false);
});

test('eventHasReport detects a report.js command in hook entries', () => {
  const entries = [{ hooks: [{ type: 'command', command: 'node "/x/report.js" busy' }] }];
  assert.equal(eventHasReport(entries), true);
});

test('eventHasReport is false for empty/unrelated entries', () => {
  assert.equal(eventHasReport(undefined), false);
  assert.equal(eventHasReport([]), false);
  assert.equal(eventHasReport([{ hooks: [{ type: 'command', command: 'echo hi' }] }]), false);
  assert.equal(eventHasReport([{ hooks: [] }]), false);
});
