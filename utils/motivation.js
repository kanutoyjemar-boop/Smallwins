// Short, honest nudges instead of generic "You got this!" filler. The goal
// is to always tell the person exactly how close they are to the next
// rating, since "one task away from Great" is more motivating than a
// platitude.

const { rate } = require('./scoring');

const THRESHOLDS = [
  { name: 'Excellent', min: 90 },
  { name: 'Great', min: 75 },
  { name: 'Fair', min: 50 },
];

function pointsToNextRating(summary) {
  if (summary.percentage === null || summary.possible === 0) return null;
  for (const t of THRESHOLDS) {
    if (summary.percentage < t.min) {
      const neededEarned = Math.ceil((t.min / 100) * summary.possible);
      const pointsShort = neededEarned - summary.earned;
      if (pointsShort > 0) return { rating: t.name, pointsShort };
      return null;
    }
  }
  return null;
}

function greetingForHour(hour) {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Late night';
}

/**
 * @param {object} summary - today's computeDailySummary() output
 * @param {object} streakStats - computeStreak() output
 * @param {Date} [now]
 */
function dashboardMessage(summary, streakStats, now = new Date()) {
  const hour = now.getHours();
  const greeting = greetingForHour(hour);

  if (summary.percentage === null) {
    if (streakStats && streakStats.streak > 0) {
      return `${greeting}! Your ${streakStats.streak}-day streak is waiting on you — plan something for today to keep it alive.`;
    }
    return `${greeting}! Nothing planned yet — add a task, a workout, or an agenda item to start scoring today.`;
  }

  const next = pointsToNextRating(summary);
  if (next) {
    const plural = next.pointsShort === 1 ? 'point' : 'points';
    return `You're ${next.pointsShort} ${plural} away from ${next.rating} today. Small push and it's yours.`;
  }

  if (summary.percentage >= 100) {
    return `Perfect day. ${summary.earned}/${summary.possible} points — nothing left on the table.`;
  }

  if (summary.rating === 'Excellent') {
    return streakStats && streakStats.streak > 1
      ? `Excellent, and that's day ${streakStats.streak} in a row. Keep the streak going.`
      : `Excellent day so far. This is the standard — keep it up.`;
  }

  return `Solid so far at ${summary.percentage}%. Check what's left in each module below.`;
}

/**
 * Push-notification copy. Kept short since notification bodies get
 * truncated on most phones.
 */
function pushMessage(kind, ctx) {
  const { summary, streakStats, pendingAm, pendingPm } = ctx;
  if (kind === 'morning') {
    const count = (pendingAm || 0);
    if (count === 0) return { title: 'Small Wins', body: `Good morning! Open Small Wins and plan your AM tasks for today.` };
    const streakBit = streakStats && streakStats.streak > 0 ? ` Keep your ${streakStats.streak}-day streak alive.` : '';
    return { title: 'Small Wins — Morning check-in', body: `You have ${count} AM task${count === 1 ? '' : 's'} planned.${streakBit}` };
  }
  if (kind === 'evening') {
    if (summary.percentage === null) {
      return { title: 'Small Wins — Evening check-in', body: `Nothing logged yet today. A few minutes now still counts.` };
    }
    const next = pointsToNextRating(summary);
    if (next) {
      return { title: 'Small Wins — Evening check-in', body: `You're at ${summary.percentage}%, ${next.pointsShort} points from ${next.rating}. Still time.` };
    }
    return { title: 'Small Wins — Evening check-in', body: `You're at ${summary.percentage}% (${summary.rating}) today. Nice work.` };
  }
  if (kind === 'streak') {
    if (summary.percentage === null) {
      const streakBit = streakStats && streakStats.streak > 0 ? ` your ${streakStats.streak}-day streak is on the line.` : ' today is still unscored.';
      return { title: 'Small Wins — Streak at risk', body: `Nothing logged and${streakBit} A quick check-in keeps it going.` };
    }
    if (summary.percentage < 60) {
      return { title: 'Small Wins — Streak at risk', body: `You're at ${summary.percentage}% with the day almost over. Log something to save today.` };
    }
    return { title: 'Small Wins', body: `${summary.percentage}% today — streak's safe. Nice.` };
  }
  return { title: 'Small Wins', body: 'Open Small Wins for your daily check-in.' };
}

module.exports = { dashboardMessage, pushMessage, pointsToNextRating };
