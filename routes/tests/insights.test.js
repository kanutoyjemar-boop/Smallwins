const test = require('node:test');
const assert = require('node:assert/strict');
const { computeWeekSummary } = require('../utils/insights');

test('computeWeekSummary counts active days and finds the best day', () => {
  const summary = computeWeekSummary([
    { date: '2026-09-09', percentage: 81 },
    { date: '2026-09-10', percentage: 92 },
    { date: '2026-09-11', percentage: null },
    { date: '2026-09-12', percentage: 75 },
    { date: '2026-09-13', percentage: 88 },
    { date: '2026-09-14', percentage: 74 },
    { date: '2026-09-15', percentage: 96 },
  ]);

  assert.equal(summary.activeDays, 6);
  assert.equal(summary.average, 84);
  assert.equal(summary.bestDay, '2026-09-15');
  assert.equal(summary.completionRate, 86);
});
