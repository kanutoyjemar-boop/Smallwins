const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isDateKey, monthStart, nextMonthStart, billDueDate, buildMonthlyOutlook,
} = require('../utils/monthly-cashflow');

test('monthly cash flow accepts only real ISO date keys and finds the month start', () => {
  assert.equal(isDateKey('2024-02-29'), true);
  assert.equal(isDateKey('2026-02-29'), false);
  assert.equal(isDateKey('2026-13-01'), false);
  assert.equal(isDateKey('2026-09-01T00:00:00Z'), false);
  assert.equal(monthStart('2026-11-09'), '2026-11-01');
  assert.equal(nextMonthStart('2026-12-01'), '2027-01-01');
});

test('recurring bills clamp their due date to the final day of shorter months', () => {
  assert.equal(billDueDate('2026-02', 31), '2026-02-28');
  assert.equal(billDueDate('2024-02', 31), '2024-02-29');
  assert.equal(billDueDate('2026-04', 30), '2026-04-30');
  assert.equal(billDueDate('2026-04', 12), '2026-04-12');
  assert.equal(billDueDate('2026-02-01', 31), '2026-02-28');
});

test('monthly outlook keeps unpaid bills out of actual spending and reserves them in the forecast', () => {
  const outlook = buildMonthlyOutlook({
    allowance: 30000,
    income: 2500,
    expenses: 10000,
    paidBills: 4000,
    unpaidBills: 3000,
    elapsedDays: 10,
    daysInMonth: 30,
  });
  assert.equal(outlook.variableExpenses, 6000);
  assert.equal(outlook.projectedMonthEnd, 25000);
  assert.equal(outlook.projectedRemaining, 7500);
  assert.equal(outlook.balance, 19500);
});

test('savings allocations reduce available funds while withdrawals restore them without counting as income', () => {
  const outlook = buildMonthlyOutlook({
    allowance: 30000,
    income: 2500,
    expenses: 10000,
    paidBills: 4000,
    unpaidBills: 3000,
    savingsContributions: 2500,
    savingsWithdrawals: 500,
    elapsedDays: 10,
    daysInMonth: 30,
  });
  assert.equal(outlook.savingsContributions, 2500);
  assert.equal(outlook.savingsWithdrawals, 500);
  assert.equal(outlook.netSavings, 2000);
  assert.equal(outlook.balance, 17500);
  assert.equal(outlook.projectedRemaining, 5500);
});
