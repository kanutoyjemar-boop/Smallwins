const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBackup, asDate } = require('../utils/backup');

test('asDate accepts real dates and strips ISO timestamps, rejects junk', () => {
  assert.equal(asDate('2026-09-15'), '2026-09-15');
  assert.equal(asDate('2026-09-15T16:00:00.000Z'), '2026-09-15');
  assert.equal(asDate('2026-02-31'), null);
  assert.equal(asDate('tomorrow'), null);
  assert.equal(asDate(20260915), null);
});

test('normalizeBackup keeps valid rows and counts invalid ones as skipped', () => {
  const { data, accepted, skipped } = normalizeBackup({
    tasks: [
      { task_date: '2026-09-15', period: 'AM', title: ' Stretch ', done: 1, points: 15 },
      { task_date: '2026-09-15', period: 'noon', title: 'bad period' },
      { task_date: 'nope', period: 'PM', title: 'bad date' },
      null,
    ],
    expenses: [{ expense_date: '2026-09-15', title: 'Coffee', amount: '120.456', kind: 'income' }, { expense_date: '2026-09-15', title: 'x', amount: -5 }],
    schedule: [{ item_date: '2026-09-15', title: 'Gym', start_time: '07:30:00', status: 'weird' }],
    goals: [{ goal_date: '2026-09-15', title: 'Read', target: 3, progress: 3 }],
    reflections: [{ entry_date: '2026-09-15', mood: 'angry', note: 'ok' }],
    routines: [{ name: 'Empty', kind: 'tasks', items: [] }, { name: 'Day', kind: 'tasks', items: [{ period: 'AM', title: 'a' }] }],
    milestones: [{ milestone_key: 'streak_3', label: '3-Day Streak', achieved_at: '2026-09-10T00:00:00Z' }],
  });

  assert.deepEqual(data.tasks, [{ task_date: '2026-09-15', period: 'AM', title: 'Stretch', done: true, points: 15 }]);
  assert.equal(data.expenses.length, 1);
  assert.equal(data.expenses[0].amount, 120.46);
  assert.equal(data.expenses[0].kind, 'income');
  assert.equal(data.schedule[0].status, 'pending');
  assert.equal(data.goals[0].completed, true);
  assert.equal(data.reflections[0].mood, 'steady');
  assert.equal(data.routines.length, 1);
  assert.equal(data.milestones[0].achieved_at, '2026-09-10T00:00:00.000Z');
  assert.equal(accepted, 7);
  assert.equal(skipped, 5);
});

test('normalizeBackup tolerates garbage payloads', () => {
  for (const bad of [null, undefined, 'x', 42, [], {}, { tasks: 'nope' }]) {
    assert.equal(normalizeBackup(bad).accepted, 0);
  }
});
