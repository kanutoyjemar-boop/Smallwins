function toDateKey(date) {
  if (date == null) return null;
  if (typeof date === 'string') {
    const match = date.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
    throw new Error(`Unsupported date string: ${date}`);
  }
  const value = date instanceof Date ? date : new Date(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayKey() {
  return toDateKey(new Date());
}

function parseDateKey(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date key: ${value}`);
  }
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function addDays(dateKey, offset) {
  const base = parseDateKey(dateKey);
  base.setDate(base.getDate() + offset);
  return toDateKey(base);
}

module.exports = { toDateKey, todayKey, parseDateKey, addDays };
