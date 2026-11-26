const PageMoney = (() => {
  const CATEGORIES = ['Food', 'Transport', 'Bills', 'Shopping', 'Health', 'Entertainment', 'Salary', 'Freelance', 'Other'];
  let range = 'month';
  const ICON = { Food: '🍽️', Transport: '🚌', Bills: '🧾', Shopping: '🛍️', Health: '💊', Entertainment: '🎬', Salary: '💼', Freelance: '💻', Other: '📦' };
  const icon = (c) => ICON[c] || ICON.Other;

  async function render(el) {
    const date = AppState.date;
    const [{ expenses, budget }, summary, cashflow, savingsFunds] = await Promise.all([
      Api.get(`/money?date=${date}`),
      Api.get(`/money/summary?date=${date}&range=${range}`),
      Api.get(`/money/cashflow?date=${date}`),
      Api.get('/savings'),
    ]);

    el.innerHTML = template(date, expenses, budget, summary, cashflow, savingsFunds);
    wire(el, date);
  }

  function template(date, expenses, budget, summary, cashflow, savingsFunds) {
    const spent = Number(summary.expenses || 0);
    const income = Number(summary.income || 0);
    const net = Number(summary.net || 0);
    const allowance = cashflow.allowance ? Number(cashflow.allowance.amount) : null;
    const monthIncome = Number(cashflow.income || 0);
    const monthSpent = Number(cashflow.expenses || 0);
    const reservedBills = Number(cashflow.reserved || 0);
    const monthRemaining = cashflow.balance;
    const monthKey = `${date.slice(0, 7)}-01`;
    const limit = budget ? Number(budget.daily_limit) : null;
    const pct = limit ? Math.min(100, Math.round((expenses.filter((e) => e.kind === 'expense').reduce((s, e) => s + Number(e.amount), 0) / limit) * 100)) : 0;
    const overBudget = limit != null && expenses.filter((e) => e.kind === 'expense').reduce((s, e) => s + Number(e.amount), 0) > limit;

    const daySpent = expenses.filter((e) => e.kind === 'expense').reduce((sum, e) => sum + Number(e.amount), 0);
    const ringColor = overBudget ? 'var(--needs-work)' : pct > 80 ? 'var(--fair)' : 'var(--money)';
    const transactionSuggestions = [
      ...expenses.map((expense) => expense.title),
      ...(cashflow.bills || []).map((bill) => bill.title),
      'Coffee',
      'Groceries',
      'Public transport',
    ];
    const billSuggestions = [
      ...(cashflow.bills || []).map((bill) => bill.title),
      'Rent',
      'Electricity',
      'Internet',
    ];
    const incomeSuggestions = [
      ...expenses.filter((entry) => entry.kind === 'income').map((entry) => entry.title),
      'Freelance work',
      'Extra shift',
      'Sold an item',
    ];
    const heroHtml = limit ? `
      <div class="panel money-hero">
        <div class="score-ring animated" data-pct="${pct}" style="--c:${ringColor}; --p:0"><div class="ring-num"><span class="pct">${pct}</span><span class="pct-sym">%</span></div></div>
        <div>
          <p class="rating-sub" style="margin:0">${overBudget ? 'Over budget by' : 'Left to spend'}</p>
          <p class="hero-amount" style="color:${overBudget ? 'var(--needs-work)' : 'var(--text)'}">₱${formatMoney(Math.abs(limit - daySpent))}</p>
          <p class="rating-sub" style="margin:0">₱${formatMoney(daySpent)} of ₱${formatMoney(limit)} today</p>
        </div>
      </div>` : `
      <div class="panel money-hero">
        <div class="score-ring" style="background:conic-gradient(var(--nodata) 0 100%)"><div class="ring-num"><span class="pct">—</span></div></div>
        <div>
          <p class="hero-amount" style="font-size:20px">Set a daily limit</p>
          <p class="rating-sub" style="margin:2px 0 8px">Use a limit as a guide for today’s spending, not a judgment.</p>
          <button class="btn btn-primary btn-sm" type="button" data-focus-budget>Set limit</button>
        </div>
      </div>`;
    const catTotal = (summary.categories || []).reduce((sum, c) => sum + Number(c.total || 0), 0) || 1;

    return `
      <div class="date-nav">
        <button data-nav="-1">‹</button>
        <div class="date-label">${DateUtil.label(date)}</div>
        <button data-nav="1">›</button>
      </div>

      ${heroHtml}

      <div class="panel panel-accent cashflow-panel" style="--accent:var(--money)">
        <div class="panel-title">
          <h3>Monthly allowance</h3>
          <span class="count">${DateUtil.label(monthKey)}</span>
        </div>
        <p class="meta">Your estimate of money available this month. This guide carries forward until you change it.</p>
        ${allowance == null ? `
          <p class="cashflow-notice">No monthly allowance set yet. You can still log expenses and income; add an allowance to see how much you have left.</p>
        ` : `
          <div class="cashflow-balance ${monthRemaining < 0 ? 'is-over' : ''}">
            <span>${monthRemaining < 0 ? 'Over allowance by' : 'Available balance'}</span>
            <strong>₱${formatMoney(Math.abs(monthRemaining))}</strong>
          </div>
        `}
        <div class="cashflow-stats">
          <span>Allowance <strong>${allowance == null ? 'Not set' : `₱${formatMoney(allowance)}`}</strong></span>
          <span>Income <strong>+₱${formatMoney(monthIncome)}</strong></span>
          <span>Spent <strong>-₱${formatMoney(monthSpent)}</strong></span>
          <span>Unpaid bills reserved <strong>-₱${formatMoney(reservedBills)}</strong></span>
        </div>
        <form class="add-form" id="allowance-form">
          <div class="row">
            <input type="number" id="allowance-input" placeholder="Set this month's allowance" min="0" max="9999999999.99" step="0.01" value="${allowance ?? ''}" aria-label="Monthly allowance">
            <button type="submit" class="btn btn-primary btn-sm" style="flex:0 0 auto">${allowance == null ? 'Set allowance' : 'Update'}</button>
          </div>
        </form>
      </div>

      ${monthlyReviewHtml(cashflow, allowance, monthIncome)}

      ${savingsHtml(savingsFunds, date)}

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
          <p class="meta">A daily spending guide. It does not change your monthly allowance or stop you from logging a purchase.</p>
          <form class="add-form" id="budget-form">
            <div class="row">
              <input type="number" id="budget-input" placeholder="Set budget for today" min="0" step="0.01" value="${limit ?? ''}">
              <button type="submit" class="btn btn-primary btn-sm" style="flex:0 0 auto">Save</button>
            </div>
          </form>
        </div>

        <div class="panel panel-accent" style="--accent:var(--money)">
          <div class="panel-title">
            <h3>Recurring monthly bills</h3>
            <span class="count">${cashflow.bills.length} saved</span>
          </div>
          <p class="rating-sub" style="margin:0 0 10px">Bills are forecasts until you mark them paid. Only marked payments become expenses. Inactive or finished bills stop generating future due items; past payments remain in your history.</p>
          ${cashflow.bills.length ? cashflow.bills.map(billRow).join('') : '<p class="empty-state">Add bills like Wi-Fi, utilities, or subscriptions to plan for them.</p>'}
          <div class="bill-occurrences">
            <div class="section-label">This month’s bills</div>
            ${cashflow.occurrences.length ? cashflow.occurrences.map(billOccurrenceRow).join('') : '<p class="empty-state">No bill payments are scheduled for this month.</p>'}
          </div>
          <form class="add-form" id="bill-form">
            <input type="hidden" id="bill-id">
            <div class="row">
              <input type="text" id="bill-title" list="suggestions-bill-title" placeholder="Bill name (e.g. Wi-Fi)" aria-label="Bill name" required maxlength="140">
              <input type="number" id="bill-amount" placeholder="₱ amount" aria-label="Bill amount in Philippine pesos" min="0.01" max="9999999999.99" step="0.01" required>
            </div>
            ${UI.suggestions('bill-title', 'Bill name', billSuggestions)}
            <div class="row">
              <input type="number" id="bill-due-day" placeholder="Due day (1–31)" aria-label="Day of the month the bill is due" min="1" max="31" step="1" required>
              <select id="bill-category" aria-label="Bill category">${CATEGORIES.filter((category) => !['Salary', 'Freelance'].includes(category)).map((category) => `<option ${category === 'Bills' ? 'selected' : ''}>${category}</option>`).join('')}</select>
            </div>
            <div class="row">
              <select id="bill-status" aria-label="Bill status">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="finished">Finished</option>
              </select>
              <button type="submit" class="btn btn-primary btn-sm" id="bill-save" style="flex:0 0 auto">Add monthly bill</button>
              <button type="button" class="btn btn-ghost btn-sm hidden" id="bill-cancel">Cancel</button>
            </div>
          </form>
        </div>

        <div class="panel panel-accent side-income-panel" style="--accent:var(--excellent)">
          <div class="panel-title"><h3>Side-hustle income</h3></div>
          <p class="rating-sub" style="margin:0 0 10px">Log a one-time earning on the day you receive it. It adds to that month’s available cash.</p>
          <form class="add-form" id="side-income-form">
            <div class="row">
              <input type="text" id="side-income-title" list="suggestions-side-income-title" placeholder="What did you earn from?" aria-label="Income source" required maxlength="140">
              <input type="number" id="side-income-amount" placeholder="₱ amount" aria-label="Income amount in Philippine pesos" min="0.01" max="9999999999.99" step="0.01" required>
            </div>
            ${UI.suggestions('side-income-title', 'Income source', incomeSuggestions)}
            <div class="row">
              <input type="date" id="side-income-date" value="${date}" required aria-label="Earning date">
              <button type="submit" class="btn btn-primary btn-sm" style="flex:0 0 auto">Add earning</button>
            </div>
          </form>
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
            }).join('') || '<p class="empty-state">No entries recorded for this period yet. Add them whenever you want a clearer picture.</p>'}
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
                <div class="title">${icon(cat.category)} ${escapeHtml(cat.category)} <small class="cat-share">${Math.round((Number(cat.total) / catTotal) * 100)}%</small></div>
                <div class="mini-progress-track" style="margin-top:6px"><div class="mini-progress-fill" style="width:${Math.round((Number(cat.total) / catTotal) * 100)}%; background:var(--money)"></div></div>
              </div>
              <span class="pts-chip" style="color:var(--needs-work)">₱${formatMoney(cat.total)}</span>
            </div>
          `).join('') : '<p class="empty-state">Your categories will appear here as you log transactions.</p>'}
        </div>

        <div class="panel panel-accent" style="--accent:var(--money)">
          <div class="panel-title">
            <h3>Transactions</h3>
            <span class="count">${expenses.length} entries</span>
          </div>
          ${expenses.length ? expenses.map(expenseRow).join('') : '<p class="empty-state">No transactions recorded for this day. Add an entry whenever it’s useful.</p>'}
          <form class="add-form" id="expense-form">
            <div class="row">
              <input type="text" id="exp-title" list="suggestions-exp-title" placeholder="What was it?" aria-label="Transaction name" required maxlength="140">
              <input type="number" id="exp-amount" placeholder="₱" aria-label="Amount in Philippine pesos" min="0" step="0.01" required style="max-width:90px">
            </div>
            ${UI.suggestions('exp-title', 'Transaction name', transactionSuggestions)}
            <div class="row">
              <select id="exp-category" aria-label="Transaction category">${CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select>
              <select id="exp-kind" aria-label="Entry type">
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
          <div class="title">${icon(e.category)} ${escapeHtml(e.title)}</div>
          <div class="meta">${escapeHtml(e.category || 'Other')} · ${DateUtil.label(e.expense_date || AppState.date)}</div>
        </div>
        <span class="pts-chip" style="color:${isIncome ? 'var(--excellent)' : 'var(--needs-work)'}">
          ${isIncome ? '+' : '-'}₱${Number(e.amount).toFixed(2)}
        </span>
        <button class="icon-x" data-del="${e.id}">✕</button>
      </div>
    `;
  }

  function billRow(bill) {
    return `
      <div class="bill-row">
        <div class="grow">
          <div class="title">${escapeHtml(bill.title)} <span class="pts-chip">₱${formatMoney(bill.amount)}/mo</span></div>
          <div class="meta">${escapeHtml(bill.category)} · Due day ${bill.due_day} · Starts ${DateUtil.label(bill.start_month)}</div>
        </div>
        <select data-bill-status="${bill.id}" aria-label="${escapeHtml(bill.title)} status">
          ${['active', 'inactive', 'finished'].map((status) => `<option value="${status}" ${bill.status === status ? 'selected' : ''}>${status[0].toUpperCase() + status.slice(1)}</option>`).join('')}
        </select>
        <button type="button" class="btn btn-ghost btn-sm" data-bill-edit="${bill.id}" data-title="${escapeHtml(bill.title)}" data-category="${escapeHtml(bill.category)}" data-amount="${bill.amount}" data-due-day="${bill.due_day}" data-status="${bill.status}" aria-label="Edit ${escapeHtml(bill.title)}">Edit</button>
      </div>
    `;
  }

  function billOccurrenceRow(occurrence) {
    const paid = occurrence.status === 'paid';
    return `
      <div class="bill-occurrence-row">
        <div class="grow">
          <div class="title">${escapeHtml(occurrence.title)} <span class="pts-chip">${paid ? 'Paid' : 'Unpaid'}</span></div>
          <div class="meta">Due ${DateUtil.label(occurrence.due_date)} · ${paid ? `Paid ${DateUtil.label(String(occurrence.paid_at).slice(0, 10))}` : 'Reserved from available balance'}</div>
        </div>
        <strong class="bill-occurrence-amount">₱${formatMoney(occurrence.amount)}</strong>
        <button type="button" class="btn btn-ghost btn-sm" data-bill-payment="${occurrence.bill_id}" data-bill-month="${occurrence.bill_month}" data-paid="${paid}">
          ${paid ? 'Undo payment' : 'Mark paid'}
        </button>
      </div>
    `;
  }

  function monthlyReviewHtml(cashflow, allowance, income) {
    const breakdown = cashflow.breakdown || [];
    const topCategories = breakdown.slice(0, 3);
    const available = allowance === null ? null : allowance + income;
    const projectionText = available === null
      ? 'Set an allowance to compare this spending pace with your monthly funds.'
      : cashflow.projectedRemaining < 0
        ? `At this pace, month-end spending may exceed allowance and income by ₱${formatMoney(Math.abs(cashflow.projectedRemaining))}.`
        : `At this pace, about ₱${formatMoney(cashflow.projectedRemaining)} may remain after bills and savings set aside.`;
    return `
      <div class="panel monthly-review-panel">
        <div class="panel-title">
          <h3>Monthly money review</h3>
          <span class="count">As of ${DateUtil.label(cashflow.through)}</span>
        </div>
        <p class="rating-sub" style="margin:0 0 10px">A gentle estimate from spending so far, not a judgment or a guarantee.</p>
        <div class="cashflow-stats">
          <span>Everyday spending <strong>₱${formatMoney(cashflow.variableExpenses)}</strong></span>
          <span>Bills paid <strong>₱${formatMoney(cashflow.paidBills)}</strong></span>
          <span>Bills unpaid <strong>₱${formatMoney(cashflow.reserved)}</strong></span>
          <span>Added to savings <strong>₱${formatMoney(cashflow.savingsContributions || 0)}</strong></span>
          <span>Withdrawn from savings <strong>₱${formatMoney(cashflow.savingsWithdrawals || 0)}</strong></span>
        </div>
        <div class="weekly-suggestion"><strong>At your current pace</strong><p>${escapeHtml(projectionText)}</p></div>
        ${topCategories.length ? `<div class="monthly-review-categories"><span class="meta">Top spending categories</span>${topCategories.map((item) => `
          <div class="review-highlight"><span>${escapeHtml(item.category || 'Other')}</span><strong>₱${formatMoney(item.total)}</strong></div>
        `).join('')}</div>` : '<p class="empty-state">Log a few expenses to see spending patterns here.</p>'}
      </div>
    `;
  }

  function savingsHtml(funds, date) {
    const suggestions = [
      ...funds.map((fund) => fund.title),
      'Emergency fund',
      'Travel fund',
      'New computer',
    ];
    return `
      <div class="panel panel-accent savings-panel" style="--accent:var(--excellent)">
        <div class="panel-title">
          <h3>Savings goals &amp; sinking funds</h3>
          <span class="count">${funds.length} saved</span>
        </div>
        <p class="rating-sub" style="margin:0 0 10px">Set aside money for goals and irregular expenses. Contributions reduce this month’s available cash without being counted as spending; withdrawals return to available cash.</p>
        ${funds.length ? funds.map(savingsFundRow).join('') : '<p class="empty-state">Create a fund for an emergency cushion, travel, annual fees, or another goal.</p>'}
        <form class="add-form" id="savings-fund-form">
          <div class="row">
            <input id="savings-fund-title" type="text" list="suggestions-savings-fund-title" required maxlength="140" placeholder="Fund name (e.g. Emergency savings)" aria-label="Savings goal name">
            <input id="savings-fund-target" type="number" min="0.01" max="9999999999.99" step="0.01" required placeholder="Target amount" aria-label="Savings target in Philippine pesos">
          </div>
          ${UI.suggestions('savings-fund-title', 'Savings goal name', suggestions)}
          <button type="submit" class="btn btn-primary btn-sm">Create savings fund</button>
        </form>
        <p class="meta">Fund activity uses the selected date: ${DateUtil.label(date)}.</p>
      </div>
    `;
  }

  function savingsFundRow(fund) {
    const saved = Number(fund.saved_amount || 0);
    const target = Number(fund.target_amount);
    const percent = target > 0 ? Math.min(100, Math.round(saved / target * 100)) : 0;
    return `
      <div class="savings-fund-row">
        <div class="savings-fund-heading">
          <div class="grow">
            <div class="title">${escapeHtml(fund.title)} <span class="pts-chip">${escapeHtml(fund.status)}</span></div>
            <div class="meta">₱${formatMoney(saved)} of ₱${formatMoney(target)} · ${percent}%</div>
          </div>
          <select data-savings-status="${fund.id}" aria-label="${escapeHtml(fund.title)} status">
            ${['active', 'paused', 'completed'].map((status) => `<option value="${status}" ${fund.status === status ? 'selected' : ''}>${status[0].toUpperCase() + status.slice(1)}</option>`).join('')}
          </select>
          <button type="button" class="btn btn-ghost btn-sm" data-savings-edit="${fund.id}" data-title="${escapeHtml(fund.title)}" data-target="${fund.target_amount}">Edit</button>
        </div>
        <div class="mini-progress-track"><div class="mini-progress-fill" style="width:${percent}%; background:var(--excellent)"></div></div>
        <div class="row savings-fund-actions">
          <button type="button" class="btn btn-primary btn-sm" data-savings-action="save" data-fund-id="${fund.id}" ${fund.status === 'active' ? '' : 'disabled'}>Set aside</button>
          <button type="button" class="btn btn-ghost btn-sm" data-savings-action="withdraw" data-fund-id="${fund.id}" ${saved > 0 ? '' : 'disabled'}>Withdraw</button>
        </div>
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

    el.querySelectorAll('[data-focus-budget]').forEach((button) => {
      button.addEventListener('click', () => el.querySelector('#budget-input').focus());
    });

    el.querySelector('#budget-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = el.querySelector('#budget-input').value;
      if (val === '') {
        UI.toast('Enter a daily spending limit.');
        return;
      }
      try {
        await Api.put('/money/budget', { budget_date: date, daily_limit: Number(val) });
        render(el);
      } catch (error) {
        UI.toast(error.message);
      }
    });

    el.querySelector('#allowance-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = el.querySelector('#allowance-input');
      if (input.value === '') {
        UI.toast('Enter a monthly allowance amount.');
        return;
      }
      try {
        await Api.put('/money/allowance', { allowance_month: `${date.slice(0, 7)}-01`, amount: Number(input.value) });
        render(el);
      } catch (error) {
        UI.toast(error.message);
      }
    });

    el.querySelector('#savings-fund-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = el.querySelector('#savings-fund-title').value.trim();
      const target = Number(el.querySelector('#savings-fund-target').value);
      try {
        await Api.post('/savings', { title, target_amount: target });
        render(el);
      } catch (error) {
        UI.toast(error.message);
      }
    });
    el.querySelectorAll('[data-savings-edit]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          const title = await UI.prompt('Edit savings fund name:', button.dataset.title);
          if (title === null || !title.trim()) return;
          const target = await UI.prompt('Edit target amount:', button.dataset.target);
          if (target === null || !Number.isFinite(Number(target)) || Number(target) <= 0) return;
          await Api.patch(`/savings/${button.dataset.savingsEdit}`, {
            title: title.trim(),
            target_amount: Number(target),
          });
          render(el);
        } catch (error) {
          UI.toast(error.message);
        }
      });
    });
    el.querySelectorAll('[data-savings-status]').forEach((select) => {
      select.addEventListener('change', async () => {
        try {
          await Api.patch(`/savings/${select.dataset.savingsStatus}`, { status: select.value });
          render(el);
        } catch (error) {
          UI.toast(error.message);
          render(el);
        }
      });
    });
    el.querySelectorAll('[data-savings-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const kind = button.dataset.savingsAction;
        try {
          const amount = await UI.prompt(`${kind === 'save' ? 'How much would you like to set aside?' : 'How much would you like to withdraw?'}`);
          if (amount === null) return;
          const value = Number(amount);
          if (!Number.isFinite(value) || value <= 0) {
            UI.toast('Enter a positive amount.');
            return;
          }
          await Api.post(`/savings/${button.dataset.fundId}/entries`, {
            entry_date: date,
            kind,
            amount: value,
          });
          render(el);
        } catch (error) {
          UI.toast(error.message);
        }
      });
    });

    const billForm = el.querySelector('#bill-form');
    const resetBillForm = () => {
      billForm.reset();
      el.querySelector('#bill-id').value = '';
      el.querySelector('#bill-status').value = 'active';
      el.querySelector('#bill-save').textContent = 'Add monthly bill';
      el.querySelector('#bill-cancel').classList.add('hidden');
    };
    billForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const billId = el.querySelector('#bill-id').value;
      const body = {
        title: el.querySelector('#bill-title').value.trim(),
        category: el.querySelector('#bill-category').value,
        amount: Number(el.querySelector('#bill-amount').value),
        due_day: Number(el.querySelector('#bill-due-day').value),
        status: el.querySelector('#bill-status').value,
      };
      try {
        if (billId) await Api.patch(`/money/bills/${billId}`, body);
        else await Api.post('/money/bills', body);
        resetBillForm();
        render(el);
      } catch (error) {
        UI.toast(error.message);
      }
    });
    el.querySelector('#bill-cancel').addEventListener('click', resetBillForm);
    el.querySelectorAll('[data-bill-edit]').forEach((button) => {
      button.addEventListener('click', () => {
        el.querySelector('#bill-id').value = button.dataset.billEdit;
        el.querySelector('#bill-title').value = button.dataset.title;
        el.querySelector('#bill-category').value = button.dataset.category;
        el.querySelector('#bill-amount').value = button.dataset.amount;
        el.querySelector('#bill-due-day').value = button.dataset.dueDay;
        el.querySelector('#bill-status').value = button.dataset.status;
        el.querySelector('#bill-save').textContent = 'Save bill changes';
        el.querySelector('#bill-cancel').classList.remove('hidden');
        billForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.querySelector('#bill-title').focus();
      });
    });
    el.querySelectorAll('[data-bill-status]').forEach((select) => {
      select.addEventListener('change', async () => {
        try {
          await Api.patch(`/money/bills/${select.dataset.billStatus}`, { status: select.value });
          render(el);
        } catch (error) {
          UI.toast(error.message);
          render(el);
        }
      });
    });
    el.querySelectorAll('[data-bill-payment]').forEach((button) => {
      button.addEventListener('click', async () => {
        const billId = button.dataset.billPayment;
        const billMonth = button.dataset.billMonth;
        const paid = button.dataset.paid === 'true';
        try {
          if (paid) {
            if (!await UI.confirm('Undo this payment? The bill will be unpaid again and its expense will be removed.')) return;
            await Api.del(`/money/bills/${billId}/pay?month=${billMonth}`);
          } else {
            await Api.post(`/money/bills/${billId}/pay`, { bill_month: billMonth });
          }
          render(el);
        } catch (error) {
          UI.toast(error.message);
        }
      });
    });

    el.querySelector('#side-income-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = el.querySelector('#side-income-title').value.trim();
      const amount = Number(el.querySelector('#side-income-amount').value);
      const earningDate = el.querySelector('#side-income-date').value;
      if (!title || !amount || !earningDate) return;
      try {
        await Api.post('/money', {
          expense_date: earningDate,
          title,
          amount,
          category: 'Freelance',
          kind: 'income',
        });
        render(el);
      } catch (error) {
        UI.toast(error.message);
      }
    });

    el.querySelector('#expense-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('exp-title').value.trim();
      const amount = Number(document.getElementById('exp-amount').value);
      if (!title || !amount) return;
      try {
        await Api.post('/money', {
          expense_date: date,
          title,
          amount,
          category: el.querySelector('#exp-category').value,
          kind: el.querySelector('#exp-kind').value,
        });
        render(el);
      } catch (error) {
        UI.toast(error.message);
      }
    });

    el.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!await UI.confirm('Delete this transaction?')) return;
        try {
          await Api.del(`/money/${btn.dataset.del}`);
          render(el);
        } catch (error) {
          UI.toast(error.message);
        }
      });
    });

    el.querySelectorAll('[data-edit]').forEach((row) => {
      row.addEventListener('click', async () => {
        try {
          const nextTitle = await UI.prompt('Edit description:', row.dataset.title);
          if (nextTitle === null || !nextTitle.trim()) return;
          const nextAmount = await UI.prompt('Edit amount:', row.dataset.amount);
          if (nextAmount === null || isNaN(Number(nextAmount)) || Number(nextAmount) <= 0) return;
          const kind = row.dataset.kind || 'expense';
          await Api.patch(`/money/${row.dataset.edit}`, { title: nextTitle.trim(), amount: Number(nextAmount), kind });
          render(el);
        } catch (error) {
          UI.toast(error.message);
        }
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
