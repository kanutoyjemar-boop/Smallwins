const test = require('node:test');
const assert = require('node:assert/strict');
const { computeWeekSummary, weeklyRecap, recoveryNextStep } = require('../utils/insights');

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

test('weeklyRecap highlights a strength and offers one manageable growth step', () => {
  const recap = weeklyRecap([{
    percentage: 80,
    am: { earned: 10, possible: 10 },
    pm: { earned: 0, possible: 0 },
    workout: { earned: 0, possible: 20 },
    diet: { earned: 5, possible: 10 },
    schedule: { earned: 0, possible: 0 },
    money: { earned: 0, possible: 0 },
  }]);

  assert.match(recap.win, /tasks especially well \(100%\)/);
  assert.match(recap.nextStep, /one small, manageable step/);
});

test('weeklyRecap stays encouraging when there are no scored areas', () => {
  const recap = weeklyRecap([{ percentage: null }]);
  assert.match(recap.win, /fresh week/);
  assert.match(recap.nextStep, /one small, realistic thing/);
});

test('weeklyRecap respects areas excluded from personal scoring', () => {
  const recap = weeklyRecap([{
    percentage: 80,
    am: { earned: 0, possible: 10 },
    pm: { earned: 0, possible: 0 },
    workout: { earned: 0, possible: 20 },
    diet: { earned: 10, possible: 10 },
    schedule: { earned: 0, possible: 0 },
    money: { earned: 0, possible: 0 },
  }], { tasks: 0, workouts: 0, diet: 1, schedule: 0, money: 0 });

  assert.match(recap.win, /meals especially well \(100%\)/);
  assert.match(recap.nextStep, /Keep your plan at a pace/);
});

test('recovery coach offers a gentle, non-clinical suggestion only after enough check-ins', () => {
  assert.equal(recoveryNextStep({ checkins: 2, averageStress: 5 }), null);
  assert.match(recoveryNextStep({ checkins: 4, averageStress: 4.2 }), /make room for one pause/);
  assert.match(recoveryNextStep({ checkins: 3, averageStress: 2, averageSleep: 6 }), /wind-down change/);
  assert.equal(recoveryNextStep({ checkins: 4, averageStress: 2, averageSleep: 7, averageEnergy: 4 }), null);
});
