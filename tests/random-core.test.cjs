const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../random-core.js');

test('randomBelow stays within the requested inclusive rank domain', () => {
  for (const limit of [1n, 2n, 3n, 10n, 2n ** 53n, 2n ** 64n - 1n]) {
    for (let i = 0; i < 100; i++) { const value = core.randomBelow(limit); assert.ok(value >= 0n && value < limit); }
  }
  assert.throws(() => core.randomBelow(0n));
});

test('integer selection respects negative bounds and exclusions', () => {
  for (let i = 0; i < 100; i++) { const value = core.randomInteger(-4, 4, [-4, 0, 4]); assert.ok(value >= -3 && value <= 3 && value !== 0); }
  assert.throws(() => core.randomInteger(1, 2, [1, 2]), /исключены/);
});

test('unique selection terminates, excludes values, and reports an exhausted pool', () => {
  const values = core.uniqueNumbers(-3, 4, 5, [-3, 0, 4]);
  assert.equal(values.length, 5); assert.equal(new Set(values).size, 5);
  assert.ok(values.every(n => n >= -3 && n <= 4 && ![-3, 0, 4].includes(n)));
  assert.throws(() => core.uniqueNumbers(1, 2, 2, [1]), /Недостаточно/);
});

test('Fisher-Yates shuffle preserves every item exactly once', () => {
  const input = ['a', 'b', 'c', 'd']; const output = core.secureShuffle(input);
  assert.deepEqual([...output].sort(), [...input].sort()); assert.deepEqual(input, ['a','b','c','d']);
});

test('weighted draws respect zero weights and include boosted values', () => {
  const weights = new Map([[2n, 1000], [4n, 0]]); let sawBoosted = false;
  for (let i = 0; i < 100; i++) { const value = core.weightedInteger(1n, 5n, [], weights); assert.notEqual(value, 4); if (value === 2) sawBoosted = true; }
  assert.ok(sawBoosted);
  assert.throws(() => core.weightedInteger(4n, 4n, [], weights), /Нет доступных/);
});
