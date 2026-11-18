const test = require('node:test');
const assert = require('node:assert/strict');

global.DateUtil = {
  today: () => '2026-11-10',
  label: (date) => date === '2026-11-10' ? 'Tuesday, November 10' : 'Wednesday, November 11',
};
const {
  buildAchievementCardContent,
  buildShareMessage,
  buildShareStats,
} = require('../public/js/pages/dashboard');

function dashboardData(overrides = {}) {
  return {
    summary: { percentage: 82.5, rating: 'Great' },
    tasks: [
      { done: true, title: 'Private task name' },
      { done: false, title: 'Another private task' },
    ],
    workouts: [{ done: true }],
    diet: [{ eaten: true }, { eaten: true }, { eaten: false }],
    schedule: [{ status: 'overtime' }, { status: 'pending' }],
    totalSpent: 9876,
    budget: { daily_limit: 100 },
    ...overrides,
  };
}

test('share metrics report actual completions and omit empty categories', () => {
  assert.deepEqual(buildShareStats(dashboardData()), [
    { label: 'Tasks', done: 1, total: 2 },
    { label: 'Workouts', done: 1, total: 1 },
    { label: 'Meals', done: 2, total: 3 },
    { label: 'Agenda', done: 1, total: 2 },
  ]);
  assert.deepEqual(buildShareStats(dashboardData({
    workouts: [],
    diet: [],
    schedule: [],
  })), [{ label: 'Tasks', done: 1, total: 2 }]);
  assert.deepEqual(buildShareStats(dashboardData({
    tasks: [{ done: true }],
    workouts: [{ done: false }],
    diet: [{ eaten: false }],
    schedule: [{ status: 'pending' }],
  })), [{ label: 'Tasks', done: 1, total: 1 }]);
});

test('share card uses Small Wins branding, developer credit, and clear no-score content', () => {
  const scored = buildAchievementCardContent(dashboardData(), '2026-11-10', 'Alex Rivera');
  assert.equal(scored.brand, 'SMALL WINS');
  assert.equal(scored.mark, 'SW');
  assert.equal(scored.score, '82.5');
  assert.equal(scored.rating, 'Great');
  assert.equal(scored.date, 'Tuesday, November 10');
  assert.equal(scored.username, 'Alex Rivera');
  assert.equal(scored.developer, 'Developed by Your Trusted Guy');
  assert.equal(scored.invitation, 'Want to make progress too? Start with Small Wins.');
  assert.equal(scored.hashtag, '#SmallWins');

  const noScore = buildAchievementCardContent(dashboardData({
    summary: { percentage: null, rating: 'No data' },
    tasks: [],
    workouts: [],
    diet: [],
    schedule: [],
  }), '2026-11-11');
  assert.equal(noScore.score, null);
  assert.equal(noScore.kicker, 'YOUR NEXT WIN STARTS HERE');
  assert.equal(noScore.rating, 'A fresh start is still progress.');
  assert.deepEqual(noScore.stats, []);
});

test('caption accurately describes the selected day and keeps private details out', () => {
  const caption = buildShareMessage(dashboardData(), '2026-11-10');
  assert.match(caption, /Today: My Small Wins score: 82\.5% \(Great\)\./);
  assert.match(caption, /1\/2 tasks · 1\/1 workouts · 2\/3 meals · 1\/2 agenda/);
  assert.match(caption, /Want to make progress too\? Start with Small Wins\./);
  assert.match(caption, /#SmallWins #DailyProgress/);
  assert.doesNotMatch(caption, /Private task|9876|budget/i);
});

test('share caption identifies the account name and selected weekday', () => {
  const caption = buildShareMessage(dashboardData({
    tasks: [{ done: true }],
    workouts: [{ done: false }],
    diet: [{ eaten: false }],
    schedule: [{ status: 'pending' }],
  }), '2026-11-11', 'Alex Rivera');
  assert.match(caption, /Wednesday, November 11/);
  assert.match(caption, /1\/1 tasks/);
  assert.doesNotMatch(caption, /workouts|meals|agenda/i);
  assert.match(caption, /— Alex Rivera\./);
});

test('no-plan caption does not claim a score or completed day', () => {
  const caption = buildShareMessage(dashboardData({
    summary: { percentage: null, rating: 'No data' },
    tasks: [],
    workouts: [],
    diet: [],
    schedule: [],
  }), '2026-11-11');
  assert.match(caption, /Wednesday, November 11: A fresh start is still progress\. — Small Wins member\./);
  assert.match(caption, /Want to make progress too\? Start with Small Wins\./);
  assert.doesNotMatch(caption, /completed|NaN|%/i);
});
