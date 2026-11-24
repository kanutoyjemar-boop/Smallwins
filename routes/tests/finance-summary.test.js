const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFinanceSummary } = require('../utils/finance');

test('buildFinanceSummary totals income, expenses, net and savings rate correctly', () => {
  const summary = buildFinanceSummary([
    { expense_date: '2026-09-05', kind: 'income', amount: 5000 },
    { expense_date: '2026-09-06', kind: 'expense', amount: 1200 },
    { expense_date: '2026-09-06', kind: 'expense', amount: 350 },
    { expense_date: '2026-09-08', kind: 'income', amount: 1000 },
    { expense_date: '2026-09-10', kind: 'expense', amount: 800 },
  ]);

  assert.equal(summary.income, 6000);
  assert.equal(summary.expenses, 2350);
  assert.equal(summary.net, 3650);
  assert.equal(summary.savingsRate, 61);
  assert.equal(summary.spendingDays, 3);
});
