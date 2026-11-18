const test = require('node:test');
const assert = require('node:assert/strict');
const { computeDailySummary, rate } = require('../utils/scoring');

const day = {
  tasks: [{ period: 'AM', points: 10, done: true }],
  workouts: [{ points: 20, done: false }],
  diet: [],
  schedule: [],
  budget: { daily_limit: 100 },
  totalSpent: 20,
};

test('default scoring weights preserve the existing score calculation', () => {
  const summary = computeDailySummary(day);
  assert.equal(summary.earned, 25);
  assert.equal(summary.possible, 45);
  assert.equal(summary.percentage, 55.6);
});

test('personal scoring weights change priorities and can exclude an area', () => {
  const summary = computeDailySummary({
    ...day,
    weights: { tasks: 3, workouts: 0, diet: 1, schedule: 1, money: 0 },
  });
  assert.equal(summary.earned, 30);
  assert.equal(summary.possible, 30);
  assert.equal(summary.percentage, 100);
});

test('a budget excluded from scoring contributes no possible points', () => {
  const summary = computeDailySummary({
    ...day,
    weights: { tasks: 1, workouts: 1, diet: 1, schedule: 1, money: 0 },
  });
  assert.equal(summary.possible, 30);
  assert.equal(summary.percentage, 33.3);
});

test('low scores use non-judgmental wording while empty days stay unscored', () => {
  assert.equal(rate(0), 'Room to Adjust');
  assert.equal(rate(null), 'No data');
});
