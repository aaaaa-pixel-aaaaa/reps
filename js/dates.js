// Local-time date utilities. Every date in the app is a "YYYY-MM-DD" string
// derived from LOCAL time (the user's wall clock), never UTC. Weeks start on
// Monday.

export const DAY_MS = 86400000;

const pad2 = (n) => String(n).padStart(2, '0');

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_3 = MONTHS.map((m) => m.slice(0, 3));
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const WEEKDAYS_MIN = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function keyOf(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// "YYYY-MM-DD" -> Date at local midnight.
export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey() {
  return keyOf(new Date());
}

export function isValidKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  return keyOf(parseKey(key)) === key; // rejects overflow dates like 2026-02-30
}

export function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return keyOf(d);
}

// Whole days from a to b (positive when b is later). Local midnights can be
// 23-25h apart across DST transitions; rounding absorbs that.
export function daysBetween(a, b) {
  return Math.round((parseKey(b) - parseKey(a)) / DAY_MS);
}

// 0 = Monday ... 6 = Sunday
export function weekdayIndex(key) {
  return (parseKey(key).getDay() + 6) % 7;
}

export function monthOf(key) {
  const d = parseKey(key);
  return { y: d.getFullYear(), m: d.getMonth() };
}

export function addMonths({ y, m }, delta) {
  const t = y * 12 + m + delta;
  return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
}

export function cmpMonth(a, b) {
  return (a.y * 12 + a.m) - (b.y * 12 + b.m);
}

export function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

// Monday-first weeks covering the month: array of rows, each 7 cells of
// date key or null padding.
export function monthGrid(y, m) {
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  const total = daysInMonth(y, m);
  for (let d = 1; d <= total; d++) cells.push(`${y}-${pad2(m + 1)}-${pad2(d)}`);
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function monthLabel({ y, m }) {
  return `${MONTHS[m]} ${y}`;
}

// "Monday 14 July"
export function longDate(key) {
  const d = parseKey(key);
  return `${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// "Tue 14 Jul" (+ year when not the current year)
export function shortDate(key, today = todayKey()) {
  const d = parseKey(key);
  const wd = WEEKDAYS[(d.getDay() + 6) % 7].slice(0, 3);
  const base = `${wd} ${d.getDate()} ${MONTHS_3[d.getMonth()]}`;
  return key.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${d.getFullYear()}`;
}

// Epoch ms -> "2:05 pm" local
export function timeOf(ms) {
  const d = new Date(ms);
  let h = d.getHours();
  const ap = h < 12 ? 'am' : 'pm';
  h = h % 12 || 12;
  return `${h}:${pad2(d.getMinutes())} ${ap}`;
}
