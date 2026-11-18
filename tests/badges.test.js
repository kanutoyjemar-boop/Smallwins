const test = require('node:test');
const assert = require('node:assert/strict');
const { computeBadges, badgeIcon } = require('../utils/streaks');

const stats = (over = {}) => ({ streak: 0, bestStreak: 0, excellentDays: 0, greatOrBetterDays: 0, perfectDays: 0, ...over });

test('computeBadges awards streak, perfect-day and level badges', () => {
  const ids = computeBadges(stats({ streak: 7, perfectDays: 1 }), { level: 5 }).map((b) => b.id);
  assert.deepEqual(ids, ['streak_3', 'streak_7', 'perfect_1', 'level_5']);
});

test('computeBadges awards nothing for a brand-new account', () => {
  assert.deepEqual(computeBadges(stats(), { level: 1 }), []);
});

test('badgeIcon resolves known milestones and falls back for unknown ones', () => {
  assert.equal(badgeIcon('perfect_1'), '💯');
  assert.equal(badgeIcon('some_retired_badge'), '🏅');
});
