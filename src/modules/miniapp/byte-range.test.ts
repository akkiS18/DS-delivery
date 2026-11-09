import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRange } from './byte-range.js';

test('no or unknown Range header: the whole file', () => {
  assert.deepEqual(parseRange(undefined, 100), { kind: 'full' });
  assert.deepEqual(parseRange('items=0-5', 100), { kind: 'full' });
  assert.deepEqual(parseRange('bytes=0-5,10-20', 100), { kind: 'full' });
  assert.deepEqual(parseRange('bytes=-', 100), { kind: 'full' });
  assert.deepEqual(parseRange('bytes=abc', 100), { kind: 'full' });
});

test('a closed range, an open range and a suffix range', () => {
  assert.deepEqual(parseRange('bytes=0-15', 100), { kind: 'partial', start: 0, end: 15 });
  assert.deepEqual(parseRange('bytes=90-', 100), { kind: 'partial', start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=-10', 100), { kind: 'partial', start: 90, end: 99 });
});

test('an end past the file is cut to the last byte; a suffix longer than the file is the whole file as a range', () => {
  assert.deepEqual(parseRange('bytes=50-500', 100), { kind: 'partial', start: 50, end: 99 });
  assert.deepEqual(parseRange('bytes=-500', 100), { kind: 'partial', start: 0, end: 99 });
});

test('a start beyond the file is unsatisfiable (416), an end before the start is ignored', () => {
  assert.deepEqual(parseRange('bytes=100-', 100), { kind: 'unsatisfiable' });
  assert.deepEqual(parseRange('bytes=500-600', 100), { kind: 'unsatisfiable' });
  assert.deepEqual(parseRange('bytes=-0', 100), { kind: 'unsatisfiable' });
  assert.deepEqual(parseRange('bytes=0-5', 0), { kind: 'unsatisfiable' });
  assert.deepEqual(parseRange('bytes=5-2', 100), { kind: 'full' });
});
