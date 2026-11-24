const test = require('node:test');
const assert = require('node:assert/strict');
const { computeBadges } = require('../utils/streaks');

test('computeBadges unlocks streak, perfect-day and level badges', () => {
  const ids = (s, t) => computeBadges(s, t).map((b) => b.id);
  assert.deepEqual(ids({ streak: 0, excellentDays: 0, perfectDays: 0 }, { level: 1 }), []);
  assert.deepEqual(ids({ streak: 3, excellentDays: 0, perfectDays: 0 }, { level: 1 }), ['streak_3']);
  assert.deepEqual(
    ids({ streak: 7, excellentDays: 5, perfectDays: 1 }, { level: 5 }),
    ['streak_3', 'streak_7', 'excellent_5', 'perfect_1', 'level_5']
  );
});
