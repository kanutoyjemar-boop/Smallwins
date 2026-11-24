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
  const scored = buildAchievementCardContent(dashboardData(), '2026-11-10', '@alex_1', {
    avatar: 'data:image/jpeg;base64,ZmFrZQ==',
  });
  assert.equal(scored.brand, 'SMALL WINS');
  assert.equal(scored.mark, 'SW');
  assert.equal(scored.score, '82.5');
  assert.equal(scored.rating, 'Great');
  assert.equal(scored.date, 'Tuesday, November 10');
  assert.equal(scored.username, '@alex_1');
  assert.equal(scored.avatar, 'data:image/jpeg;base64,ZmFrZQ==');
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
  assert.equal(noScore.avatar, '');
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

test('card shows a streak only for today and only when it is a real streak of 2+', () => {
  assert.equal(buildAchievementCardContent(dashboardData({ streak: 12 }), '2026-11-10', 'Alex').streak, 12);
  assert.equal(buildAchievementCardContent(dashboardData({ streak: 1 }), '2026-11-10', 'Alex').streak, null);
  assert.equal(buildAchievementCardContent(dashboardData({ streak: 12 }), '2026-11-09', 'Alex').streak, null);
  assert.match(buildShareMessage(dashboardData({ streak: 12 }), '2026-11-10', 'Alex'), /12-day streak\./);
  assert.doesNotMatch(buildShareMessage(dashboardData({ streak: 12 }), '2026-11-09', 'Alex'), /streak/);
});

test('card counts only real completions and carries the real last-7-day scores', () => {
  const past = [
    { date: '2026-11-04', percentage: 40 }, { date: '2026-11-05', percentage: null },
    { date: '2026-11-06', percentage: 70 }, { date: '2026-11-07', percentage: 85 },
    { date: '2026-11-08', percentage: 90 }, { date: '2026-11-09', percentage: 60 },
    { date: '2026-11-10', percentage: 82.5 },
  ];
  const card = buildAchievementCardContent(dashboardData(), '2026-11-10', 'Alex', { past, link: 'https://app.example.com/?ref=alex' });
  assert.equal(card.winsCount, 5);
  assert.equal(card.past.length, 7);
  assert.equal(card.past[1].percentage, null);
  assert.equal(card.linkLabel, 'app.example.com/?ref=alex');
});

test('hook line is deterministic per day and matches how the day actually went', () => {
  const strong = buildAchievementCardContent(dashboardData({ summary: { percentage: 95, rating: 'Excellent' } }), '2026-11-10', 'A');
  const again = buildAchievementCardContent(dashboardData({ summary: { percentage: 95, rating: 'Excellent' } }), '2026-11-10', 'A');
  assert.equal(strong.hook, again.hook);
  const none = buildAchievementCardContent(dashboardData({ summary: { percentage: null, rating: 'No data' }, tasks: [], workouts: [], diet: [], schedule: [] }), '2026-11-10', 'A');
  assert.doesNotMatch(none.hook, /win\.|streak|Excellent/i);
});

test('share link carries the member referral tag and caption includes it', () => {
  const link = 'https://app.example.com/?ref=alex_1';
  assert.match(buildShareMessage(dashboardData(), '2026-11-10', 'Alex', { link }), /Try it: https:\/\/app\.example\.com\/\?ref=alex_1/);
  assert.doesNotMatch(buildShareMessage(dashboardData(), '2026-11-10', 'Alex', { link }), /Private task|9876/);
});
