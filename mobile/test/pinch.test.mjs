import { test } from 'node:test';
import assert from 'node:assert/strict';
import { touchDistance, fontSizeFromPinch } from '../www/js/pinch.mjs';

test('touchDistance is the euclidean distance between two touches', () => {
  assert.equal(touchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 }), 5);
});

test('pinching out grows the font, pinching in shrinks it, rounded', () => {
  assert.equal(fontSizeFromPinch(11, 1), 11);
  assert.equal(fontSizeFromPinch(11, 1.5), 17);
  assert.equal(fontSizeFromPinch(12, 0.5), 8);
});

test('result stays within the phone settings range (8-24)', () => {
  assert.equal(fontSizeFromPinch(11, 10), 24);
  assert.equal(fontSizeFromPinch(11, 0.01), 8);
});

test('a degenerate scale keeps the start size', () => {
  assert.equal(fontSizeFromPinch(11, 0), 11);
  assert.equal(fontSizeFromPinch(11, NaN), 11);
  assert.equal(fontSizeFromPinch(11, Infinity), 11);
});
