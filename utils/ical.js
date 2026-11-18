function escapeText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/([,;])/g, '\\$1');
}

function formatDate(value) {
  return String(value).replace(/-/g, '');
}

function formatTime(value) {
  return String(value).replace(/:/g, '').slice(0, 6);
}

function addMinutes(date, time, minutes) {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, mins] = time.split(':').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day, hours, mins + minutes));
  const datePart = `${result.getUTCFullYear()}${String(result.getUTCMonth() + 1).padStart(2, '0')}${String(result.getUTCDate()).padStart(2, '0')}`;
  const timePart = `${String(result.getUTCHours()).padStart(2, '0')}${String(result.getUTCMinutes()).padStart(2, '0')}00`;
  return { date: datePart, time: timePart };
}

function eventLines(item, userId, now = new Date()) {
  const uid = `selfup-${item.id}-${userId}@selfup`;
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const date = formatDate(item.item_date);
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
  ];

  if (item.start_time) {
    const time = formatTime(item.start_time);
    const end = addMinutes(item.item_date, item.start_time, Number(item.planned_minutes) || 30);
    lines.push(`DTSTART:${date}T${time}`, `DTEND:${end.date}T${end.time}`);
  } else {
    const followingDate = addMinutes(item.item_date, '00:00', 24 * 60);
    lines.push(`DTSTART;VALUE=DATE:${date}`, `DTEND;VALUE=DATE:${followingDate.date}`);
  }

  lines.push(`SUMMARY:${escapeText(item.title)}`);
  if (item.location) lines.push(`LOCATION:${escapeText(item.location)}`);
  if (item.status) lines.push(`STATUS:${item.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`);
  lines.push('END:VEVENT');
  return lines;
}

function foldLine(line) {
  const chunks = [];
  let chunk = '';
  let bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character);
    if (bytes + size > 73) {
      chunks.push(chunk);
      chunk = ` ${character}`;
      bytes = 1 + size;
    } else {
      chunk += character;
      bytes += size;
    }
  }
  chunks.push(chunk);
  return chunks.join('\r\n');
}

function buildCalendar(items, userId, now = new Date()) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Small Wins//Agenda//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const item of items) lines.push(...eventLines(item, userId, now));
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

module.exports = { buildCalendar, escapeText };
