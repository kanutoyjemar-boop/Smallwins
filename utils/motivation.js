// Check-ins recognize progress without turning scores or streaks into pressure.

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
function dashboardMessage(summary, _streakStats, now = new Date()) {
  const hour = now.getHours();
  const greeting = greetingForHour(hour);

  if (summary.percentage === null) {
    return `${greeting}! No plan is okay. If it would help, choose one small thing—small steps add up over time.`;
  }

  if (summary.percentage >= 100) {
    return `${summary.earned}/${summary.possible} planned points earned. Take a moment to appreciate what you did today—each small win adds up.`;
  }

  if (summary.earned > 0) {
    return `${summary.earned} of ${summary.possible} planned points earned—that's real progress. Small wins add up over time; anything more is optional.`;
  }
  return 'Your plan is ready when you are. One small step can count; adjust it to fit your day.';
}

/**
 * Push-notification copy. Kept short since notification bodies get
 * truncated on most phones.
 */
function pushMessage(kind, ctx) {
  const { summary, pendingAm } = ctx;
  if (kind === 'morning') {
    const count = (pendingAm || 0);
    if (count === 0) return { title: 'Small Wins — gentle start', body: 'Choose one small focus if it would make today easier. Small steps add up.' };
    return { title: 'Small Wins — morning check-in', body: `${count} morning focus item${count === 1 ? '' : 's'} ready. Choose what fits your energy; every step counts.` };
  }
  if (kind === 'evening') {
    if (summary.percentage === null) {
      return { title: 'Small Wins — evening check-in', body: 'If today turned out differently, that is okay. Begin again whenever you are ready.' };
    }
    if (summary.earned > 0) {
      return { title: 'Small Wins — evening check-in', body: 'You made progress today. What you did counts; small wins add up, and anything more is optional.' };
    }
    return { title: 'Small Wins — evening check-in', body: 'Plans do not always fit the day. Rest or reset—your progress is not lost.' };
  }
  if (kind === 'streak') {
    if (summary.percentage === null) {
      return { title: 'Small Wins — gentle check-in', body: 'Choose one small win if it feels right, or take the rest you need. There is no perfect pace.' };
    }
    if (summary.earned > 0) {
      return { title: 'Small Wins — gentle check-in', body: 'You showed up for yourself today. Take a moment to notice that.' };
    }
    return { title: 'Small Wins — gentle check-in', body: 'If today’s plan did not fit, that is okay. Adjust it or start fresh tomorrow.' };
  }
  return { title: 'Small Wins', body: 'Open Small Wins for your daily check-in.' };
}

module.exports = { dashboardMessage, pushMessage };
