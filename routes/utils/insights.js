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

module.exports = { computeWeekSummary };
