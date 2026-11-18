function isDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function monthStart(dateKey) {
  return `${dateKey.slice(0, 7)}-01`;
}

function nextMonthStart(dateKey) {
  const date = new Date(`${monthStart(dateKey)}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

function billDueDate(month, dueDay) {
  const monthKey = month.slice(0, 7);
  const [year, monthNumber] = monthKey.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const day = Math.min(Number(dueDay), lastDay);
  return `${monthKey}-${String(day).padStart(2, '0')}`;
}

function buildMonthlyOutlook({
  allowance, income, expenses, paidBills, unpaidBills, savingsContributions = 0,
  savingsWithdrawals = 0, elapsedDays, daysInMonth,
}) {
  const actualExpenses = Number(expenses || 0);
  const paidBillExpenses = Number(paidBills || 0);
  const reservedBills = Number(unpaidBills || 0);
  const contributions = Number(savingsContributions || 0);
  const withdrawals = Number(savingsWithdrawals || 0);
  const netSavings = contributions - withdrawals;
  const variableExpenses = Math.max(0, actualExpenses - paidBillExpenses);
  const projectedMonthEnd = paidBillExpenses +
    (variableExpenses / Math.max(1, Number(elapsedDays) || 1)) * Number(daysInMonth) +
    reservedBills;
  const availableFunds = allowance == null ? null : Number(allowance) + Number(income || 0);
  return {
    variableExpenses,
    savingsContributions: contributions,
    savingsWithdrawals: withdrawals,
    netSavings,
    projectedMonthEnd: Math.round(projectedMonthEnd * 100) / 100,
    projectedRemaining: availableFunds == null
      ? null
      : Math.round((availableFunds - projectedMonthEnd - netSavings) * 100) / 100,
    balance: availableFunds == null
      ? null
      : Math.round((availableFunds - actualExpenses - reservedBills - netSavings) * 100) / 100,
  };
}

module.exports = { isDateKey, monthStart, nextMonthStart, billDueDate, buildMonthlyOutlook };
