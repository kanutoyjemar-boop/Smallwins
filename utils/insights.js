function computeWeekSummary(days) {
  const scored = days.filter((d) => d && d.percentage != null);
  if (!scored.length) {
    return {
      activeDays: 0,
      average: 0,
      bestDay: null,
      completionRate: 0,
      bestScore: 0,
    };
  }

  const average = Math.round(scored.reduce((sum, d) => sum + d.percentage, 0) / scored.length);
  const best = scored.reduce((current, d) => (d.percentage > current.percentage ? d : current), scored[0]);
  const completionRate = Math.round((scored.length / Math.max(days.length, 1)) * 100);

  return {
    activeDays: scored.length,
    average,
    bestDay: best.date,
    completionRate,
    bestScore: best.percentage,
  };
}

function weeklyRecap(days, weights = {}) {
  const modules = [
    { key: 'tasks', weightKey: 'tasks', label: 'tasks', totals: [0, 0] },
    { key: 'workout', weightKey: 'workouts', label: 'movement', totals: [0, 0] },
    { key: 'diet', weightKey: 'diet', label: 'meals', totals: [0, 0] },
    { key: 'schedule', weightKey: 'schedule', label: 'your agenda', totals: [0, 0] },
    { key: 'money', weightKey: 'money', label: 'your budget', totals: [0, 0] },
  ];

  for (const day of days.filter((item) => item && item.percentage != null)) {
    const am = day.am || { earned: 0, possible: 0 };
    const pm = day.pm || { earned: 0, possible: 0 };
    modules[0].totals[0] += am.earned + pm.earned;
    modules[0].totals[1] += am.possible + pm.possible;
    for (const module of modules.slice(1)) {
      const score = day[module.key] || { earned: 0, possible: 0 };
      module.totals[0] += score.earned;
      module.totals[1] += score.possible;
    }
  }

  const scored = modules
    .filter((module) => module.totals[1] > 0 && (weights[module.weightKey] ?? 1) > 0)
    .map((module) => ({ ...module, percentage: Math.round(module.totals[0] / module.totals[1] * 100) }));
  if (!scored.length) {
    return {
      win: 'A fresh week is a chance to start wherever you are.',
      nextStep: 'Choose one small, realistic thing to plan when you’re ready.',
    };
  }

  const strongest = scored.reduce((best, item) => item.percentage > best.percentage ? item : best, scored[0]);
  const growth = scored.reduce((lowest, item) => item.percentage < lowest.percentage ? item : lowest, scored[0]);
  return {
    win: strongest.percentage > 0
      ? `You followed through on ${strongest.label} especially well (${strongest.percentage}%).`
      : `You made space to plan ${strongest.label}. Planning is a useful first step.`,
    nextStep: growth.key === strongest.key
      ? 'Keep your plan at a pace that feels sustainable.'
      : `If it would help, make ${growth.label} easier next week with one small, manageable step.`,
  };
}

function recoveryNextStep(summary) {
  if (!summary || summary.checkins < 3) return null;
  if (summary.averageStress !== null && summary.averageStress >= 4) {
    return 'Stress has felt high in a few check-ins. If it would help, make room for one pause or simplify one commitment next week.';
  }
  if (summary.averageSleep !== null && summary.averageSleep < 6.5) {
    return 'Your recent sleep check-ins have been shorter. If it fits your life, try one small wind-down change this week.';
  }
  if (summary.averageEnergy !== null && summary.averageEnergy <= 2.5) {
    return 'Energy has felt low in a few check-ins. Consider making next week’s plan a little lighter, if that feels useful.';
  }
  return null;
}

module.exports = { computeWeekSummary, weeklyRecap, recoveryNextStep };
