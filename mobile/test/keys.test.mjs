import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keySequence, ctrlOf, applyCtrl, EXTRA_KEYS, isTap, TAP_SLOP_PX } from '../www/js/keys.mjs';

test('extra keys send the standard terminal sequences', () => {
  assert.equal(keySequence('esc'), '\x1b');
  assert.equal(keySequence('tab'), '\t');
  assert.equal(keySequence('shift-tab'), '\x1b[Z');
  assert.equal(keySequence('enter'), '\r');
  // Claude Code reads ESC+CR as "insert newline" (the desktop maps Ctrl+Enter to it).
  assert.equal(keySequence('newline'), '\x1b\r');
  assert.equal(keySequence('up'), '\x1b[A');
  assert.equal(keySequence('down'), '\x1b[B');
  assert.equal(keySequence('right'), '\x1b[C');
  assert.equal(keySequence('left'), '\x1b[D');
});

test('arrows switch to SS3 form in application cursor mode', () => {
  assert.equal(keySequence('up', { appCursor: true }), '\x1bOA');
  assert.equal(keySequence('left', { appCursor: true }), '\x1bOD');
  assert.equal(keySequence('esc', { appCursor: true }), '\x1b');
});

test('unknown keys send nothing', () => {
  assert.equal(keySequence('hyper'), '');
});

test('every key on the bar has a label and a sequence (ctrl is a latch)', () => {
  for (const k of EXTRA_KEYS) {
    assert.ok(k.label, k.id);
    if (k.id !== 'ctrl') assert.ok(keySequence(k.id), k.id);
  }
  assert.ok(EXTRA_KEYS.some((k) => k.id === 'ctrl'));
});

test('ctrlOf maps letters and the classic symbols to control codes', () => {
  assert.equal(ctrlOf('c'), '\x03');
  assert.equal(ctrlOf('C'), '\x03');
  assert.equal(ctrlOf('a'), '\x01');
  assert.equal(ctrlOf('z'), '\x1a');
  assert.equal(ctrlOf('['), '\x1b');
  assert.equal(ctrlOf(' '), '\x00');
  assert.equal(ctrlOf('?'), '\x7f');
  assert.equal(ctrlOf('1'), null);
});

test('applyCtrl consumes the latch only for a single mappable character', () => {
  assert.deepEqual(applyCtrl('c', true), { data: '\x03', consumed: true });
  assert.deepEqual(applyCtrl('c', false), { data: 'c', consumed: false });
  // Pasted text or an unmappable key passes through and keeps the latch.
  assert.deepEqual(applyCtrl('hello', true), { data: 'hello', consumed: false });
  assert.deepEqual(applyCtrl('1', true), { data: '1', consumed: false });
});

test('a key press is a tap only when the finger barely moved', () => {
  assert.equal(isTap(0, 0), true);
  assert.equal(isTap(3, -4), true);
  assert.equal(isTap(TAP_SLOP_PX, 0), true);
  assert.equal(isTap(TAP_SLOP_PX + 1, 0), false); // scrolling the bar
  assert.equal(isTap(0, -40), false);
});
