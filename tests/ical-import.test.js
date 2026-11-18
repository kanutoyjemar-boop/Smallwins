const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../public/js/ical-import');

test('calendar import parses local timed and all-day events and unescapes text', () => {
  const result = parse([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART:20261110T123000',
    'DTEND:20261110T133000',
    'SUMMARY:Planning\\, review',
    'LOCATION:Home\\; desk',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20261111',
    'SUMMARY:Rest day',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  assert.deepEqual(result, {
    events: [
      {
        item_date: '2026-11-10',
        title: 'Planning, review',
        location: 'Home; desk',
        start_time: '12:30',
        planned_minutes: 60,
      },
      {
        item_date: '2026-11-11',
        title: 'Rest day',
        location: null,
        start_time: null,
        planned_minutes: 30,
      },
    ],
    skipped: 0,
  });
});

test('calendar import converts UTC and TZID times into device local time', () => {
  const result = parse([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART:20261110T123000Z',
    'SUMMARY:UTC event',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;TZID=Asia/Manila:20261110T123000',
    'SUMMARY:Manila event',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n'));

  const local = (value) => {
    const date = new Date(value);
    return {
      date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
      time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
    };
  };
  assert.deepEqual(
    { date: result.events[0].item_date, time: result.events[0].start_time },
    local('2026-11-10T12:30:00Z')
  );
  assert.deepEqual(
    { date: result.events[1].item_date, time: result.events[1].start_time },
    local('2026-11-10T04:30:00Z')
  );
});

test('calendar import skips recurring series and rejects empty, oversized, or too-wide imports', () => {
  const recurring = parse([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART:20261110T123000',
    'SUMMARY:Weekly meeting',
    'RRULE:FREQ=WEEKLY',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n'));
  assert.deepEqual(recurring, { events: [], skipped: 1 });
  assert.throws(() => parse('BEGIN:VCALENDAR\nEND:VCALENDAR'), /No supported/);
  assert.throws(() => parse('x'.repeat(2 * 1024 * 1024 + 1)), /smaller than 2 MB/);
  assert.throws(() => parse([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20260101', 'SUMMARY:First', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20260401', 'SUMMARY:Last', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n')), /90-day range/);
});
