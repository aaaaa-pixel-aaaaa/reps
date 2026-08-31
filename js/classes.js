// University class timetable: pure domain logic, no DOM, no storage.
// A class definition recurs weekly on a set of weekdays (dates.js's
// Monday=0..Sunday=6 convention) between an optional startDate/endDate —
// left blank, it repeats forever, same philosophy as a tracker having no
// built-in end date. Attendance is a plain per-day boolean (state.classDays),
// the same "presence means true, absence means nothing happened" shape
// trackers use for entries. Mirrors model.js's day-status/streak/stats
// functions one level up: an occurrence day, not every calendar day, is the
// unit a class's streak counts over.

import { addDays, todayKey, weekdayIndex } from './dates.js';

const pad2 = (n) => String(n).padStart(2, '0');

// "09:00" -> "9:00 am"
export function fmtTime12(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const ap = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 || 12;
  return `${h12}:${pad2(m)} ${ap}`;
}

// "09:00" + 90 -> "10:30" (wraps past midnight rather than overflowing)
export function addMinutesToTime(hhmm, mins) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const total = ((h * 60 + m + mins) % 1440 + 1440) % 1440;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

export function classEndTime(cls) {
  return addMinutesToTime(cls.startTime, cls.durationMins);
}

// "9:00 am – 10:00 am"
export function classTimeRange(cls) {
  return `${fmtTime12(cls.startTime)} – ${fmtTime12(classEndTime(cls))}`;
}

// Does this class meet on this calendar day at all — weekday matches and
// (if set) the date falls inside its start/end range. Ignores `archived`
// on purpose: history needs to judge past occurrences of a class you've
// since archived exactly as it always did.
export function classOccursOn(cls, dateKey) {
  if (cls.startDate && dateKey < cls.startDate) return false;
  if (cls.endDate && dateKey > cls.endDate) return false;
  return cls.days.includes(weekdayIndex(dateKey));
}

export function isClassDone(classDays, dateKey, classId) {
  const day = classDays[dateKey];
  return !!(day && day[classId] && day[classId].done);
}

// Every class meeting on this day, soonest first — including archived ones,
// since a past day's roster shouldn't change just because a class was later
// archived (the same reasoning classOccursOn's own doc comment gives).
export function classesOccurringOn(classes, dateKey) {
  return Object.values(classes)
    .filter((c) => classOccursOn(c, dateKey))
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.name.localeCompare(b.name));
}

// Today's schedule, soonest first — archived classes never show up here
// (they're done for the semester), unlike classesOccurringOn above.
export function classesForDay(classes, dateKey) {
  return classesOccurringOn(classes, dateKey).filter((c) => !c.archived);
}

// How many of the day's classes were attended, across every class at once —
// the building block for the all-classes overview calendar. `ratio` is
// null when nothing was scheduled that day, since there's nothing to judge
// (the same "absent means unknown, not zero" rule nutrition.js follows).
export function dayAttendance(classes, classDays, dateKey) {
  const scheduled = classesOccurringOn(classes, dateKey);
  if (!scheduled.length) return { scheduled: 0, attended: 0, ratio: null };
  const attended = scheduled.filter((c) => isClassDone(classDays, dateKey, c.id)).length;
  return { scheduled: scheduled.length, attended, ratio: attended / scheduled.length };
}

export function todayClassSummary(classes, classDays, dateKey = todayKey()) {
  const list = classesForDay(classes, dateKey);
  const done = list.filter((c) => isClassDone(classDays, dateKey, c.id)).length;
  return { total: list.length, done };
}

// Calendar cell status, same vocabulary as model.js's dayStatus /
// nutrition.js's nutrientDayStatus: 'future' | 'pending' (today, not yet
// marked) | 'hit' (attended) | 'miss' (scheduled, not attended, past) |
// 'empty' (not scheduled that day, or before the class existed).
export function classDayStatus(cls, classDays, dateKey, today = todayKey()) {
  if (!classOccursOn(cls, dateKey)) return 'empty';
  if (cls.createdAt && dateKey < cls.createdAt) return 'empty';
  if (dateKey > today) return 'future';
  if (isClassDone(classDays, dateKey, cls.id)) return 'hit';
  if (dateKey === today) return 'pending';
  return 'miss';
}

// The next occurrence on or after `from` (inclusive), searched up to a
// year out — bounded so a class whose endDate has passed, or one with an
// impossible schedule, doesn't spin forever.
export function nextOccurrence(cls, from = todayKey()) {
  let d = from;
  for (let i = 0; i < 366; i++) {
    if (classOccursOn(cls, d)) return d;
    if (cls.endDate && d > cls.endDate) return null;
    d = addDays(d, 1);
  }
  return null;
}

// All-time attendance: scheduled/attended counts plus current & longest
// streaks counted over occurrence days only — a day this class doesn't
// meet on neither extends nor breaks the run, exactly like model.js's
// weekly-cadence streaks skip non-obligated days one level up.
export function classStats(cls, classDays, today = todayKey()) {
  const from = cls.startDate && cls.startDate > cls.createdAt ? cls.startDate : cls.createdAt;
  const to = cls.endDate && cls.endDate < today ? cls.endDate : today;
  const s = { scheduled: 0, attended: 0, currentStreak: 0, longestStreak: 0 };
  if (!from || from > to) return s;

  let run = 0;
  let best = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!classOccursOn(cls, d)) continue;
    s.scheduled++;
    if (isClassDone(classDays, d, cls.id)) {
      s.attended++;
      run++;
      if (run > best) best = run;
    } else if (d !== today) {
      run = 0; // today still in progress doesn't reset the run
    }
  }
  s.longestStreak = best;

  let cur = 0;
  let d = to;
  if (d === today && classOccursOn(cls, d) && !isClassDone(classDays, d, cls.id)) d = addDays(d, -1);
  while (d >= from) {
    if (classOccursOn(cls, d)) {
      if (!isClassDone(classDays, d, cls.id)) break;
      cur++;
    }
    d = addDays(d, -1);
  }
  s.currentStreak = cur;
  return s;
}

// All-time attendance across every class at once, for the "all classes"
// overview: total attended/scheduled, plus a streak of "perfect" days — a
// day with at least one class where every one of them was attended.
// Deleting a class loses its history from this tally too (the same
// trade-off deleting a tracker already makes for todaySummary/streaks).
export function allClassesStats(classes, classDays, today = todayKey()) {
  const s = { scheduled: 0, attended: 0, currentStreak: 0, longestStreak: 0 };
  const createdAts = Object.values(classes).map((c) => c.createdAt).filter(Boolean);
  if (!createdAts.length) return s;
  const from = createdAts.reduce((a, b) => (a < b ? a : b));
  if (from > today) return s;

  let run = 0;
  let best = 0;
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const day = dayAttendance(classes, classDays, d);
    if (!day.scheduled) continue;
    s.scheduled += day.scheduled;
    s.attended += day.attended;
    if (day.attended === day.scheduled) {
      run++;
      if (run > best) best = run;
    } else if (d !== today) {
      run = 0; // today still in progress doesn't reset the run
    }
  }
  s.longestStreak = best;

  let cur = 0;
  let d = today;
  const todayDay = dayAttendance(classes, classDays, d);
  if (todayDay.scheduled && todayDay.attended < todayDay.scheduled) d = addDays(d, -1);
  while (d >= from) {
    const day = dayAttendance(classes, classDays, d);
    if (day.scheduled) {
      if (day.attended < day.scheduled) break;
      cur++;
    }
    d = addDays(d, -1);
  }
  s.currentStreak = cur;
  return s;
}
