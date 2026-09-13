// University class timetable: pure domain logic, no DOM, no storage.
// A class definition recurs weekly on a set of weekdays (dates.js's
// Monday=0..Sunday=6 convention) between an optional startDate/endDate —
// left blank, it repeats forever, same philosophy as a tracker having no
// built-in end date. Attendance is a plain per-day boolean (state.classDays),
// the same "presence means true, absence means nothing happened" shape
// trackers use for entries. Mirrors model.js's day-status/streak/stats
// functions one level up: an occurrence day, not every calendar day, is the
// unit a class's streak counts over.

import { addDays, todayKey, weekdayIndex, mondayOf } from './dates.js';

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

// A class's start/duration for one specific weekday — its own `perDayTimes`
// override if it has one for that day (a lecture that runs longer on
// Wednesdays than Mondays, say), otherwise its plain startTime/durationMins.
// One-off events never carry perDayTimes (normalizeClass keeps it null for
// them), so this always falls through to the plain fields for those.
export function classTimeForDay(cls, dayIndex) {
  const override = cls.perDayTimes && cls.perDayTimes[dayIndex];
  return override
    ? { startTime: override.startTime, durationMins: override.durationMins }
    : { startTime: cls.startTime, durationMins: cls.durationMins };
}

// Same, resolved for a specific calendar date rather than a bare weekday —
// what a tile row or day-detail sheet needs to show that day's real time.
export function classTimeFor(cls, dateKey) {
  return classTimeForDay(cls, weekdayIndex(dateKey));
}

// Does this class meet on this calendar day at all. A one-off event (`date`
// set) meets only on that exact date, full stop — `days`/`startDate`/
// `endDate`/`offWeeks` are meaningless for it and normalizeClass keeps them
// empty. Otherwise: weekday matches, the date falls inside its start/end
// range, and its whole Monday-of-week isn't flagged an off week (a
// semester break or public holiday week — the class simply didn't meet,
// same as if it never existed for that week: it won't count toward
// scheduled/attended, streaks, or the calendar). Ignores `archived` on
// purpose: history needs to judge past occurrences of a class you've since
// archived exactly as it always did.
export function classOccursOn(cls, dateKey) {
  if (cls.date) return dateKey === cls.date;
  if (cls.startDate && dateKey < cls.startDate) return false;
  if (cls.endDate && dateKey > cls.endDate) return false;
  if (cls.offWeeks && cls.offWeeks.includes(mondayOf(dateKey))) return false;
  return cls.days.includes(weekdayIndex(dateKey));
}

export function isOneOff(cls) {
  return !!cls.date;
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

// The next occurrence on or after `from` (inclusive). A one-off (`date`
// set — including an exam, which can sit years out) needs no search at
// all; a recurring class is searched day by day, bounded to a year out so
// one whose endDate has passed, or with an impossible schedule, doesn't
// spin forever.
export function nextOccurrence(cls, from = todayKey()) {
  if (cls.date) return cls.date >= from ? cls.date : null;
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

// ---- exams ----
// An exam is a one-off class (`date` set) flagged `isExam` for extra
// visibility: brighter calendar cells and reminder notifications ahead of
// the date, rather than attendance tracking day to day like a real class.

// Preset reminder offsets (days before the exam date) offered in the
// editor — a fixed menu rather than a free-typed number, since "3 days
// before" covers what anyone actually wants and a bad free-typed value
// could silently produce a reminder that never fires.
export const EXAM_REMINDER_PRESETS = [
  { days: 0, label: 'same day' },
  { days: 1, label: '1 day before' },
  { days: 3, label: '3 days before' },
  { days: 7, label: '1 week before' },
  { days: 14, label: '2 weeks before' },
  { days: 30, label: '1 month before' },
];

// Every not-yet-happened exam, soonest first — the Classes card's own
// "upcoming exams" list, since an exam (unlike a class) is worth surfacing
// well before the day it actually falls on.
export function upcomingExams(classes, today = todayKey()) {
  return Object.values(classes)
    .filter((c) => c.isExam && !c.archived && c.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// "today" / "tomorrow" / "in 12 days" — the countdown copy for an upcoming
// exam row and its reminder notifications alike.
export function examCountdown(daysAway) {
  if (daysAway <= 0) return 'today';
  if (daysAway === 1) return 'tomorrow';
  return `in ${daysAway} days`;
}

// ---- time-grid layout ----
// Pure positioning math for the Day/Week Apple-Calendar-style views (the
// all-classes overview, js/views/classes.js): given a day's or week's
// scheduled occurrences, where each one sits on a shared vertical hour
// axis and how wide/offset it should be if it overlaps another. No DOM —
// the view turns these numbers into styled elements.

export function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

// "9 AM", "12 PM" — a whole-hour label for the grid's left-hand gutter.
export function hourLabel12(mins) {
  const h = Math.floor(mins / 60) % 24;
  const ap = h < 12 ? 'AM' : 'PM';
  return `${h % 12 || 12} ${ap}`;
}

// The visible [startMin, endMin) window for a day's or week's grid: tight
// around whatever's actually scheduled (an hour of padding either side,
// rounded to whole hours) rather than a fixed one-size-fits-all window, so
// an early lecture or a late lab is never scrolled out of view by default.
// Falls back to a plain 8am–6pm window with nothing scheduled at all, and
// never shrinks below 4 hours total so a single short class doesn't render
// as a comically tall block filling the whole page.
export function timeGridRange(occurrences) {
  if (!occurrences.length) return { startMin: 8 * 60, endMin: 18 * 60 };
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const o of occurrences) {
    const s = timeToMinutes(o.startTime);
    const e = s + o.durationMins;
    if (s < minStart) minStart = s;
    if (e > maxEnd) maxEnd = e;
  }
  let startMin = Math.max(0, Math.floor((minStart - 60) / 60) * 60);
  let endMin = Math.min(24 * 60, Math.ceil((maxEnd + 60) / 60) * 60);
  if (endMin - startMin < 4 * 60) {
    const mid = (startMin + endMin) / 2;
    startMin = Math.max(0, Math.floor((mid - 120) / 60) * 60);
    endMin = Math.min(24 * 60, startMin + 4 * 60);
  }
  return { startMin, endMin };
}

// Side-by-side columns for a single day's occurrences, the same greedy
// layout real calendar apps use for overlapping events: sorted by start
// time, each item takes the first column whose previous occupant has
// already ended, else opens a new one; every item in the same connected
// overlap cluster ends up sharing that cluster's column count so they're
// all the same width. A day with no overlaps at all just gets `cols: 1`
// for every item — full width, the common case for one person's own
// timetable.
export function layoutTimeBlocks(occurrences) {
  const sorted = occurrences
    .map((o) => ({ ...o, _start: timeToMinutes(o.startTime) }))
    .sort((a, b) => a._start - b._start);

  const out = [];
  let cluster = [];
  let clusterEnd = -Infinity;

  const flushCluster = () => {
    if (!cluster.length) return;
    const colEnds = []; // end-minute of the last item placed in each column
    const withCols = cluster.map((item) => {
      let col = colEnds.findIndex((end) => end <= item._start);
      if (col === -1) { col = colEnds.length; colEnds.push(0); }
      colEnds[col] = item._start + item.durationMins;
      return { item, col };
    });
    const cols = colEnds.length;
    for (const { item, col } of withCols) {
      const { _start, ...rest } = item;
      out.push({ ...rest, col, cols });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    if (cluster.length && item._start >= clusterEnd) flushCluster();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item._start + item.durationMins);
  }
  flushCluster();
  return out;
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
