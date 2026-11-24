const test = require('node:test');
const assert = require('node:assert/strict');
const { addDays, todayKey, toDateKey } = require('../utils/date');

test('addDays moves forward and backward safely', () => {
  assert.equal(addDays('2026-09-15', 1), '2026-09-16');
  assert.equal(addDays('2026-09-15', -1), '2026-09-14');
});

test('todayKey stays in YYYY-MM-DD format', () => {
  const key = todayKey();
  assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
});

test('toDateKey converts a Date instance without UTC drift', () => {
  const local = new Date(2026, 8, 15, 12, 0, 0);
  assert.equal(toDateKey(local), '2026-09-15');
});
