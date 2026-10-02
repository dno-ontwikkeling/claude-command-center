'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRingBuffer, safeStart } = require('../ringbuffer');

test('empty buffer snapshots to empty data and lastSeq 0', () => {
  const rb = createRingBuffer({ cap: 100 });
  assert.deepEqual(rb.snapshot(), { data: '', lastSeq: 0 });
});

test('append returns a monotonic seq and snapshot joins chunks in order', () => {
  const rb = createRingBuffer({ cap: 100 });
  assert.equal(rb.append('ab'), 1);
  assert.equal(rb.append('cd'), 2);
  assert.deepEqual(rb.snapshot(), { data: 'abcd', lastSeq: 2 });
});

test('stays within cap and keeps the newest output', () => {
  const rb = createRingBuffer({ cap: 10 });
  for (let i = 0; i < 20; i++) rb.append(String(i % 10));
  const { data, lastSeq } = rb.snapshot();
  assert.ok(data.length <= 10, `length ${data.length}`);
  assert.ok(data.endsWith('9'));
  assert.equal(lastSeq, 20);
});

test('a single chunk larger than cap keeps its tail', () => {
  const rb = createRingBuffer({ cap: 5 });
  rb.append('abcdefghij');
  assert.equal(rb.snapshot().data, 'fghij');
});

test('trimming prefers to start at the next line boundary', () => {
  const rb = createRingBuffer({ cap: 12 });
  rb.append('first line\nsecond\n');
  // cut lands mid "first line"; should advance past the newline
  assert.equal(rb.snapshot().data, 'second\n');
});

test('trimming never starts on a low surrogate (split emoji)', () => {
  const s = 'x😀😀😀';
  // cut between the high and low surrogate of the first emoji
  const i = safeStart(s, 2);
  assert.notEqual(s.charCodeAt(i) & 0xfc00, 0xdc00);
});

test('trimming never starts inside a CSI sequence', () => {
  const s = 'aaaa\x1b[38;5;196mRED';
  for (let cut = 5; cut < 14; cut++) {
    const i = safeStart(s, cut);
    assert.ok(i >= 15, `cut ${cut} -> ${i} still inside CSI`);
  }
});

test('trimming never starts inside an OSC sequence (BEL or ST terminated)', () => {
  const bel = 'zz\x1b]0;window title\x07after';
  assert.equal(bel.slice(safeStart(bel, 6)), 'after');
  const st = 'zz\x1b]8;;http://x\x1b\\link';
  assert.equal(st.slice(safeStart(st, 6)), 'link');
});

test('a cut outside any escape sequence is left alone', () => {
  const s = '\x1b[0mplain text here';
  assert.equal(safeStart(s, 8), 8);
});

test('clear empties the buffer but seq stays monotonic', () => {
  const rb = createRingBuffer({ cap: 100 });
  rb.append('a');
  rb.append('b');
  rb.clear();
  assert.deepEqual(rb.snapshot(), { data: '', lastSeq: 2 });
  assert.equal(rb.append('c'), 3);
});

test('default cap is 512 KB', () => {
  const rb = createRingBuffer();
  rb.append('x'.repeat(600 * 1024));
  assert.equal(rb.snapshot().data.length, 512 * 1024);
});
