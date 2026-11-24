const PageMoney = (() => {
  const CATEGORIES = ['Food', 'Transport', 'Bills', 'Shopping', 'Health', 'Entertainment', 'Salary', 'Freelance', 'Other'];
  let range = 'month';

  async function render(el) {
    const date = AppState.date;
    const [{ expenses, budget }, summary] = await Promise.all([
      Api.get(`/money?date=${date}`),
      Api.get(`/money/summary?date=${date}&range=${range}`),
    ]);

    el.innerHTML = template(date, expenses, budget, summary);
    wire(el, date);
  }

  function template(date, expenses, budget, summary) {
    const spent = Number(summary.expenses || 0);
    const income = Number(summary.income || 0);
    const net = Number(summary.net || 0);
    const limit = budget ? Number(budget.daily_limit) : null;
    const pct = limit ? Math.min(100, Math.round((expenses.filter((e) => e.kind === 'expense').reduce((s, e) => s + Number(e.amount), 0) / limit) * 100)) : 0;
    const overBudget = limit != null && expenses.filter((e) => e.kind === 'expense').reduce((s, e) => s + Number(e.amount), 0) > limit;

    return `
      <div class="date-nav">
        <button data-nav="-1">‹</button>
        <div class="date-label">${DateUtil.label(date)}</div>
        <button data-nav="1">›</button>
      </div>

      <div class="tabs money-tabs">
        ${['day', 'week', 'month', 'year'].map((period) => `<div class="tab ${period === range ? 'active' : ''}" data-range="${period}">${period === 'day' ? 'Daily' : period === 'week' ? 'Weekly' : period === 'month' ? 'Monthly' : 'Yearly'}</div>`).join('')}
      </div>

      <div class="finance-shell">
        <div class="finance-summary-grid">
          <div class="finance-card finance-income">
            <span class="finance-label">Income</span>
            <strong>₱${formatMoney(income)}</strong>
          </div>
          <div class="finance-card finance-spend">
            <span class="finance-label">Spent</span>
            <strong>₱${formatMoney(spent)}</strong>
          </div>
          <div class="finance-card finance-net">
            <span class="finance-label">Net</span>
            <strong>₱${formatMoney(net)}</strong>
          </div>
          <div class="finance-card finance-rate">
            <span class="finance-label">Savings rate</span>
            <strong>${summary.savingsRate ?? 0}%</strong>
          </div>
        </div>

        <div class="panel panel-accent" style="--accent:var(--money)">
          <div class="panel-title">
            <h3>Spending guard</h3>
            <span class="count">${limit ? `Budget: ₱${formatMoney(limit)}` : 'No budget set'}</span>
          </div>
          <form class="add-form" id="budget-form">
            <div class="row">
              <input type="number" id="budget-input" placeholder="Set budget for today" min="0" step="0.01" value="${limit ?? ''}">
              <button type="submit" class="btn btn-primary btn-sm" style="flex:0 0 auto">Save</button>
            </div>
          </form>
          ${limit != null ? `
            <div style="margin-top:12px">
              <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:${overBudget ? 'var(--needs-work)' : 'var(--money)'}"></div></div>
              <p class="rating-sub" style="margin-top:8px">₱${formatMoney(expenses.filter((e) => e.kind === 'expense').reduce((s, e) => s + Number(e.amount), 0))} spent of ₱${formatMoney(limit)}${overBudget ? ' — over budget' : ''}</p>
            </div>
          ` : ''}
        </div>

        <div class="panel panel-accent" style="--accent:var(--money)">
          <div class="panel-title">
            <h3>${labelForRange(range)} snapshot</h3>
            <span class="count">Avg/day ₱${formatMoney(summary.averageDailySpend || 0)}</span>
          </div>
          <div class="money-trend">
            ${(summary.trend || []).slice(-7).map((point) => {
              const max = Math.max(1, ...((summary.trend || []).map((p) => Math.max(Number(p.expense || 0), Number(p.income || 0)))));
              const height = Math.max(12, (Math.max(Number(point.expense || 0), Number(point.income || 0)) / max) * 100);
              const label = point.date.slice(5).replace('-', '/');
              return `
                <div class="money-trend-item">
                  <div class="money-bar-group">
                    <span class="money-bar income" style="height:${Math.max(18, (Number(point.income || 0) / max) * 100)}%"></span>
                    <span class="money-bar expense" style="height:${Math.max(18, (Number(point.expense || 0) / max) * 100)}%"></span>
                  </div>
                  <small>${label}</small>
                </div>
              `;
            }).join('') || '<p class="empty-state">No activity in this period yet.</p>'}
          </div>
        </div>

        <div class="panel panel-accent" style="--accent:var(--money)">
          <div class="panel-title">
            <h3>Category breakdown</h3>
            <span class="count">${(summary.categories || []).length} categories</span>
          </div>
          ${(summary.categories || []).length ? summary.categories.map((cat) => `
            <div class="category-row">
              <div class="grow">
                <div class="title">${escapeHtml(cat.category)}</div>
              </div>
              <span class="pts-chip" style="color:var(--needs-work)">₱${formatMoney(cat.total)}</span>
            </div>
          `).join('') : '<p class="empty-state">No spending categories yet.</p>'}
        </div>

        <div class="panel panel-accent" style="--accent:var(--money)">
          <div class="panel-title">
            <h3>Transactions</h3>
            <span class="count">${expenses.length} entries</span>
          </div>
          ${expenses.length ? expenses.map(expenseRow).join('') : '<p class="empty-state">Nothing logged yet.</p>'}
          <form class="add-form" id="expense-form">
            <div class="row">
              <input type="text" id="exp-title" placeholder="What was it?" required maxlength="140">
              <input type="number" id="exp-amount" placeholder="₱" min="0" step="0.01" required style="max-width:90px">
            </div>
            <div class="row">
              <select id="exp-category">${CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select>
              <select id="exp-kind">
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </div>
            <button type="submit" class="btn btn-primary btn-sm">Add entry</button>
          </form>
        </div>
      </div>
    `;
  }

  function expenseRow(e) {
    const isIncome = e.kind === 'income';
    return `
      <div class="list-item">
        <div class="grow" data-edit="${e.id}" data-title="${escapeHtml(e.title)}" data-amount="${e.amount}" data-kind="${e.kind}">
          <div class="title">${escapeHtml(e.title)}</div>
          <div class="meta">${escapeHtml(e.category || 'Other')} · ${DateUtil.label(e.expense_date || AppState.date)}</div>
        </div>
        <span class="pts-chip" style="color:${isIncome ? 'var(--excellent)' : 'var(--needs-work)'}">
          ${isIncome ? '+' : '-'}₱${Number(e.amount).toFixed(2)}
        </span>
        <button class="icon-x" data-del="${e.id}">✕</button>
      </div>
    `;
  }

  function wire(el, date) {
    el.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        AppState.date = DateUtil.addDays(AppState.date, Number(btn.dataset.nav));
        render(el);
      });
    });

    el.querySelectorAll('[data-range]').forEach((tab) => {
      tab.addEventListener('click', () => {
        range = tab.dataset.range;
        render(el);
      });
    });

    el.querySelector('#budget-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = document.getElementById('budget-input').value;
      if (val === '') return;
      await Api.put('/money/budget', { budget_date: date, daily_limit: Number(val) });
      render(el);
    });

    el.querySelector('#expense-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('exp-title').value.trim();
      const amount = Number(document.getElementById('exp-amount').value);
      if (!title || !amount) return;
      await Api.post('/money', {
        expense_date: date,
        title,
        amount,
        category: document.getElementById('exp-category').value,
        kind: document.getElementById('exp-kind').value,
      });
      render(el);
    });

    el.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this transaction?')) return;
        await Api.del(`/money/${btn.dataset.del}`);
        render(el);
      });
    });

    el.querySelectorAll('[data-edit]').forEach((row) => {
      row.addEventListener('click', async () => {
        const nextTitle = prompt('Edit description:', row.dataset.title);
        if (nextTitle === null || !nextTitle.trim()) return;
        const nextAmount = prompt('Edit amount:', row.dataset.amount);
        if (nextAmount === null || isNaN(Number(nextAmount)) || Number(nextAmount) <= 0) return;
        const kind = row.dataset.kind || 'expense';
        await Api.patch(`/money/${row.dataset.edit}`, { title: nextTitle.trim(), amount: Number(nextAmount), kind });
        render(el);
      });
    });
  }

  function labelForRange(period) {
    if (period === 'day') return 'Daily';
    if (period === 'week') return 'Weekly';
    if (period === 'month') return 'Monthly';
    return 'Yearly';
  }

  function formatMoney(value) {
    return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  return { render };
})();
