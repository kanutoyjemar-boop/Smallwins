const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAvailabilitySummary, countItemsByDate, getWeekDates, isDateKey } = require('../public/js/pages/schedule');

test('seven-day strip starts at the selected date across month and year boundaries', () => {
  assert.deepEqual(getWeekDates('2026-11-10'), [
    '2026-11-10',
    '2026-11-11',
    '2026-11-12',
    '2026-11-13',
    '2026-11-14',
    '2026-11-15',
    '2026-11-16',
  ]);
  assert.deepEqual(getWeekDates('2027-01-01'), [
    '2027-01-01',
    '2027-01-02',
    '2027-01-03',
    '2027-01-04',
    '2027-01-05',
    '2027-01-06',
    '2027-01-07',
  ]);
});

test('date picker accepts valid dates and rejects malformed or impossible dates', () => {
  assert.equal(isDateKey('2027-01-01'), true);
  assert.equal(isDateKey('2028-02-29'), true);
  assert.equal(isDateKey('2027-02-29'), false);
  assert.equal(isDateKey('not-a-date'), false);
});

test('week counts include items from every date and handle date values with timestamps', () => {
  const items = [
    { item_date: '2026-11-10' },
    { item_date: '2026-11-10T00:00:00.000Z' },
    { item_date: '2026-11-11' },
  ];

  assert.equal(countItemsByDate(items, '2026-11-10'), 2);
  assert.equal(countItemsByDate(items, '2026-11-12'), 0);
});

test('availability sums occupied minutes once and reports overlapping agenda items', () => {
  const summary = buildAvailabilitySummary([
    { id: 1, start_time: '08:00:00', planned_minutes: 120, actual_minutes: 150, status: 'overtime' },
    { id: 2, start_time: '10:15:00', planned_minutes: 30, status: 'pending' },
    { id: 3, start_time: '11:00:00', planned_minutes: 30, status: 'pending' },
    { id: 4, start_time: '12:00:00', planned_minutes: 60, status: 'skipped' },
    { id: 5, start_time: null, planned_minutes: 60, status: 'pending' },
  ]);
  const morning = summary.blocks.find((block) => block.label === 'Morning');
  const midday = summary.blocks.find((block) => block.label === 'Midday');

  assert.equal(morning.occupiedMinutes, 165);
  assert.equal(morning.freeMinutes, morning.duration - 165);
  assert.equal(midday.occupiedMinutes, 30);
  assert.equal(summary.overlapCount, 1);
  assert.deepEqual([...summary.conflictingIds].sort(), [1, 2]);
  assert.equal(summary.openBlocks, 5);
  assert.equal(summary.recommended.length, 3);
});

test('availability counts each overlapping pair and marks every conflicting item', () => {
  const summary = buildAvailabilitySummary([
    { id: 1, start_time: '09:00:00', planned_minutes: 60, status: 'pending' },
    { id: 2, start_time: '09:15:00', planned_minutes: 60, status: 'pending' },
    { id: 3, start_time: '09:30:00', planned_minutes: 60, status: 'pending' },
  ]);

  assert.equal(summary.overlapCount, 3);
  assert.deepEqual([...summary.conflictingIds].sort(), [1, 2, 3]);
});

test('availability splits occupied time across block boundaries', () => {
  const summary = buildAvailabilitySummary([
    { id: 1, start_time: '10:30:00', planned_minutes: 60, status: 'pending' },
  ]);
  const morning = summary.blocks.find((block) => block.label === 'Morning');
  const midday = summary.blocks.find((block) => block.label === 'Midday');

  assert.equal(morning.occupiedMinutes, 30);
  assert.equal(midday.occupiedMinutes, 30);
});

test('availability clips events to the day and ignores invalid or untimed items', () => {
  const summary = buildAvailabilitySummary([
    { id: 1, start_time: '23:30:00', planned_minutes: 120, status: 'pending' },
    { id: 2, start_time: '25:00', planned_minutes: 60, status: 'pending' },
    { id: 3, start_time: '09:00:00', planned_minutes: 0, status: 'pending' },
    { id: 4, start_time: null, planned_minutes: 60, status: 'pending' },
  ]);
  const night = summary.blocks.find((block) => block.label === 'Night');
  const morning = summary.blocks.find((block) => block.label === 'Morning');

  assert.equal(night.occupiedMinutes, 30);
  assert.equal(morning.occupiedMinutes, 0);
  assert.equal(summary.overlapCount, 0);
});
