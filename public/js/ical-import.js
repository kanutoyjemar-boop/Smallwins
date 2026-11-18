const IcalImport = (() => {
  const datePattern = /^\d{4}(?:\d{2}){2}$/;
  const dateTimePattern = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/;

  function localDateTime(epoch) {
    const date = new Date(epoch);
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    return { date: dateKey, time };
  }

  function validDate(year, month, day) {
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
  }

  function zonedEpoch(parts, timezone) {
    const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    let epoch = target;
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const values = Object.fromEntries(formatter.formatToParts(new Date(epoch))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]));
      const represented = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
      epoch += target - represented;
    }
    const check = Object.fromEntries(formatter.formatToParts(new Date(epoch))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]));
    if (check.year !== parts.year || check.month !== parts.month || check.day !== parts.day
      || check.hour !== parts.hour || check.minute !== parts.minute) {
      throw new Error('Calendar contains a local time that does not exist in its time zone.');
    }
    return epoch;
  }

  function parseDate(value, parameters) {
    if (parameters.VALUE === 'DATE' || datePattern.test(value)) {
      if (!datePattern.test(value)) return null;
      if (!validDate(Number(value.slice(0, 4)), Number(value.slice(4, 6)), Number(value.slice(6, 8)))) return null;
      return {
        date: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`,
        time: null,
        allDay: true,
      };
    }
    const match = value.match(dateTimePattern);
    if (!match) return null;
    const [, yearText, monthText, dayText, hourText, minuteText, secondText = '00', utc] = match;
    const parts = {
      year: Number(yearText),
      month: Number(monthText),
      day: Number(dayText),
      hour: Number(hourText),
      minute: Number(minuteText),
      second: Number(secondText),
    };
    if (!validDate(parts.year, parts.month, parts.day)
      || parts.hour > 23 || parts.minute > 59 || parts.second > 59) return null;
    let epoch;
    if (utc) epoch = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    else if (parameters.TZID) epoch = zonedEpoch(parts, parameters.TZID);
    else epoch = new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second).getTime();
    return { ...localDateTime(epoch), allDay: false };
  }

  function unescapeText(value) {
    return value.replace(/\\[nN]/g, ' ').replace(/\\([,;\\])/g, '$1').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  }

  function property(line) {
    const colon = line.indexOf(':');
    if (colon < 0) return null;
    const [name, ...rawParameters] = line.slice(0, colon).split(';');
    const parameters = {};
    for (const raw of rawParameters) {
      const separator = raw.indexOf('=');
      if (separator > 0) parameters[raw.slice(0, separator).toUpperCase()] = raw.slice(separator + 1).replace(/^"|"$/g, '');
    }
    return { name: name.toUpperCase(), parameters, value: line.slice(colon + 1) };
  }

  function parse(text) {
    if (typeof text !== 'string' || text.length > 2 * 1024 * 1024) {
      throw new Error('Choose an iCalendar file smaller than 2 MB.');
    }
    const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    const events = [];
    let current = null;
    let skipped = 0;
    for (const line of lines) {
      if (/^BEGIN:VEVENT$/i.test(line)) {
        current = {};
        continue;
      }
      if (/^END:VEVENT$/i.test(line)) {
        if (!current) continue;
        if (current.RRULE || current.RDATE || current.EXDATE) {
          skipped += 1;
        } else {
          const title = current.SUMMARY ? unescapeText(current.SUMMARY.value).slice(0, 140) : '';
          const start = current.DTSTART && parseDate(current.DTSTART.value, current.DTSTART.parameters);
          const end = current.DTEND && parseDate(current.DTEND.value, current.DTEND.parameters);
          if (!title || !start) {
            skipped += 1;
          } else {
            let plannedMinutes = 30;
            if (start.allDay) plannedMinutes = 30;
            else if (end) {
              const startEpoch = new Date(`${start.date}T${start.time}:00`).getTime();
              const endEpoch = new Date(`${end.date}T${end.time}:00`).getTime();
              const duration = Math.round((endEpoch - startEpoch) / 60000);
              if (!Number.isFinite(duration) || duration < 1) {
                skipped += 1;
                current = null;
                continue;
              }
              plannedMinutes = Math.min(1440, duration);
            }
            events.push({
              item_date: start.date,
              title,
              location: current.LOCATION ? unescapeText(current.LOCATION.value).slice(0, 200) || null : null,
              start_time: start.allDay ? null : start.time,
              planned_minutes: plannedMinutes,
            });
          }
        }
        current = null;
        if (events.length > 200) throw new Error('Calendar imports are limited to 200 events.');
        continue;
      }
      if (!current) continue;
      const entry = property(line);
      if (entry && ['SUMMARY', 'LOCATION', 'DTSTART', 'DTEND', 'RRULE', 'RDATE', 'EXDATE'].includes(entry.name)) {
        current[entry.name] = entry.name === 'RRULE' || entry.name === 'RDATE' || entry.name === 'EXDATE'
          ? true
          : entry;
      }
    }
    if (!events.length && !skipped) throw new Error('No supported one-time calendar events were found.');
    const dates = events.map((event) => event.item_date).sort();
    if (Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`) > 89 * 86400000) {
      throw new Error('Calendar events must fit within a 90-day range.');
    }
    return { events, skipped };
  }

  return { parse };
})();

if (typeof window !== 'undefined') window.IcalImport = IcalImport;
if (typeof module !== 'undefined') module.exports = IcalImport;
