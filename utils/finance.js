function buildFinanceSummary(rows = []) {
  const income = rows
    .filter((row) => row && row.kind === 'income')
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const expenses = rows
    .filter((row) => row && row.kind === 'expense')
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const net = income - expenses;
  const savingsRate = income > 0 ? Math.round((net / income) * 100) : 0;
  const spendingDays = rows.filter((row) => row && row.kind === 'expense').length;

  return {
    income,
    expenses,
    net,
    savingsRate,
    spendingDays,
  };
}

function buildFinanceBreakdown(rows = []) {
  const byCategory = {};
  for (const row of rows.filter((r) => r && r.kind === 'expense')) {
    const category = row.category || 'Other';
    byCategory[category] = (byCategory[category] || 0) + Number(row.amount || 0);
  }

  return Object.entries(byCategory)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

module.exports = { buildFinanceSummary, buildFinanceBreakdown };
