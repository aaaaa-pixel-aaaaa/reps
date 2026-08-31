// Sanity tests for the tricky bits. Run with:  node tests/run-tests.mjs
import {
  keyOf, parseKey, todayKey, isValidKey, addDays, daysBetween, weekdayIndex,
  monthGrid, monthOf, addMonths, cmpMonth, daysInMonth,
  mondayOf, addWeeks, weekLabel, firstOfMonth, lastOfMonth,
} from '../js/dates.js';
import {
  computedTarget, effectiveTarget, isHit, dayStatus, currentStreak,
  longestStreak, trackerStats, todaySummary, fmtAmount, fmtMinutes,
  habitCount, habitTarget, hitIntensity, rangeStats, periodIntensity,
  pomodoroWorkElapsedMs, pomodoroRemainingMs, advancePomodoro, skipPomodoro,
  DEFAULT_POMODORO_CYCLES_FOR_LONG_BREAK, weekProgress,
} from '../js/model.js';
import { createStore, normalizeState, validateImport, seedState, demoState } from '../js/store.js';
import {
  fmtTime12, addMinutesToTime, classEndTime, classTimeRange, classTimeForDay, classTimeFor,
  classOccursOn, isClassDone, classesForDay, classesOccurringOn, dayAttendance, todayClassSummary,
  classDayStatus, nextOccurrence, classStats, allClassesStats,
} from '../js/classes.js';
import { pinnedTrackers, groupTrackers, reorderContext } from '../js/model.js';
import { wrapDelta, stepsFor, angleAt } from '../js/wheel.js';
import {
  nutrientCurrent, nutrientCoverage, dayEntries, alwaysNutrients, groupedNutrients,
  nutrientHue, dayQualifies, computeAlerts, computeUpperLimitAlerts, computeAllAlerts,
  summarizeAlerts, directionGlyph, nutrientRailMax, nutrientBand, nutrientBarModel,
  nutrientTicks, TICK_PRIORITY, nutrientHit, nutrientDayStatus, allGoalsHit,
  nutritionCurrentStreak, nutritionLongestStreak, nutritionStats,
} from '../js/nutrition.js';

let passed = 0;
let failed = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}\n  expected ${e}\n  got      ${a}`);
  }
}
const ok = (cond, label) => eq(!!cond, true, label);

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

// ---------- dates ----------
eq(keyOf(new Date(2026, 6, 14)), '2026-07-14', 'keyOf pads');
eq(keyOf(parseKey('2026-07-14')), '2026-07-14', 'parse/format roundtrip');
ok(parseKey('2026-07-14').getHours() === 0, 'parseKey is local midnight');

eq(addDays('2026-01-31', 1), '2026-02-01', 'month boundary forward');
eq(addDays('2026-03-01', -1), '2026-02-28', 'non-leap Feb backward');
eq(addDays('2024-02-28', 1), '2024-02-29', 'leap day forward');
eq(addDays('2024-02-29', 1), '2024-03-01', 'past leap day');
eq(addDays('2026-12-31', 1), '2027-01-01', 'year boundary');
eq(addDays('2026-07-14', -365), '2025-07-14', 'year back');

eq(daysBetween('2026-07-01', '2026-07-14'), 13, 'daysBetween simple');
eq(daysBetween('2026-07-14', '2026-07-01'), -13, 'daysBetween negative');
eq(daysBetween('2024-02-01', '2024-03-01'), 29, 'daysBetween leap Feb');
// Sydney DST starts first Sunday of October (2026-10-04): local midnights 23h apart.
eq(daysBetween('2026-10-03', '2026-10-05'), 2, 'daysBetween across DST spring-forward');
eq(daysBetween('2026-04-04', '2026-04-06'), 2, 'daysBetween across DST fall-back');

eq(weekdayIndex('2026-07-13'), 0, 'Monday is 0');
eq(weekdayIndex('2026-07-14'), 1, 'Tuesday is 1');
eq(weekdayIndex('2026-07-19'), 6, 'Sunday is 6');

eq(isValidKey('2024-02-29'), true, 'valid leap key');
eq(isValidKey('2026-02-29'), false, 'invalid leap key');
eq(isValidKey('2026-13-01'), false, 'invalid month');
eq(isValidKey('2026-7-14'), false, 'unpadded rejected');
eq(isValidKey('garbage'), false, 'garbage rejected');

{
  // July 2026 starts on a Wednesday -> two leading nulls, 31 days.
  const g = monthGrid(2026, 6);
  eq(g[0].slice(0, 3), [null, null, '2026-07-01'], 'July 2026 leading pad');
  eq(g.flat().filter(Boolean).length, 31, 'July has 31 cells');
  eq(g[g.length - 1][4], '2026-07-31', 'July 31 lands on Friday col');
  ok(g.every((w) => w.length === 7), 'weeks are 7 wide');
}
{
  // June 2026 starts on Monday -> zero pad.
  const g = monthGrid(2026, 5);
  eq(g[0][0], '2026-06-01', 'Monday-start month has no pad');
}
{
  // Feb 2024: leap year, 29 days; Feb 1 2024 is a Thursday (index 3).
  const g = monthGrid(2024, 1);
  eq(g.flat().filter(Boolean).length, 29, 'Feb 2024 has 29 days');
  eq(g[0][3], '2024-02-01', 'Feb 2024 starts Thursday');
}
eq(daysInMonth(2025, 1), 28, 'Feb 2025 has 28');
eq(addMonths({ y: 2026, m: 0 }, -1), { y: 2025, m: 11 }, 'addMonths wraps back');
eq(addMonths({ y: 2026, m: 11 }, 1), { y: 2027, m: 0 }, 'addMonths wraps forward');
ok(cmpMonth(monthOf('2026-07-14'), { y: 2026, m: 6 }) === 0, 'monthOf');

// ---------- model: targets ----------
const counter = (over = {}) => ({
  id: 'c1', type: 'counter', dec: false, createdAt: '2026-06-01',
  target: { base: 50, mode: 'none', inc: 0, start: '2026-06-01' }, ...over,
});
eq(computedTarget(counter(), '2026-07-14'), 50, 'flat target');
{
  const t = counter({ target: { base: 50, mode: 'daily', inc: 1, start: '2026-07-01' } });
  eq(computedTarget(t, '2026-07-01'), 50, 'daily progression at anchor');
  eq(computedTarget(t, '2026-07-14'), 63, 'daily progression +13');
  eq(computedTarget(t, '2026-06-20'), 50, 'before anchor clamps to base');
}
{
  const t = counter({ target: { base: 30, mode: 'weekly', inc: 5, start: '2026-05-05' } });
  eq(computedTarget(t, '2026-05-05'), 30, 'weekly at anchor');
  eq(computedTarget(t, '2026-05-11'), 30, 'weekly day 6 still base');
  eq(computedTarget(t, '2026-05-12'), 35, 'weekly day 7 steps up');
  eq(computedTarget(t, '2026-07-14'), 80, 'weekly after 10 weeks');
}
eq(effectiveTarget(counter(), '2026-07-14', { goalOverride: 20, total: 0, sets: [] }), 20, 'override wins');
eq(effectiveTarget(counter(), '2026-07-14', { total: 10, sets: [] }), 50, 'no override -> computed');

// ---------- model: hits and status ----------
{
  const t = counter();
  ok(isHit(t, { total: 50, sets: [] }, '2026-07-14'), 'exact hit');
  ok(!isHit(t, { total: 49, sets: [] }, '2026-07-14'), 'one short');
  ok(isHit(t, { total: 0, sets: [], goalOverride: 0 }, '2026-07-14'), 'override 0 = rest day hit');
  ok(!isHit(t, undefined, '2026-07-14'), 'no entry no hit');
  const noGoal = counter({ target: { base: 0, mode: 'none', inc: 0, start: '2026-06-01' } });
  ok(isHit(noGoal, { total: 5, sets: [] }, '2026-07-14'), 'goalless counter: activity = hit');
  ok(!isHit(noGoal, { total: 0, sets: [] }, '2026-07-14'), 'goalless counter: nothing = no hit');
}
{
  const t = counter();
  const days = {
    '2026-07-10': { c1: { total: 50, sets: [{ a: 50, t: 1 }] } },
    '2026-07-11': { c1: { total: 20, sets: [{ a: 20, t: 1 }] } },
  };
  const today = '2026-07-14';
  eq(dayStatus(t, days, '2026-07-10', today), 'hit', 'status hit');
  eq(dayStatus(t, days, '2026-07-11', today), 'partial', 'status partial');
  eq(dayStatus(t, days, '2026-07-12', today), 'miss', 'status miss');
  eq(dayStatus(t, days, '2026-05-01', today), 'empty', 'before createdAt = empty');
  eq(dayStatus(t, days, '2026-07-14', today), 'pending', 'today untouched = pending');
  eq(dayStatus(t, days, '2026-07-20', today), 'future', 'future');
  const habit = { id: 'h1', type: 'habit', createdAt: '2026-07-01' };
  const hdays = { '2026-07-13': { h1: { done: true } } };
  eq(dayStatus(habit, hdays, '2026-07-13', today), 'hit', 'habit done');
  eq(dayStatus(habit, hdays, '2026-07-12', today), 'miss', 'habit missed');
}

// ---------- model: streaks ----------
{
  const t = counter();
  const hit = (total = 50) => ({ c1: { total, sets: [{ a: total, t: 1 }] } });
  const days = {
    '2026-07-08': hit(), '2026-07-09': hit(), '2026-07-10': hit(),
    '2026-07-12': hit(), '2026-07-13': hit(),
  };
  eq(currentStreak(t, days, '2026-07-14'), 2, 'today pending keeps yesterday streak');
  days['2026-07-14'] = hit();
  eq(currentStreak(t, days, '2026-07-14'), 3, 'today hit extends streak');
  eq(longestStreak(t, days, '2026-07-14'), 3, 'longest = 3');
  days['2026-07-11'] = hit();
  eq(longestStreak(t, days, '2026-07-14'), 7, 'retro fill joins runs');
  eq(currentStreak(t, days, '2026-07-14'), 7, 'current after retro fill');
  days['2026-07-11'] = { c1: { total: 10, sets: [{ a: 10, t: 1 }] } };
  eq(currentStreak(t, days, '2026-07-14'), 3, 'retro partial splits streak again');
  days['2026-07-11'] = { c1: { total: 0, sets: [], goalOverride: 0 } };
  eq(currentStreak(t, days, '2026-07-14'), 7, 'rest-day override bridges streak');
}
{
  const habit = { id: 'h1', type: 'habit', createdAt: '2026-07-01' };
  const days = {};
  for (let d = '2026-07-05'; d <= '2026-07-13'; d = addDays(d, 1)) days[d] = { h1: { done: true } };
  eq(currentStreak(habit, days, '2026-07-14'), 9, 'habit streak, today pending');
  eq(longestStreak(habit, days, '2026-07-14'), 9, 'habit longest');
}

// ---------- model: weekly cadence ----------
// A tracker can require its goal on only some number of days a week
// (tracker.cadence) instead of every day. Weeks are Monday-start.
{
  // dayStatus: an off day for a weekly-cadence tracker reads as 'empty',
  // never 'miss' — hit/partial/pending/future are unaffected.
  const t = counter({ cadence: { enabled: true, timesPerWeek: 3 }, createdAt: '2026-07-01' });
  const days = {
    '2026-07-10': { c1: { total: 50, sets: [{ a: 50, t: 1 }] } },
    '2026-07-11': { c1: { total: 20, sets: [{ a: 20, t: 1 }] } },
  };
  const today = '2026-07-14';
  eq(dayStatus(t, days, '2026-07-10', today), 'hit', 'weekly cadence: hit unaffected');
  eq(dayStatus(t, days, '2026-07-11', today), 'partial', 'weekly cadence: real partial effort still shows');
  eq(dayStatus(t, days, '2026-07-12', today), 'empty', 'weekly cadence: off day reads empty, not miss');
  eq(dayStatus(t, days, today, today), 'pending', 'weekly cadence: today untouched still pending');
  eq(dayStatus(t, days, '2026-07-20', today), 'future', 'weekly cadence: future unaffected');
}
{
  // currentStreak/longestStreak: quota-met weeks (Mon-Sun), reusing
  // rangeStats. today = Wed 2026-07-15, inside the week Mon 07-13..Sun 07-19.
  const habit = { id: 'h1', type: 'habit', createdAt: '2026-06-22', cadence: { enabled: true, timesPerWeek: 3 } };
  const hit = (d) => ({ h1: { count: 1 } });
  const days = {
    // three full prior weeks, each hit exactly quota (Mon/Tue/Wed)
    '2026-06-22': hit(), '2026-06-23': hit(), '2026-06-24': hit(),
    '2026-06-29': hit(), '2026-06-30': hit(), '2026-07-01': hit(),
    '2026-07-06': hit(), '2026-07-07': hit(), '2026-07-08': hit(),
    // current week (07-13..07-19): only one hit so far
    '2026-07-13': hit(),
  };
  const today = '2026-07-15';
  eq(currentStreak(habit, days, today), 3,
    'weekly streak: quota not yet met this week does not break 3 prior qualifying weeks');
  eq(longestStreak(habit, days, today), 3,
    'weekly longest: an in-progress, not-yet-quota-met current week does not reset an established best');

  // meeting quota by today extends the streak to include this week
  days['2026-07-14'] = hit();
  days['2026-07-15'] = hit();
  eq(currentStreak(habit, days, today), 4, 'weekly streak: meeting quota mid-week counts the current week');

  // a fully-elapsed past week that missed quota breaks the streak, even
  // though an earlier week further back met it
  delete days['2026-07-07'];
  delete days['2026-07-08'];
  eq(currentStreak(habit, days, today), 1,
    'weekly streak: a missed, fully-elapsed week breaks continuity regardless of older history');
}
{
  // longestStreak: an earlier, better run survives a gap rather than being
  // shadowed by whatever the trailing run happens to be.
  const habit = { id: 'h1', type: 'habit', createdAt: '2026-06-29', cadence: { enabled: true, timesPerWeek: 3 } };
  const hit3 = (monday) => ({
    [monday]: { h1: { count: 1 } },
    [addDays(monday, 1)]: { h1: { count: 1 } },
    [addDays(monday, 2)]: { h1: { count: 1 } },
  });
  const days = {
    ...hit3('2026-06-29'), ...hit3('2026-07-06'), // weeks 1-2: run of 2
    // week 3 (07-13..19): no hits, breaks the run
    ...hit3('2026-07-20'), ...hit3('2026-07-27'), ...hit3('2026-08-03'), // weeks 4-6: run of 3
    // week containing today (08-17..23): no hits yet, in progress
  };
  eq(longestStreak(habit, days, '2026-08-19'), 3, 'weekly longest: a later, longer run beats the earlier one');
}
{
  // weekProgress: hit-days-so-far vs quota for the current, partially
  // elapsed week.
  const habit = { id: 'h1', type: 'habit', cadence: { enabled: true, timesPerWeek: 3 } };
  const days = { '2026-07-13': { h1: { count: 1 } }, '2026-07-14': { h1: { count: 1 } } };
  eq(weekProgress(habit, days, '2026-07-15'), { hitDays: 2, quota: 3, met: false },
    'weekProgress reports hit days so far against quota, not yet met');
}
{
  // todaySummary: a weekly-cadence tracker has no fixed daily obligation,
  // so it's excluded from the tally whether or not it was hit today.
  const trackers = {
    w: { id: 'w', type: 'habit', perDay: 1, cadence: { enabled: true, timesPerWeek: 3 } },
    d: { id: 'd', type: 'habit', perDay: 1, cadence: { enabled: false, timesPerWeek: 3 } },
  };
  const today = '2026-07-15';
  eq(todaySummary({ trackers, days: { [today]: { w: { count: 1 }, d: { count: 1 } } } }, today),
    { goals: 1, hit: 1 }, 'todaySummary: weekly tracker excluded even when hit today');
  eq(todaySummary({ trackers, days: {} }, today),
    { goals: 1, hit: 0 }, 'todaySummary: weekly tracker excluded even when not hit today');
}

// ---------- model: stats ----------
{
  const t = counter({ dec: true, target: { base: 3, mode: 'none', inc: 0, start: '2026-06-01' } });
  const days = {
    '2026-07-10': { c1: { total: 5.5, sets: [{ a: 2.5, t: 1 }, { a: 3, t: 2 }] } },
    '2026-07-11': { c1: { total: 2, sets: [{ a: 3, t: 3 }, { a: -1, t: 4 }] } },
  };
  const s = trackerStats(t, days, '2026-07-14');
  eq(s.total, 7.5, 'stats total sums days');
  eq(s.sessions, 3, 'negative corrections are not sessions');
  eq(s.goalsHit, 1, 'goals hit counts hits only');
  eq(s.bestDay, { key: '2026-07-10', total: 5.5 }, 'best day');
  ok(Math.abs(s.avgPerSession - 8.5 / 3) < 1e-9, 'avg per session over positive sets');
  eq(fmtAmount(t, 5.5), '5.5', 'decimal formatting');
  eq(fmtAmount(t, 3), '3', 'decimal formatting trims');
}

// ---------- store mutations ----------
{
  const store = createStore({ storage: memStorage(), seed: () => seedState('2026-07-14') });
  const ids = Object.keys(store.state.trackers);
  eq(ids.length, 4, 'seed has 4 trackers');
  ok(store.state.groups.g_fitness, 'seed has Fitness group');

  store.logSet('t_pushups', '2026-07-14', 20, 1000);
  store.logSet('t_pushups', '2026-07-14', 15, 2000);
  eq(store.state.days['2026-07-14'].t_pushups.total, 35, 'logSet accumulates');
  const undone = store.undoLastSet('t_pushups', '2026-07-14');
  eq(undone.a, 15, 'undo returns last set');
  eq(store.state.days['2026-07-14'].t_pushups.total, 20, 'undo recomputes total');
  store.undoLastSet('t_pushups', '2026-07-14');
  ok(!store.state.days['2026-07-14'] || !store.state.days['2026-07-14'].t_pushups,
    'empty entry cleaned up');

  store.setDayTotal('t_crunches', '2026-07-10', 45, 500);
  eq(store.state.days['2026-07-10'].t_crunches.total, 45, 'setDayTotal creates correction');
  store.setDayTotal('t_crunches', '2026-07-10', 30, 600);
  eq(store.state.days['2026-07-10'].t_crunches.total, 30, 'setDayTotal lowers');
  eq(store.state.days['2026-07-10'].t_crunches.sets.length, 2, 'corrections append sets');
  store.setDayTotal('t_crunches', '2026-07-10', 0, 700);
  ok(!store.state.days['2026-07-10'], 'zero total cleans day');

  store.logSet('t_run', '2026-07-13', 2.55, 800);
  eq(store.state.days['2026-07-13'].t_run.total, 2.55, 'decimal rounding to 2dp');
  store.logSet('t_run', '2026-07-13', 0.1, 900);
  eq(store.state.days['2026-07-13'].t_run.total, 2.65, 'no float drift');

  const on = store.toggleHabit('t_stretch', '2026-07-14');
  eq(on, true, 'habit toggles on');
  const off = store.toggleHabit('t_stretch', '2026-07-14');
  eq(off, false, 'habit toggles off');
  ok(!store.state.days['2026-07-14'] || !store.state.days['2026-07-14'].t_stretch,
    'habit off cleans entry');

  store.setGoalOverride('t_pushups', '2026-07-12', 0);
  eq(store.state.days['2026-07-12'].t_pushups.goalOverride, 0, 'override 0 persists');
  ok(isHit(store.state.trackers.t_pushups, store.state.days['2026-07-12'].t_pushups, '2026-07-12'),
    'override 0 hit via store');
  store.setGoalOverride('t_pushups', '2026-07-12', null);
  ok(!store.state.days['2026-07-12'], 'clearing override cleans day');

  // Retro edit changes streaks end-to-end.
  const pu = store.state.trackers.t_pushups;
  store.setDayTotal('t_pushups', '2026-07-12', 50);
  store.setDayTotal('t_pushups', '2026-07-13', 50);
  eq(currentStreak(pu, store.state.days, '2026-07-14'), 2, 'streak before retro gap fill');
  store.setDayTotal('t_pushups', '2026-07-11', 50);
  eq(currentStreak(pu, store.state.days, '2026-07-14'), 3, 'retro edit extends streak');
  store.removeSet('t_pushups', '2026-07-12', 0);
  eq(currentStreak(pu, store.state.days, '2026-07-14'), 1, 'removing a day splits streak');

  // Reorder within Fitness (crunches, run after pushups pinned away).
  const before = store.state.trackers.t_crunches.order < store.state.trackers.t_run.order;
  ok(before, 'crunches before run initially');
  const groupList = [store.state.trackers.t_crunches, store.state.trackers.t_run];
  store.reorderTracker('t_run', -1, groupList);
  ok(store.state.trackers.t_run.order < store.state.trackers.t_crunches.order, 'reorder swaps');

  // Delete removes day data.
  store.logSet('t_crunches', '2026-07-14', 30);
  store.deleteTracker('t_crunches');
  ok(!store.state.trackers.t_crunches, 'tracker deleted');
  ok(!(store.state.days['2026-07-14'] || {}).t_crunches, 'day data deleted with tracker');

  // Group delete ungroups trackers.
  store.deleteGroup('g_fitness');
  eq(store.state.trackers.t_run.groupId, null, 'group delete ungroups');
}

// ---------- time counters ----------
eq(fmtMinutes(0), '0m', 'zero minutes');
eq(fmtMinutes(45), '45m', 'minutes only');
eq(fmtMinutes(60), '1h', 'exact hour');
eq(fmtMinutes(90), '1h 30m', 'hours and minutes');
eq(fmtMinutes(150), '2h 30m', 'multiple hours');
eq(fmtMinutes(-5), '-5m', 'negative correction');
{
  const t = { type: 'counter', time: true, dec: false };
  eq(fmtAmount(t, 75), '1h 15m', 'fmtAmount routes time counters');
  const norm = normalizeState({
    trackers: { x: { id: 'x', name: 'Read', type: 'counter', time: true, dec: true, unit: 'km' } },
  });
  eq(norm.trackers.x.dec, false, 'time counters force integer minutes');
  eq(norm.trackers.x.unit, '', 'time counters have no free-text unit');
  eq(norm.trackers.x.time, true, 'time flag survives normalize');
}

// ---------- multi-count habits ----------
{
  const h3 = { id: 'h3', type: 'habit', perDay: 3, createdAt: '2026-07-01' };
  eq(habitCount({ done: true }), 1, 'legacy done reads as one check');
  eq(habitCount({ count: 2 }), 2, 'count wins');
  eq(habitCount(undefined), 0, 'no entry, no checks');
  eq(habitTarget(h3, undefined), 3, 'target from perDay');
  eq(habitTarget(h3, { goalOverride: 5 }), 5, 'per-day override wins');
  eq(habitTarget({ id: 'h1', type: 'habit' }, undefined), 1, 'missing perDay means 1');

  eq(isHit(h3, { count: 3 }, '2026-07-10'), true, 'hit at perDay');
  eq(isHit(h3, { count: 2 }, '2026-07-10'), false, 'under perDay not hit');
  eq(isHit(h3, { goalOverride: 0 }, '2026-07-10'), true, 'habit rest day always hit');
  const days = { '2026-07-10': { h3: { count: 2 } } };
  eq(dayStatus(h3, days, '2026-07-10', '2026-07-14'), 'partial', 'in-progress habit is partial');

  // normalize: perDay clamps, done converts to count
  const norm = normalizeState({
    trackers: { h: { id: 'h', name: 'Water', type: 'habit', perDay: 4.7 } },
    days: { '2026-07-10': { h: { done: true } }, '2026-07-11': { h: { count: 3 } } },
  });
  eq(norm.trackers.h.perDay, 5, 'perDay rounds');
  eq(norm.days['2026-07-10'].h.count, 1, 'legacy done normalizes to count 1');
  eq(norm.days['2026-07-11'].h.count, 3, 'count preserved');

  // store: taps increment, completing tap wraps to 0, stepper sets directly
  const store = createStore({ storage: memStorage(), seed: () => seedState('2026-07-14') });
  const id = store.addTracker({ name: 'Hydrate', type: 'habit', perDay: 3 });
  eq(store.toggleHabit(id, '2026-07-14'), false, 'first tap not done yet');
  eq(store.toggleHabit(id, '2026-07-14'), false, 'second tap not done yet');
  eq(store.toggleHabit(id, '2026-07-14'), true, 'third tap completes');
  eq(store.state.days['2026-07-14'][id].count, 3, 'count stored');
  eq(store.toggleHabit(id, '2026-07-14'), false, 'tap on complete day clears it');
  eq(store.state.days['2026-07-14'] && store.state.days['2026-07-14'][id], undefined,
    'cleared habit entry cleaned up');
  store.setHabitCount(id, '2026-07-14', 2);
  eq(store.state.days['2026-07-14'][id].count, 2, 'setHabitCount stores');
  store.setHabitCount(id, '2026-07-14', 0);
  eq(store.state.days['2026-07-14'] && store.state.days['2026-07-14'][id], undefined,
    'setHabitCount 0 cleans up');
  eq(store.toggleHabit(id, '2026-07-14', true), true, 'force true jumps to complete');
  eq(store.state.days['2026-07-14'][id].count, 3, 'forced complete stores perDay');

  // streaks recompute off counts
  const hdays = {
    '2026-07-12': { h3: { count: 3 } },
    '2026-07-13': { h3: { count: 3 } },
    '2026-07-14': { h3: { count: 1 } },
  };
  eq(currentStreak(h3, hdays, '2026-07-14'), 2, 'unfinished today does not break streak');
}

// ---------- goal-exceeded colour intensity ----------
{
  const round3 = (x) => Math.round(x * 1000) / 1000;
  const c = { id: 'c1', type: 'counter', target: { base: 10, mode: 'none' } };
  eq(hitIntensity(c, { total: 10 }, '2026-07-10'), 0, 'exactly on target: no boost');
  eq(hitIntensity(c, { total: 9 }, '2026-07-10'), 0, 'under target: no boost');
  eq(round3(hitIntensity(c, { total: 20 }, '2026-07-10')), 0.818, 'double the goal: most of the climb');
  eq(round3(hitIntensity(c, { total: 30 }, '2026-07-10')), 1, 'triple the goal reaches max');
  eq(round3(hitIntensity(c, { total: 60 }, '2026-07-10')), 1, 'far past goal stays capped at max');
  eq(hitIntensity(c, { total: 15, goalOverride: 0 }, '2026-07-10'), 0, 'declared rest day has no target to exceed');
  eq(hitIntensity(c, undefined, '2026-07-10'), 0, 'no entry: no boost');

  const h3i = { id: 'h3i', type: 'habit', perDay: 2 };
  eq(hitIntensity(h3i, { count: 2 }, '2026-07-10'), 0, 'habit exactly at perDay: no boost');
  eq(round3(hitIntensity(h3i, { count: 4 }, '2026-07-10')), 0.818, 'habit double-checked: most of the climb');

  const step1 = hitIntensity(c, { total: 20 }, '2026-07-10') - hitIntensity(c, { total: 10 }, '2026-07-10');
  const step2 = hitIntensity(c, { total: 30 }, '2026-07-10') - hitIntensity(c, { total: 20 }, '2026-07-10');
  ok(step1 > step2, 'asymptotic curve: 1x-2x increases more than 2x-3x');
}

// ---------- weekly/monthly roll-up ----------
{
  eq(mondayOf('2026-07-16'), '2026-07-13', 'Thursday rolls back to its Monday');
  eq(mondayOf('2026-07-13'), '2026-07-13', 'a Monday is its own week start');
  eq(addWeeks('2026-07-13', -1), '2026-07-06', 'addWeeks steps by 7 days');
  eq(weekLabel('2026-07-13', '2026-07-16'), '13–19 Jul', 'week fully inside one month');
  eq(weekLabel('2026-06-29', '2026-07-16'), '29 Jun – 5 Jul', 'week straddling two months');
  eq(firstOfMonth({ y: 2026, m: 6 }), '2026-07-01', 'first of month (0-indexed month 6 = July)');
  eq(lastOfMonth({ y: 2026, m: 6 }), '2026-07-31', 'last of month');
  eq(lastOfMonth({ y: 2026, m: 1 }), '2026-02-28', 'last of Feb in a non-leap year');

  const c = { id: 'c1', type: 'counter', target: { base: 10, mode: 'none' } };
  const cdays = {
    '2026-07-13': { c1: { sets: [], total: 12 } },
    '2026-07-14': { c1: { sets: [], total: 5 } },
    '2026-07-16': { c1: { sets: [], total: 0, goalOverride: 0 } }, // rest day
  };
  const week = rangeStats(c, cdays, '2026-07-13', '2026-07-19', '2026-07-16');
  eq(week.total, 17, 'counter week total sums logged amounts');
  eq(week.hitDays, 2, 'counter week hitDays counts the goal-hit day plus the rest day');
  eq(week.elapsedDays, 4, 'in-progress week only counts elapsed days (Mon-Thu), not the rest of the week');

  const empty = rangeStats(c, {}, '2026-07-13', '2026-07-19', '2026-07-16');
  eq(empty.total, 0, 'no data: zero total');
  eq(empty.elapsedDays, 4, 'no data still counts elapsed days');

  const h = { id: 'h1', type: 'habit', perDay: 2 };
  const hdays2 = {
    '2026-07-13': { h1: { count: 2 } },
    '2026-07-14': { h1: { count: 1 } },
  };
  const hweek = rangeStats(h, hdays2, '2026-07-13', '2026-07-19', '2026-07-16');
  eq(hweek.checks, 3, 'habit week sums check-ins across the period');
  eq(hweek.hitDays, 1, 'habit week only counts days that reached perDay');

  const past = rangeStats(c, cdays, '2026-07-01', '2026-07-31', '2026-07-16');
  eq(past.elapsedDays, 16, 'a month in progress stops counting at "today", not month end');

  eq(week.targetSum, 60, 'targetSum covers the whole nominal week (6 normal days x10, rest day contributes 0), including days not yet elapsed');
  eq(hweek.targetSum, 14, 'habit targetSum: 7 days x perDay 2');

  eq(periodIntensity(0, 60, 0.75, 2), 0, 'nothing logged: no colour');
  eq(periodIntensity(45, 60, 0.75, 2), 0, 'exactly at the lower threshold (0.75x): still no colour');
  eq(periodIntensity(120, 60, 0.75, 2), 1, 'at the upper threshold (2x): fully saturated');
  eq(periodIntensity(240, 60, 0.75, 2), 1, 'past the upper threshold: stays capped');
  eq(periodIntensity(82.5, 60, 0.75, 2), 0.5, 'halfway between 0.75x and 2x: half intensity');
  eq(periodIntensity(10, 0, 0.75, 2), 0, 'no target at all: no colour (avoids divide by zero)');
}

// ---------- live timer ----------
{
  const store = createStore({ storage: memStorage(), seed: () => seedState('2026-07-14') });
  const tid = store.addTracker({ name: 'Focus', type: 'counter', time: true });

  const habitId = store.addTracker({ name: 'Walk', type: 'habit' });
  store.startTimer(habitId);
  eq(store.state.timers[habitId], undefined, 'timer refuses a non-time tracker');
  const plainId = store.addTracker({ name: 'Reps', type: 'counter' });
  store.startTimer(plainId);
  eq(store.state.timers[plainId], undefined, 'timer refuses a non-timed counter');

  eq(store.state.timers[tid], undefined, 'no timer running initially');
  store.startTimer(tid);
  ok(store.state.timers[tid] && isFinite(store.state.timers[tid].startedAt), 'timer recorded with a start time');
  const first = store.state.timers[tid].startedAt;
  store.startTimer(tid); // already running: no-op
  eq(store.state.timers[tid].startedAt, first, 'starting again does not reset an already-running timer');

  // rewind the recorded start to simulate 42.5 minutes having elapsed —
  // this is exactly what surviving a closed app for that long looks like,
  // since elapsed time is always just Date.now() minus this timestamp
  store.state.timers[tid].startedAt = Date.now() - 42.5 * 60000;
  const mins = store.stopTimer(tid, '2026-07-14');
  eq(mins, 43, 'stop rounds elapsed minutes');
  eq(store.state.days['2026-07-14'][tid].total, 43, 'elapsed minutes logged as a set');
  eq(store.state.timers[tid], undefined, 'timer cleared after stopping');

  store.startTimer(tid);
  store.cancelTimer(tid);
  eq(store.state.timers[tid], undefined, 'cancel clears the timer');
  eq(store.state.days['2026-07-14'][tid].total, 43, 'cancel does not log anything');

  eq(store.stopTimer(tid, '2026-07-14'), null, 'stopping with nothing running is a no-op');

  // persists across a reload (a fresh store reading the same storage), not
  // just held in memory
  const storage = memStorage();
  const s1 = createStore({ storage, seed: () => seedState('2026-07-14') });
  const tid2 = s1.addTracker({ name: 'Read', type: 'counter', time: true });
  s1.startTimer(tid2);
  const startedAt = s1.state.timers[tid2].startedAt;
  const s2 = createStore({ storage, seed: () => { throw new Error('should not reseed'); } });
  eq(s2.state.timers[tid2] && s2.state.timers[tid2].startedAt, startedAt,
    'timer persists across reload with its original start time');

  // deleting a tracker drops any timer running for it
  const tid3 = store.addTracker({ name: 'Cook', type: 'counter', time: true });
  store.startTimer(tid3);
  store.deleteTracker(tid3);
  eq(store.state.timers[tid3], undefined, 'deleting a tracker drops its timer');

  // normalizeState drops timers for non-time trackers and unknown ids
  const bad = normalizeState({
    trackers: { p: { id: 'p', name: 'Push-ups', type: 'counter' } },
    timers: { p: { startedAt: Date.now() }, ghost: { startedAt: Date.now() } },
  });
  eq(bad.timers, {}, 'timer dropped for a non-time counter and an unknown tracker');
}

// ---------- pinned strip vs group ordering ----------
{
  const store = createStore({ storage: memStorage(), seed: () => seedState('2026-07-14') });
  // groups list ALL their members now, pinned included
  const fitness = groupTrackers(store.state, 'g_fitness').map((t) => t.id);
  eq(fitness, ['t_pushups', 't_crunches', 't_run'], 'group shows pinned members too');
  const ungrouped = groupTrackers(store.state, null).map((t) => t.id);
  eq(ungrouped, ['t_stretch'], 'ungrouped shows its pinned member');

  // pinning appends to the end of the strip
  store.setTrackerPriority('t_run', true);
  eq(pinnedTrackers(store.state).map((t) => t.id), ['t_pushups', 't_stretch', 't_run'],
    'newly pinned joins strip end');

  // reordering the strip does not change the group's internal order
  const ctxPin = reorderContext(store.state, store.state.trackers.t_run, 'pinned');
  eq(ctxPin.field, 'pinOrder', 'pinned context reorders pinOrder');
  store.reorderTracker('t_run', -1, ctxPin.list, ctxPin.field);
  eq(pinnedTrackers(store.state).map((t) => t.id), ['t_pushups', 't_run', 't_stretch'],
    'strip reorder works');
  eq(groupTrackers(store.state, 'g_fitness').map((t) => t.id),
    ['t_pushups', 't_crunches', 't_run'], 'group order untouched by strip reorder');

  // reordering inside the group does not change the strip
  const ctxGrp = reorderContext(store.state, store.state.trackers.t_run, 'group');
  eq(ctxGrp.field, 'order', 'group context reorders order');
  store.reorderTracker('t_run', -1, ctxGrp.list, ctxGrp.field);
  eq(groupTrackers(store.state, 'g_fitness').map((t) => t.id),
    ['t_pushups', 't_run', 't_crunches'], 'group reorder works');
  eq(pinnedTrackers(store.state).map((t) => t.id), ['t_pushups', 't_run', 't_stretch'],
    'strip untouched by group reorder');

  // unpin + repin lands at the end again
  store.setTrackerPriority('t_run', false);
  store.setTrackerPriority('t_run', true);
  eq(pinnedTrackers(store.state).map((t) => t.id), ['t_pushups', 't_stretch', 't_run'],
    'repin appends to strip end');

  // editor-path pinning (updateTracker) appends too
  store.updateTracker('t_crunches', { priority: true });
  eq(pinnedTrackers(store.state).map((t) => t.id),
    ['t_pushups', 't_stretch', 't_run', 't_crunches'], 'updateTracker pin appends');

  // legacy data without pinOrder falls back to order
  const legacy = normalizeState(JSON.parse(JSON.stringify(seedState('2026-07-14')), (k, v) =>
    k === 'pinOrder' ? undefined : v));
  eq(pinnedTrackers(legacy).map((t) => t.id), ['t_pushups', 't_stretch'],
    'missing pinOrder defaults sanely');
}

// ---------- persistence roundtrip ----------
{
  const storage = memStorage();
  const s1 = createStore({ storage, seed: () => seedState('2026-07-14') });
  s1.logSet('t_pushups', '2026-07-14', 42, 123);
  s1.setGoalOverride('t_run', '2026-07-13', 5);
  const s2 = createStore({ storage, seed: () => { throw new Error('should not reseed'); } });
  eq(s2.state.days['2026-07-14'].t_pushups.total, 42, 'reload keeps totals');
  eq(s2.state.days['2026-07-13'].t_run.goalOverride, 5, 'reload keeps overrides');
}

// ---------- import validation ----------
{
  eq(validateImport(null).ok, false, 'null import rejected');
  eq(validateImport({ hello: 1 }).ok, false, 'foreign object rejected');
  eq(validateImport({ trackers: {} }).ok, false, 'empty trackers rejected');
  const good = validateImport(JSON.parse(JSON.stringify(seedState('2026-07-14'))));
  eq(good.ok, true, 'seed roundtrips through import');
  eq(good.summary.trackers, 4, 'import summary counts trackers');

  // Corrupt bits get dropped, not fatal.
  const messy = JSON.parse(JSON.stringify(seedState('2026-07-14')));
  messy.days['2026-02-30'] = { t_pushups: { total: 10, sets: [{ a: 10, t: 1 }] } };
  messy.days['2026-07-01'] = { ghost: { total: 5, sets: [{ a: 5, t: 1 }] } };
  messy.trackers.t_pushups.chips = ['x', 5, -2, 10];
  const v = validateImport(messy);
  eq(v.ok, true, 'messy import still ok');
  ok(!v.data.days['2026-02-30'], 'invalid date dropped');
  ok(!v.data.days['2026-07-01'], 'unknown tracker entry dropped');
  eq(v.data.trackers.t_pushups.chips, [5, 10], 'chips sanitized');
}

// ---------- demo data ----------
{
  const demo = demoState('2026-07-14');
  ok(Object.keys(demo.days).length > 50, 'demo has weeks of history');
  ok(demo.trackers.t_meditate && demo.groups.g_mind, 'demo has second group');
  const pu = demo.trackers.t_pushups;
  eq(computedTarget(pu, '2026-07-14'), 80, 'demo progression reaches 80 today');
  const again = demoState('2026-07-14');
  eq(JSON.stringify(again), JSON.stringify(demo), 'demo generation is deterministic');
  const stats = trackerStats(pu, demo.days, '2026-07-14');
  ok(stats.longestStreak >= stats.currentStreak, 'longest >= current');
  ok(stats.bestDay && stats.total > 0, 'demo stats populated');
}

// ---------- wheel math ----------
eq(wrapDelta(170, -170), 20, 'wrap across +180 seam');
eq(wrapDelta(-170, 170), -20, 'wrap across -180 seam');
eq(wrapDelta(10, 350), -20, 'near-full-circle reads as small negative');
eq(wrapDelta(0, 90), 90, 'plain delta untouched');
eq(wrapDelta(-90, 90), 180, 'exact 180 stays 180');
eq(stepsFor(359, 18), 19, 'just under 20 steps');
eq(stepsFor(360, 18), 20, 'full rev = 20 steps at 18deg');
eq(stepsFor(-40, 18), 0, 'negative accum clamps to 0');
eq(stepsFor(725, 36), 20, 'two revs at 36deg');
eq(Math.round(angleAt(0, 0, 0, -10)), 0, '12 oclock is 0deg');
eq(Math.round(angleAt(0, 0, 10, 0)), 90, '3 oclock is 90deg');
eq(Math.round(angleAt(0, 0, 0, 10)), 180, '6 oclock is 180deg');
eq(Math.round(angleAt(0, 0, -10, 0)), -90, '9 oclock is -90deg');

// simulate a drag: sequence of raw angles including a seam crossing
{
  let accum = 0;
  let prev = 150;
  for (const a of [170, -175, -150, -120, -90]) {
    accum += wrapDelta(prev, a);
    prev = a;
  }
  // 150->170 (+20), 170->-175 (+15), then +25 +30 +30 = 120 total
  eq(accum, 120, 'drag across seam accumulates continuously');
}

// ---------- nutrition ----------

// -- absent vs zero --
{
  eq(nutrientCurrent(undefined, 'protein'), null, 'no day at all: unknown, not zero');
  eq(nutrientCurrent({ totals: {} }, 'protein'), null, 'nutrient absent from totals: unknown, not zero');
  eq(nutrientCurrent({ totals: { protein: 0 } }, 'protein'), 0, 'an explicit 0 is a real zero, not unknown');
  eq(nutrientCoverage(undefined, 'protein'), 0, 'no day: coverage reads as 0');
  eq(nutrientCoverage({ coverage: { protein: 40 } }, 'protein'), 40, 'coverage passes through');
  eq(dayEntries(undefined), [], 'no day: no entries');
  eq(dayEntries({ entries: [{ item: 'Eggs' }] }).length, 1, 'entries pass through');
}

// -- always-displayed / grouping, driven off the field --
{
  const nutrients = {
    energy: { label: 'Energy', group: 'macro', display: 'always', direction: 'range' },
    protein: { label: 'Protein', group: 'macro', display: 'always', direction: 'min' },
    fibre: { label: 'Fibre', group: 'macro', display: 'always', direction: 'min' },
    satFat: { label: 'Saturated fat', group: 'macro', display: 'monitor', direction: 'max' },
    omega3ALA: { label: 'Omega-3 (ALA)', group: 'fat', display: 'monitor', direction: 'min' },
    zinc: { label: 'Zinc', group: 'mineral', display: 'monitor', direction: 'min' },
  };
  eq(alwaysNutrients(nutrients).map(([k]) => k), ['protein', 'fibre'], 'energy excluded, JSON key order kept, monitor-only skipped');
  const grouped = groupedNutrients(nutrients);
  eq(grouped.map((g) => g.group), ['macro', 'fat', 'mineral'], 'groups in GROUP_ORDER, empty vitamin group omitted');
  eq(grouped[0].items.map(([k]) => k), ['energy', 'protein', 'fibre', 'satFat'], 'group members in JSON key order, both display kinds included');
}

// -- nutrient hue: deterministic, not a single shared accent --
{
  eq(nutrientHue('protein'), nutrientHue('protein'), 'same key always yields the same hue');
  ok(nutrientHue('protein') !== nutrientHue('carbs'), 'different nutrients get different hues');
  const h = nutrientHue('sodium');
  ok(h >= 0 && h < 360, 'hue is a valid degree value');
}

// -- direction glyphs --
{
  // Each arrow carries a trailing U+FE0E (text variation selector) so iOS
  // renders the flat monochrome glyph instead of promoting it to a coloured
  // emoji (the ↕️-in-a-blue-box bug). Checked by exact codepoints, not just
  // string equality, since the selector is invisible in a diff.
  const codepoints = (s) => [...s].map((c) => c.codePointAt(0));
  eq(directionGlyph('min'), '↑︎', 'min glyph');
  eq(directionGlyph('max'), '↓︎', 'max glyph');
  eq(directionGlyph('range'), '↕︎', 'range glyph');
  eq(directionGlyph('none'), '', 'none has no glyph');
  eq(codepoints(directionGlyph('min')), [0x2191, 0xFE0E], 'min glyph is the arrow plus the text-presentation selector');
  eq(codepoints(directionGlyph('range')), [0x2195, 0xFE0E], 'range glyph is the arrow plus the text-presentation selector');
}

// -- schema v6: rail scale --
{
  const round2 = (x) => Math.round(x * 100) / 100;

  const minDef = { target: 150, direction: 'min' }; // e.g. protein: no upperLimit
  eq(round2(nutrientRailMax(minDef, null)), 176.47, 'min, no current: railMax is target/0.85');
  eq(round2(nutrientRailMax(minDef, 75)), 176.47, 'min, current under baseline rail: rail unaffected');
  eq(round2(nutrientRailMax(minDef, 300)), round2(300 / 0.95), 'min, current overflows baseline rail: rail widens to fit it');

  const maxDef = { target: 34, direction: 'max', softMax: 50 }; // e.g. saturated fat
  eq(round2(nutrientRailMax(maxDef, null)), round2(50 / 0.85), 'max: railMax is softMax/0.85, not target/0.85');

  const rangeNoSoftMax = { target: 411, direction: 'range', targetMax: 504 }; // carbs: real AMDR band, no softMax
  eq(round2(nutrientRailMax(rangeNoSoftMax, null)), round2(504 / 0.85), 'range: railMax uses targetMax when there is no softMax');

  const rangeWithSoftMax = { target: 95, direction: 'range', targetMax: 121, softMax: 125 }; // fat: both exist
  eq(round2(nutrientRailMax(rangeWithSoftMax, null)), round2(125 / 0.85), 'range: softMax outranks targetMax for the rail');

  const ulDef = { target: 1000, direction: 'min', upperLimit: 2500 }; // e.g. calcium
  eq(round2(nutrientRailMax(ulDef, 1200)), round2(1200 / 0.95),
    'min w/ UL, current below the 60% proximity threshold: rail only widens to fit current');
  eq(round2(nutrientRailMax(ulDef, 1600)), round2(2500 / 0.9),
    'min w/ UL, current at/above 60% of the UL: rail tightens around the UL');
  eq(round2(nutrientRailMax(ulDef, 3000)), round2(3000 / 0.95),
    'min w/ UL, current overflows even the UL-based rail: rail widens again to fit it');
}

// -- schema v6: the satisfied band --
{
  const minDef = { target: 150, direction: 'min' };
  eq(nutrientBand(minDef, 176.47), { start: 150, end: 176.47, hard: false }, 'min, no UL: band runs to the rail edge, soft');

  const ulDef = { target: 1000, direction: 'min', upperLimit: 2500 };
  eq(nutrientBand(ulDef, 2777.78), { start: 1000, end: 2500, hard: true }, 'min w/ UL: band ends at the UL itself, marked hard');

  const maxDef = { target: 34, direction: 'max', softMax: 50 };
  eq(nutrientBand(maxDef, 58.82), { start: 0, end: 34, hard: false }, 'max: band is [0, target]');

  const carbs = { target: 411, direction: 'range', targetMin: 349, targetMax: 504 };
  eq(nutrientBand(carbs, 592.94), { start: 349, end: 504, hard: false }, 'range with a real AMDR band: uses targetMin/targetMax as-is');

  // Energy: targetMin is null and there's no targetMax, only a softMax — the
  // literal targetMax??target formula would collapse the band to a single
  // point at target, so softMax fills in as the band's end (see the comment
  // on nutrientBand in js/nutrition.js for the worked-through reasoning).
  const energy = { target: 3100, direction: 'range', targetMin: null, softMax: 3500 };
  eq(nutrientBand(energy, 4117.65), { start: 3100, end: 3500, hard: false }, 'energy: band runs target to softMax, not a single point');

  const noneDef = { target: null, direction: 'none' };
  eq(nutrientBand(noneDef, null), null, 'direction none: no band');
}

// -- schema v6: the full bar model (fill/colour, unknown, overshoot) --
{
  const minDef = { target: 150, direction: 'min' };
  const unk = nutrientBarModel(minDef, null);
  eq(unk.unknown, true, 'no value: unknown');
  eq(unk.fillFrac, 0, 'unknown: zero fill');
  ok(unk.band != null, 'unknown still carries a band for context (drawn, just with no fill)');

  eq(nutrientBarModel(minDef, 0).chromaT, 0.15, 'min, zero intake: chroma floors at 0.15, never true grey');
  eq(nutrientBarModel(minDef, 75).chromaT, 0.575, 'min, halfway to target: chroma ramps between the 0.15 floor and 1.0');
  eq(nutrientBarModel(minDef, 150).chromaT, 1, 'min, at target (band start): full chroma');
  eq(nutrientBarModel(minDef, 300).chromaT, 1, 'min, past target: stays at full chroma');
  eq(nutrientBarModel(minDef, 300).overshootT, 0, 'min w/ no upperLimit: exceeding a floor never reddens, no matter how far');
  ok(nutrientBarModel(minDef, 75).fillFrac < 1, 'min, under target: fill has not reached the rail edge');

  const maxDef = { target: 34, direction: 'max', softMax: 50 };
  eq(nutrientBarModel(maxDef, 0).chromaT, 1, 'max: band starts at 0, so even zero intake reads as "inside the satisfied zone"');
  eq(nutrientBarModel(maxDef, 20).overshootT, 0, 'max, under target: no reddening yet');
  eq(nutrientBarModel(maxDef, 42).overshootT, 0.5, 'max, halfway from target to softMax: half reddened');
  eq(nutrientBarModel(maxDef, 50).overshootT, 1, 'max, at softMax: fully reddened');
  eq(nutrientBarModel(maxDef, 90).overshootT, 1, 'max, past softMax: stays capped');

  const rangeNoSoftMax = { target: 411, direction: 'range', targetMax: 504 }; // carbs
  const rp = 504 * 1.25; // no softMax and no upperLimit: red point falls back to 1.25x the band end
  eq(nutrientBarModel(rangeNoSoftMax, 504).overshootT, 0, 'range, exactly at band end: not yet overshooting');
  eq(Math.round(nutrientBarModel(rangeNoSoftMax, (504 + rp) / 2).overshootT * 100), 50, 'range, no softMax: red point falls back to 1.25x the band end');

  // A hard ceiling (band end === upperLimit) has no headroom to ramp across:
  // exceeding a safety limit is binary, so it reddens the instant it's crossed.
  const ulDef = { target: 1000, direction: 'min', upperLimit: 2500 };
  eq(nutrientBarModel(ulDef, 2500).overshootT, 0, 'min w/ UL, exactly at the ceiling: not yet a breach');
  eq(nutrientBarModel(ulDef, 2501).overshootT, 1, 'min w/ UL, one unit past the ceiling: instantly full red, no gradual ramp');

  const noneDef = { target: null, direction: 'none' };
  eq(nutrientBarModel(noneDef, 120).unknown, false, 'a real value with no target is still known, just not barred');
  eq(nutrientBarModel(noneDef, 120).band, null, 'direction none: no band, no bar');
  eq(nutrientBarModel(noneDef, null).unknown, true, 'direction none with no logged value: still unknown');
}

// -- alert qualification and detection --
{
  const alertRules = {
    windowDays: 10, qualifyingDaysRequired: 5, lowThresholdPct: 70, highThresholdPct: 100,
    minCoveragePct: 80, minConfidence: 'medium',
    allowedTargetConfidence: ['confirmed', 'guideline', 'derived'],
  };
  const proteinDef = { label: 'Protein', target: 150, direction: 'min', group: 'macro', targetConfidence: 'derived' };
  const highEntry = { macroConfidence: 'high', microConfidence: 'high' };
  const lowEntry = { macroConfidence: 'low', microConfidence: 'low' };

  ok(!dayQualifies(alertRules, proteinDef, undefined, 'protein'), 'no day at all: never qualifies');
  ok(!dayQualifies(alertRules, proteinDef, { coverage: { protein: 50 }, entries: [highEntry] }, 'protein'),
    'coverage below minCoveragePct: does not qualify');
  ok(!dayQualifies(alertRules, proteinDef, { coverage: { protein: 90 }, entries: [] }, 'protein'),
    'good coverage but no entries at all: cannot establish confidence, does not qualify');
  ok(!dayQualifies(alertRules, proteinDef, { coverage: { protein: 90 }, entries: [lowEntry] }, 'protein'),
    'coverage fine but confidence below minConfidence: does not qualify');
  ok(dayQualifies(alertRules, proteinDef, { coverage: { protein: 90 }, entries: [highEntry] }, 'protein'),
    'coverage and confidence both clear the bar: qualifies');
  ok(!dayQualifies(alertRules, proteinDef, { coverage: { protein: 90 }, entries: [highEntry, lowEntry] }, 'protein'),
    'one low-confidence entry drags the whole day below the floor (worst-of-day)');

  const today = '2026-07-20';
  const mkDay = (protein, entry = highEntry) => ({
    totals: { protein }, coverage: { protein: 90 }, entries: [entry],
  });
  // 6 of the last 10 days breach (below 70% of 150 = 105); qualifyingDaysRequired is 5.
  const days = {};
  const breachAmounts = [50, 60, 70, 200, 40, 80, 200, 200, 200, 30]; // today back to 9 days ago; 6 of these are under 70% of 150
  breachAmounts.forEach((amt, i) => {
    const key = i === 0 ? today : `2026-07-${String(20 - i).padStart(2, '0')}`;
    days[key] = mkDay(amt);
  });
  const feed = { nutrients: { protein: proteinDef }, days, alertRules };
  const alerts = computeAlerts(feed, today);
  eq(alerts.length, 1, 'one nutrient breaches its threshold enough to alert');
  eq(alerts[0].key, 'protein', 'the breaching nutrient is identified');
  eq(alerts[0].type, 'streak', 'target/band breaches are tagged as the trailing-window streak kind');
  eq(alerts[0].breachDays.length, 6, '6 of the 10 days were below 70% of target');
  eq(summarizeAlerts(alerts), 'Protein low — 6 of last 10 days', 'single-alert message matches the spec example');
  eq(summarizeAlerts([]), null, 'no alerts: no message, no empty-state text');
  eq(summarizeAlerts([alerts[0], alerts[0]]), '2 nutrients need attention', 'multiple alerts summarize to a count');

  // direction:"none" never alerts, regardless of how the numbers would read.
  const noneFeed = {
    nutrients: { cholesterol: { label: 'Cholesterol', target: null, direction: 'none', targetConfidence: 'confirmed' } },
    days: { [today]: mkDay(9999) },
    alertRules,
  };
  eq(computeAlerts(noneFeed, today).length, 0, 'direction "none" never alerts');

  // targetConfidence not in allowedTargetConfidence never alerts, even with real breaches.
  const unconfirmedFeed = {
    nutrients: { omega3LC: { label: 'Omega-3 (EPA+DHA+DPA)', target: 610, direction: 'min', group: 'fat', targetConfidence: 'unconfirmed' } },
    days: Object.fromEntries(Object.keys(days).map((k) => [k, { totals: { omega3LC: 10 }, coverage: { omega3LC: 90 }, entries: [highEntry] }])),
    alertRules,
  };
  eq(computeAlerts(unconfirmedFeed, today).length, 0, 'targetConfidence outside allowedTargetConfidence never alerts, even 10/10 days low');

  // "range" only ever checks the high side — a range nutrient sitting far
  // under target every single day should never fire.
  const rangeFeed = {
    nutrients: { carbs: { label: 'Carbohydrate', target: 411, direction: 'range', group: 'macro', targetConfidence: 'derived' } },
    days: Object.fromEntries(Object.keys(days).map((k) => [k, { totals: { carbs: 50 }, coverage: { carbs: 90 }, entries: [highEntry] }])),
    alertRules,
  };
  eq(computeAlerts(rangeFeed, today).length, 0, '"range" nutrient far under target on every day: no low-side alert');
}

// -- schema v6: upperLimit alerts fire immediately, not on a streak --
{
  const alertRules = {
    windowDays: 10, qualifyingDaysRequired: 5, lowThresholdPct: 70, highThresholdPct: 100,
    minCoveragePct: 80, minConfidence: 'medium',
    allowedTargetConfidence: ['confirmed', 'guideline', 'derived'],
  };
  const zincDef = {
    label: 'Zinc', target: 14, direction: 'min', group: 'mineral', targetConfidence: 'confirmed',
    upperLimit: 40, upperLimitNote: 'Closest ceiling to its target of any nutrient here.',
  };
  const goodEntry = { macroConfidence: 'high', microConfidence: 'high' };
  const badEntry = { macroConfidence: 'low', microConfidence: 'low' };
  const today = '2026-07-20';

  // A single qualifying breaching day is enough — no qualifyingDaysRequired
  // tally the way computeAlerts needs for target/band breaches.
  const oneBreachFeed = {
    nutrients: { zinc: zincDef },
    days: {
      [today]: { totals: { zinc: 20 }, coverage: { zinc: 90 }, entries: [goodEntry] },
      '2026-07-19': { totals: { zinc: 45 }, coverage: { zinc: 90 }, entries: [goodEntry] }, // over 40: breach
    },
    alertRules,
  };
  const ulAlerts = computeUpperLimitAlerts(oneBreachFeed, today);
  eq(ulAlerts.length, 1, 'a single day over the ceiling is enough to fire');
  eq(ulAlerts[0].type, 'upperLimit', 'tagged as the immediate-fire kind');
  eq(ulAlerts[0].breachDays, ['2026-07-19'], 'the specific breaching day is named');

  // A breach on a non-qualifying day (bad confidence) doesn't count — the
  // reading isn't trustworthy enough to accuse it of anything.
  const unqualifiedFeed = {
    nutrients: { zinc: zincDef },
    days: { [today]: { totals: { zinc: 45 }, coverage: { zinc: 90 }, entries: [badEntry] } },
    alertRules,
  };
  eq(computeUpperLimitAlerts(unqualifiedFeed, today).length, 0, 'a breach on a non-qualifying day never fires');

  // A nutrient with no upperLimit (e.g. magnesium — deliberately null in the
  // real feed) can never fire this alert, no matter how far over its own
  // target it reads.
  const noUlFeed = {
    nutrients: { magnesium: { label: 'Magnesium', target: 400, direction: 'min', group: 'mineral', targetConfidence: 'confirmed', upperLimit: null } },
    days: { [today]: { totals: { magnesium: 999999 }, coverage: { magnesium: 90 }, entries: [goodEntry] } },
    alertRules,
  };
  eq(computeUpperLimitAlerts(noUlFeed, today).length, 0, 'no upperLimit: never fires, regardless of the reading');

  // Under the ceiling, even by a lot: no breach.
  const fineFeed = {
    nutrients: { zinc: zincDef },
    days: { [today]: { totals: { zinc: 30 }, coverage: { zinc: 90 }, entries: [goodEntry] } },
    alertRules,
  };
  eq(computeUpperLimitAlerts(fineFeed, today).length, 0, 'under the ceiling: no alert');

  eq(summarizeAlerts(ulAlerts), 'Zinc over the safe upper limit', 'upperLimit alerts get distinct, more serious wording');
  eq(summarizeAlerts([ulAlerts[0], ulAlerts[0]]), '2 nutrients need attention', 'mixed-type alerts still summarize to a plain count');

  // computeAllAlerts merges both kinds, upperLimit first.
  const combinedFeed = {
    nutrients: { zinc: zincDef, protein: { label: 'Protein', target: 150, direction: 'min', group: 'macro', targetConfidence: 'derived' } },
    days: {
      ...oneBreachFeed.days,
      ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => {
        const key = i === 0 ? today : `2026-07-${String(20 - i).padStart(2, '0')}`;
        return [key, { totals: { zinc: 20, protein: 50 }, coverage: { zinc: 90, protein: 90 }, entries: [goodEntry] }];
      })),
      '2026-07-19': { totals: { zinc: 45, protein: 50 }, coverage: { zinc: 90, protein: 90 }, entries: [goodEntry] },
    },
    alertRules,
  };
  const combined = computeAllAlerts(combinedFeed, today);
  eq(combined.length, 2, 'both an upperLimit breach and a streak breach show up together');
  eq(combined[0].type, 'upperLimit', 'upperLimit alerts sort first, as the more serious kind');
  eq(combined[1].type, 'streak', 'streak alert follows');
}

// -- nutrition history: per-nutrient day status, "all goals hit" streaks --
{
  const nutrients = {
    energy: { label: 'Energy', target: 3100, direction: 'range', group: 'macro', display: 'always' },
    protein: { label: 'Protein', target: 150, direction: 'min', group: 'macro', display: 'always' },
    sodium: { label: 'Sodium', target: 2300, direction: 'max', group: 'mineral', display: 'monitor' },
    cholesterol: { label: 'Cholesterol', target: null, direction: 'none', group: 'macro', display: 'monitor' },
  };
  const minDef = nutrients.protein;
  const maxDef = nutrients.sodium;
  const noneDef = nutrients.cholesterol;

  eq(nutrientHit(minDef, 200), true, 'min: above target hits');
  eq(nutrientHit(minDef, 100), false, 'min: below target misses');
  eq(nutrientHit(minDef, null), false, 'min: unknown never hits');
  eq(nutrientHit(maxDef, 2000), true, 'max: under the limit hits');
  eq(nutrientHit(maxDef, 2500), false, 'max: over the limit misses');
  eq(nutrientHit(noneDef, 999), false, 'direction "none" never hits — no goal to satisfy');

  const today = '2026-07-20';
  eq(nutrientDayStatus(minDef, undefined, 'protein', '2026-07-15', undefined, today), 'empty', 'no entry logged: empty, not miss');
  eq(nutrientDayStatus(minDef, undefined, 'protein', today, undefined, today), 'pending', 'today, nothing yet: pending');
  eq(nutrientDayStatus(minDef, undefined, 'protein', '2026-07-25', undefined, today), 'future', 'after today: future');
  eq(nutrientDayStatus(minDef, { totals: { protein: 200 } }, 'protein', '2026-07-15', undefined, today), 'hit', 'logged and above target: hit');
  eq(nutrientDayStatus(minDef, { totals: { protein: 50 } }, 'protein', '2026-07-15', undefined, today), 'miss', 'logged but below target: miss');

  // Fix: a cleared/absent target must never read as a miss — it's "no
  // data", the same absent-≠-zero rule the rest of the app follows.
  const clearedDef = { ...minDef, target: null };
  eq(nutrientDayStatus(clearedDef, { totals: { protein: 200 } }, 'protein', '2026-07-15', undefined, today), 'empty',
    'target cleared (null), value logged: still "no data", never "missed"');
  eq(nutrientDayStatus(clearedDef, { totals: { protein: 200 } }, 'protein', today, undefined, today), 'pending',
    'target cleared, today: pending, not miss');

  // Coverage below minCoveragePct is the same "no data" bucket, even with a
  // real value and a real target.
  const alertRules = { minCoveragePct: 80 };
  eq(nutrientDayStatus(minDef, { totals: { protein: 200 }, coverage: { protein: 50 } }, 'protein', '2026-07-15', alertRules, today),
    'empty', 'coverage below minCoveragePct: no data, not a miss, even though the value would otherwise fail');
  eq(nutrientDayStatus(minDef, { totals: { protein: 200 }, coverage: { protein: 90 } }, 'protein', '2026-07-15', alertRules, today),
    'hit', 'coverage clears minCoveragePct: judged normally');
  eq(nutrientDayStatus(minDef, { totals: { protein: 200 } }, 'protein', '2026-07-15', alertRules, today),
    'empty', 'no coverage recorded at all, alertRules given: reads as 0% coverage, so no data');

  ok(!allGoalsHit(nutrients, undefined), 'no day at all: goals not hit');
  ok(!allGoalsHit(nutrients, { totals: { energy: 3200, protein: 200 } }), 'range nutrient over target: not all goals hit');
  ok(allGoalsHit(nutrients, { totals: { energy: 3050, protein: 200 } }), 'every always-displayed nutrient satisfied: all goals hit');
  ok(!allGoalsHit(nutrients, { totals: { energy: 3050 } }), 'protein missing entirely: not all goals hit (absent never counts as met)');
  ok(!allGoalsHit({ ...nutrients, energy: { ...nutrients.energy, target: null } }, { totals: { energy: 3050, protein: 200 } }),
    'energy target cleared: not all goals hit (no data on one nutrient still fails the day, but see the calendar states, not "missed")');

  const days = {
    '2026-07-18': { totals: { energy: 3050, protein: 200 } }, // hit
    '2026-07-19': { totals: { energy: 3050, protein: 200 } }, // hit
    '2026-07-20': { totals: { energy: 3050, protein: 200 } }, // hit (today)
  };
  eq(nutritionCurrentStreak(nutrients, days, undefined, today), 3, 'three consecutive all-goals-hit days ending today');
  eq(nutritionLongestStreak(nutrients, days, undefined, today), 3, 'longest streak matches the current run here');

  const gapDays = {
    '2026-07-15': { totals: { energy: 3050, protein: 200 } },
    '2026-07-16': { totals: { energy: 3050, protein: 200 } },
    '2026-07-17': { totals: { energy: 1000, protein: 50 } }, // breaks it
    '2026-07-20': { totals: { energy: 3050, protein: 200 } },
  };
  eq(nutritionCurrentStreak(nutrients, gapDays, undefined, today), 1, 'current streak only counts back to the most recent break');
  eq(nutritionLongestStreak(nutrients, gapDays, undefined, today), 2, 'longest streak finds the earlier 2-day run');

  // An empty totals object (present but nothing recorded) must not count
  // as "logged" — otherwise a day could show as logged with no data at all.
  const statsData = { nutrients, days: { ...gapDays, '2026-07-14': { totals: {} } } };
  const stats = nutritionStats(statsData, today);
  eq(stats.loggedDays, 4, 'loggedDays counts real totals, not the empty-totals day');
  eq(stats.goalsHitDays, 3, 'goalsHitDays only counts the ones where every always-nutrient hit');
  eq(stats.currentStreak, 1, 'stats include the current streak');
  eq(stats.longestStreak, 2, 'stats include the longest streak');

  // The regression this fix targets: energy's totals are logged and its
  // OLD (target-based) hit check would have failed if target were cleared,
  // reading as "missed" days threading through goalsHitDays/streaks too —
  // it must instead behave exactly like "no data" for those days.
  const clearedEnergyNutrients = { ...nutrients, energy: { ...nutrients.energy, target: null } };
  const clearedStatsData = { nutrients: clearedEnergyNutrients, days };
  const clearedStats = nutritionStats(clearedStatsData, today);
  eq(clearedStats.goalsHitDays, 0, 'energy target cleared: no day can be "all goals hit" while one goal has no data');
  eq(clearedStats.currentStreak, 0, 'energy target cleared: current streak reads 0, not a broken/negative streak');
}

// -- schema v6: white reference-mark ticks (Fix 1) --
{
  const round2 = (x) => Math.round(x * 100) / 100;
  const modelOf = (def, current) => {
    const railMax = nutrientRailMax(def, current);
    return { railMax, band: nutrientBand(def, railMax) };
  };

  const minDef = { target: 150, direction: 'min' };
  eq(nutrientTicks(minDef, modelOf(minDef, 75)), [{ value: 150, kind: 'target' }], 'min, no UL: one tick, at target');

  const ulFar = { target: 1000, direction: 'min', upperLimit: 2500 };
  eq(nutrientTicks(ulFar, modelOf(ulFar, 1200)), [{ value: 1000, kind: 'target' }],
    'min w/ UL, current well under the 60% proximity threshold: UL is off-rail, no second tick');

  const ulClose = { target: 1000, direction: 'min', upperLimit: 2500 };
  eq(nutrientTicks(ulClose, modelOf(ulClose, 1600)), [{ value: 1000, kind: 'target' }, { value: 2500, kind: 'upperLimit' }],
    'min w/ UL, current close enough to pull it on-rail: two ticks, target and upperLimit');

  const maxDef = { target: 34, direction: 'max', softMax: 50 };
  eq(nutrientTicks(maxDef, modelOf(maxDef, 20)), [{ value: 34, kind: 'target' }], 'max: one tick, at target (softMax gets no tick)');

  const rangeDef = { target: 411, direction: 'range', targetMin: 349, targetMax: 504 };
  eq(nutrientTicks(rangeDef, modelOf(rangeDef, 300)), [{ value: 349, kind: 'bound' }, { value: 504, kind: 'bound' }],
    'range with a real AMDR band: two ticks, at targetMin and targetMax');

  // Energy: no real targetMax, only softMax — nutrientBand's own fallback
  // (target..softMax) is what gets marked, since that's the same "satisfied"
  // zone the fill's colour law already agrees on.
  const energyDef = { target: 3100, direction: 'range', targetMin: null, softMax: 3500 };
  eq(nutrientTicks(energyDef, modelOf(energyDef, 3200)), [{ value: 3100, kind: 'bound' }, { value: 3500, kind: 'bound' }],
    'energy: ticks at the band fallback (target, softMax), not a single collapsed point');

  const noneDef = { target: null, direction: 'none' };
  eq(nutrientTicks(noneDef, modelOf(noneDef, 120)), [], 'direction none: no ticks');

  // Ticks are sorted by value, independent of kind — so the visual left-to-
  // right order always matches the rail, whichever priority a tick carries.
  eq(nutrientTicks(ulClose, modelOf(ulClose, 1600)).map((t) => t.value), [1000, 2500], 'ticks come back sorted by position');

  ok(TICK_PRIORITY.target > TICK_PRIORITY.bound && TICK_PRIORITY.bound > TICK_PRIORITY.upperLimit,
    'label priority: target beats a published bound beats a borrowed safety ceiling');
}

// ---------- pomodoro ----------

// -- pure phase math: elapsed/remaining --
{
  const base = (over = {}) => ({
    enabled: true, workMins: 25, breakMins: 5, longBreakMins: 15,
    phase: 'work', phaseEndTimestamp: 1000000, cyclesCompleted: 0,
    paused: false, pausedRemainingMs: null, workAccumMs: 0,
    ...over,
  });

  // 25 min work phase, 15 min remaining (10 elapsed).
  const midWork = base({ phaseEndTimestamp: 1000000 });
  const now = 1000000 - 15 * 60000;
  eq(pomodoroRemainingMs(midWork, now), 15 * 60000, 'remaining reads straight off phaseEndTimestamp - now');
  eq(pomodoroWorkElapsedMs(midWork, now), 10 * 60000, 'work elapsed so far: duration minus remaining');

  eq(pomodoroWorkElapsedMs(base({ phase: 'break', workAccumMs: 5 * 60000 }), now), 5 * 60000,
    'on a break: elapsed is just whatever was already banked, the break itself never adds to it');

  const paused = base({ paused: true, pausedRemainingMs: 8 * 60000 });
  eq(pomodoroRemainingMs(paused, 999999999), 8 * 60000, 'paused: remaining is frozen at pausedRemainingMs, ignores now');
  eq(pomodoroWorkElapsedMs(paused, 999999999), 17 * 60000, 'paused: elapsed is frozen too (25 - 8), ignores now');

  eq(pomodoroWorkElapsedMs(null), 0, 'no pomodoro state: zero elapsed');
  eq(pomodoroWorkElapsedMs(base({ phase: null })), 0, 'no active phase: zero elapsed');
}

// -- advancePomodoro: catch-up across one or more missed boundaries --
{
  const base = (over = {}) => ({
    enabled: true, workMins: 25, breakMins: 5, longBreakMins: 15,
    phase: 'work', phaseEndTimestamp: 1000000, cyclesCompleted: 0,
    paused: false, pausedRemainingMs: null, workAccumMs: 0,
    ...over,
  });

  // Just past the work phase's end: one boundary, work -> break.
  {
    const { pomodoro, transitions } = advancePomodoro(base(), 1000001);
    eq(transitions, ['break'], 'one boundary crossed: work -> break');
    eq(pomodoro.phase, 'break', 'now on break');
    eq(pomodoro.cyclesCompleted, 1, 'the completed work phase counts as a cycle');
    eq(pomodoro.workAccumMs, 25 * 60000, 'the whole work phase banked, none of it discarded');
    eq(pomodoro.phaseEndTimestamp, 1000000 + 5 * 60000, 'next end anchored to the old end, not "now" (no drift on catch-up)');
  }

  // Exactly the 4th completed cycle: break upgrades to a long break.
  {
    const { pomodoro } = advancePomodoro(base({ cyclesCompleted: 3 }), 1000001);
    eq(pomodoro.phase, 'longBreak', `every ${DEFAULT_POMODORO_CYCLES_FOR_LONG_BREAK}th cycle gets the long break instead`);
    eq(pomodoro.cyclesCompleted, 4, 'cycle count keeps climbing regardless of which break follows');
  }

  // A custom cadence (cyclesPerLongBreak) is honoured instead of the default.
  {
    const short = advancePomodoro(base({ cyclesCompleted: 1, cyclesPerLongBreak: 2 }), 1000001).pomodoro;
    eq(short.phase, 'longBreak', 'a cyclesPerLongBreak of 2 triggers the long break on the 2nd cycle');

    const notYet = advancePomodoro(base({ cyclesCompleted: 3, cyclesPerLongBreak: 8 }), 1000001).pomodoro;
    eq(notYet.phase, 'break', 'a cyclesPerLongBreak of 8 keeps giving plain breaks before the 8th cycle');
  }

  // Locked clean through an entire break and back into work: two boundaries
  // caught up in one call, not just the first one. Work1 ends at t=0, so
  // break spans [0, 5min] — 1ms past that lands just inside work2.
  {
    const p = base({ phaseEndTimestamp: 0 });
    const now = 5 * 60000 + 1;
    const { pomodoro, transitions } = advancePomodoro(p, now);
    eq(transitions, ['break', 'work'], 'both boundaries crossed in one catch-up call, in order');
    eq(pomodoro.phase, 'work', 'lands back on work, not stuck on the first missed break');
    eq(pomodoro.cyclesCompleted, 1, 'still just one completed work cycle (the break itself never adds one)');
  }

  // A paused session is frozen — no amount of elapsed time advances it.
  {
    const { pomodoro, transitions } = advancePomodoro(base({ paused: true }), 999999999);
    eq(transitions, [], 'paused: never advances');
    eq(pomodoro.phase, 'work', 'stays exactly where it was paused');
  }

  eq(advancePomodoro(null).transitions, [], 'no pomodoro state: nothing to advance');
}

// -- skipPomodoro: user-initiated, credits partial work, never partial break --
{
  const base = (over = {}) => ({
    enabled: true, workMins: 25, breakMins: 5, longBreakMins: 15,
    phase: 'work', phaseEndTimestamp: 1000000, cyclesCompleted: 0,
    paused: false, pausedRemainingMs: null, workAccumMs: 0,
    ...over,
  });

  // Skipping 10 minutes into a 25-minute work phase.
  {
    const now = 1000000 - 15 * 60000; // 15 min remaining
    const p = skipPomodoro(base(), now);
    eq(p.phase, 'break', 'moves on to break');
    eq(p.workAccumMs, 10 * 60000, 'the 10 minutes actually worked are credited, not thrown away');
    eq(p.cyclesCompleted, 1, 'still counts toward the cycle cadence, same as a natural completion');
    eq(p.phaseEndTimestamp, now + 5 * 60000, 'a manual skip re-anchors to "now", not the old schedule');
  }

  // Skipping a break credits nothing — breaks were never counted at all.
  {
    const p = skipPomodoro(base({ phase: 'break', workAccumMs: 20 * 60000, cyclesCompleted: 1 }), 500000);
    eq(p.phase, 'work', 'back to work');
    eq(p.workAccumMs, 20 * 60000, 'unchanged — a partial break is worth exactly as much as a full one: nothing');
    eq(p.cyclesCompleted, 1, 'skipping a break does not itself complete a cycle');
  }

  eq(skipPomodoro(null), null, 'no pomodoro state: no-op');
}

// -- normalizeTracker: Pomodoro defaults, clamping, and scoping --
{
  const store = createStore({ storage: memStorage(), seed: () => seedState('2026-07-14') });
  const timeId = store.addTracker({ name: 'Focus', type: 'counter', time: true });
  eq(store.state.trackers[timeId].pomodoro,
    { enabled: false, workMins: 25, breakMins: 5, longBreakMins: 15, cyclesPerLongBreak: 4, phase: null, phaseEndTimestamp: null, cyclesCompleted: 0, paused: false, pausedRemainingMs: null, workAccumMs: 0 },
    'a fresh time counter gets Pomodoro defaults, off by default');

  const plainId = store.addTracker({ name: 'Reps', type: 'counter' });
  eq(store.state.trackers[plainId].pomodoro, null, 'a non-time counter has no Pomodoro state at all');

  const habitId = store.addTracker({ name: 'Stretch', type: 'habit' });
  eq(store.state.trackers[habitId].pomodoro, null, 'a habit has no Pomodoro state at all');

  store.updateTracker(timeId, { pomodoro: { enabled: true, workMins: 0, breakMins: -5, longBreakMins: 'x', cyclesPerLongBreak: 0 } });
  const p = store.state.trackers[timeId].pomodoro;
  eq(p.enabled, true, 'enabled flag saved');
  eq(p.workMins, 25, 'a non-positive/invalid minute value falls back to the default rather than going to 0 or NaN');
  eq(p.breakMins, 5, 'same for a negative value');
  eq(p.longBreakMins, 15, 'same for a non-numeric value');
  eq(p.cyclesPerLongBreak, 4, 'a non-positive cycle count falls back to the default of 4');

  store.updateTracker(timeId, { pomodoro: { enabled: true, workMins: 25, breakMins: 5, longBreakMins: 15, cyclesPerLongBreak: 8 } });
  eq(store.state.trackers[timeId].pomodoro.cyclesPerLongBreak, 8, 'a valid custom cycle count is kept');
}

// -- normalizeTracker: weekly cadence defaults, clamping, both types --
{
  const store = createStore({ storage: memStorage(), seed: () => seedState('2026-07-14') });
  const habitId = store.addTracker({ name: 'Stretch2', type: 'habit' });
  const counterId = store.addTracker({ name: 'Run2', type: 'counter', target: { base: 5 } });

  eq(store.state.trackers[habitId].cadence, { enabled: false, timesPerWeek: 3 },
    'a fresh habit gets cadence defaults, off by default');
  eq(store.state.trackers[counterId].cadence, { enabled: false, timesPerWeek: 3 },
    'a fresh counter gets the same default cadence shape as a habit');

  store.updateTracker(counterId, { cadence: { enabled: true, timesPerWeek: 0 } });
  eq(store.state.trackers[counterId].cadence.timesPerWeek, 3, 'a non-positive timesPerWeek falls back to the default of 3');

  store.updateTracker(counterId, { cadence: { enabled: true, timesPerWeek: 10 } });
  eq(store.state.trackers[counterId].cadence.timesPerWeek, 7, 'timesPerWeek is clamped to a maximum of 7');

  store.updateTracker(counterId, { cadence: { enabled: true, timesPerWeek: 4 } });
  eq(store.state.trackers[counterId].cadence, { enabled: true, timesPerWeek: 4 }, 'a valid custom cadence is kept as-is');
}

// -- store: start/stop/cancel/skip/pause/resume/checkPomodoroPhases --
{
  const store = createStore({ storage: memStorage(), seed: () => seedState('2026-07-14') });
  const tid = store.addTracker({ name: 'Focus', type: 'counter', time: true, pomodoro: { enabled: true, workMins: 25, breakMins: 5, longBreakMins: 15 } });

  store.startTimer(tid);
  ok(store.state.timers[tid], 'the plain live timer still starts as before');
  eq(store.state.trackers[tid].pomodoro.phase, 'work', 'starting kicks off the first work phase');
  ok(store.state.trackers[tid].pomodoro.phaseEndTimestamp > Date.now(), 'phase end is a real future timestamp, not a countdown');

  // Rewind as if 10 minutes of the work phase have elapsed (same rewind
  // trick the plain live-timer tests already use for "time passed").
  store.state.trackers[tid].pomodoro.phaseEndTimestamp = Date.now() + 15 * 60000;

  // Nothing due yet: checkPomodoroPhases is a no-op.
  eq(store.checkPomodoroPhases(), [], 'not due yet: no phase changes reported');

  // Rewind past the work phase's end entirely, then let it catch up.
  store.state.trackers[tid].pomodoro.phaseEndTimestamp = Date.now() - 1000;
  const changed = store.checkPomodoroPhases();
  eq(changed.length, 1, 'exactly the one tracker whose phase changed is reported');
  eq(changed[0].tracker.id, tid, 'the changed tracker is identified');
  eq(changed[0].phase, 'break', 'now on a break');
  eq(store.state.trackers[tid].pomodoro.cyclesCompleted, 1, 'cycle counted');

  // Skip straight back to work.
  store.skipPomodoroPhase(tid);
  eq(store.state.trackers[tid].pomodoro.phase, 'work', 'skip moves on immediately');

  // Pause freezes the countdown.
  store.pausePomodoroPhase(tid);
  ok(store.state.trackers[tid].pomodoro.paused, 'paused');
  const frozen = store.state.trackers[tid].pomodoro.pausedRemainingMs;
  ok(frozen > 0, 'remaining time captured at the moment of pausing');
  eq(store.checkPomodoroPhases(), [], 'paused: never reported as due, no matter how much real time passes');
  store.resumePomodoroPhase(tid);
  ok(!store.state.trackers[tid].pomodoro.paused, 'resumed');

  // Stop & log: work-only elapsed gets logged, and the live session
  // (both the plain timer and the Pomodoro phase) is fully cleared.
  store.state.trackers[tid].pomodoro.workAccumMs = 12 * 60000; // simulate 12 min already banked
  store.state.trackers[tid].pomodoro.phaseEndTimestamp = Date.now() + 25 * 60000; // mid-phase, nothing more elapsed
  const mins = store.stopTimer(tid, '2026-07-14');
  eq(mins, 12, 'logs the Pomodoro work-only total (12 min), not the whole wall-clock session');
  eq(store.state.timers[tid], undefined, 'live timer cleared');
  eq(store.state.trackers[tid].pomodoro.phase, null, 'phase cleared back to "no session"');
  eq(store.state.trackers[tid].pomodoro.enabled, true, 'the enabled/workMins/... settings survive stopping, only the live phase resets');
  eq(store.state.days['2026-07-14'][tid].total, 12, 'the 12 minutes actually landed in the day log');

  // Cancel discards without logging anything.
  store.startTimer(tid);
  store.state.trackers[tid].pomodoro.workAccumMs = 30 * 60000;
  store.cancelTimer(tid);
  eq(store.state.timers[tid], undefined, 'timer cleared on cancel');
  eq(store.state.trackers[tid].pomodoro.phase, null, 'phase cleared on cancel');
  eq(store.state.days['2026-07-14'][tid].total, 12, 'cancel logs nothing further — total unchanged from the earlier stop');

  // A tracker with Pomodoro disabled behaves exactly like the plain timer.
  const plainId = store.addTracker({ name: 'Read', type: 'counter', time: true });
  store.startTimer(plainId);
  eq(store.state.trackers[plainId].pomodoro.phase, null, 'Pomodoro disabled: no phase ever starts');
  store.state.timers[plainId].startedAt = Date.now() - 42.5 * 60000;
  eq(store.stopTimer(plainId, '2026-07-14'), 43, 'plain timer still logs the whole elapsed session, unchanged behaviour');
}

// ---------- classes: pure logic ----------
{
  eq(fmtTime12('09:00'), '9:00 am', 'fmtTime12 morning');
  eq(fmtTime12('13:05'), '1:05 pm', 'fmtTime12 afternoon');
  eq(fmtTime12('00:30'), '12:30 am', 'fmtTime12 midnight hour');
  eq(fmtTime12('12:00'), '12:00 pm', 'fmtTime12 noon');

  eq(addMinutesToTime('09:00', 90), '10:30', 'addMinutesToTime plain');
  eq(addMinutesToTime('23:30', 60), '00:30', 'addMinutesToTime wraps past midnight');

  const cls = {
    id: 'c1', name: 'Data Structures', days: [0, 2], startTime: '09:00', durationMins: 60,
    createdAt: '2026-07-01', startDate: null, endDate: null,
  };
  eq(classEndTime(cls), '10:00', 'classEndTime adds duration');
  eq(classTimeRange(cls), '9:00 am – 10:00 am', 'classTimeRange formats both ends');

  eq(classOccursOn(cls, '2026-07-13'), true, 'Monday matches days[0]');
  eq(classOccursOn(cls, '2026-07-14'), false, 'Tuesday does not match');
  eq(classOccursOn(cls, '2026-07-15'), true, 'Wednesday matches days[2]');

  const bounded = { ...cls, startDate: '2026-08-01', endDate: '2026-08-31' };
  eq(classOccursOn(bounded, '2026-07-13'), false, 'before startDate: no occurrence');
  eq(classOccursOn(bounded, '2026-08-03'), true, 'inside range: occurs (Monday 3 Aug)');
  eq(classOccursOn(bounded, '2026-09-07'), false, 'after endDate: no occurrence');
  // archived is ignored by classOccursOn on purpose — history must still
  // judge past occurrences of a class you've since archived.
  eq(classOccursOn({ ...cls, archived: true }, '2026-07-13'), true, 'archived does not affect occurrence');

  const classDays = {
    '2026-07-13': { c1: { done: true } },
    '2026-07-15': { c1: { done: true } },
  };
  eq(isClassDone(classDays, '2026-07-13', 'c1'), true, 'marked day reads done');
  eq(isClassDone(classDays, '2026-07-14', 'c1'), false, 'unmarked day reads not done');
  eq(isClassDone({}, '2026-07-13', 'c1'), false, 'no classDays at all: not done');

  const classes = {
    c1: cls,
    c2: { id: 'c2', name: 'Algorithms', days: [0], startTime: '11:00', durationMins: 30, createdAt: '2026-07-01' },
    c3: { id: 'c3', name: 'Archived class', days: [0], startTime: '08:00', durationMins: 30, createdAt: '2026-07-01', archived: true },
  };
  const monday = classesForDay(classes, '2026-07-13');
  eq(monday.map((c) => c.id), ['c1', 'c2'], 'sorted by start time, archived excluded');
  eq(classesForDay(classes, '2026-07-14'), [], 'Tuesday: neither class meets');
  eq(classesOccurringOn(classes, '2026-07-13').map((c) => c.id), ['c3', 'c1', 'c2'],
    'classesOccurringOn includes archived, unlike classesForDay (sorted by start time: c3 08:00, c1 09:00, c2 11:00)');

  eq(todayClassSummary(classes, classDays, '2026-07-13'), { total: 2, done: 1 }, 'today summary counts done vs total');

  eq(dayAttendance(classes, classDays, '2026-07-13'), { scheduled: 3, attended: 1, ratio: 1 / 3 },
    'dayAttendance blends every class scheduled that day, archived included');
  eq(dayAttendance(classes, classDays, '2026-07-14'), { scheduled: 0, attended: 0, ratio: null },
    'no classes that day: ratio is null, not zero');

  eq(classDayStatus(cls, classDays, '2026-07-13', '2026-07-20'), 'hit', 'attended day is hit');
  eq(classDayStatus(cls, classDays, '2026-07-20', '2026-07-21'), 'miss', 'past occurrence, not attended: miss');
  eq(classDayStatus(cls, classDays, '2026-07-20', '2026-07-18'), 'future', 'after today: future');
  eq(classDayStatus(cls, classDays, '2026-07-27', '2026-07-27'), 'pending', 'today, not yet marked: pending');
  eq(classDayStatus(cls, classDays, '2026-07-14', '2026-07-20'), 'empty', 'non-occurrence day: empty');
  eq(classDayStatus(cls, classDays, '2026-06-01', '2026-07-20'), 'empty', 'before createdAt: empty even if weekday matches');

  eq(nextOccurrence(cls, '2026-07-14'), '2026-07-15', 'next occurrence after Tuesday is Wednesday');
  eq(nextOccurrence(cls, '2026-07-13'), '2026-07-13', 'next occurrence is inclusive of a matching start day');
  eq(nextOccurrence(bounded, '2026-09-01'), null, 'no occurrence left after endDate has passed');

  // classStats: Mon/Wed for three weeks (13 Jul .. 27 Jul), one miss on the
  // second Monday, "today" mid-stream so it doesn't force a premature streak break.
  const statCls = { id: 'sc', name: 'Stats', days: [0, 2], startTime: '09:00', durationMins: 60, createdAt: '2026-07-13' };
  const statDays = {
    '2026-07-13': { sc: { done: true } }, // Mon wk1 - hit
    '2026-07-15': { sc: { done: true } }, // Wed wk1 - hit
    // '2026-07-20' Mon wk2 - missed
    '2026-07-22': { sc: { done: true } }, // Wed wk2 - hit
    '2026-07-27': { sc: { done: true } }, // Mon wk3 (today) - hit
  };
  const stats = classStats(statCls, statDays, '2026-07-27');
  eq(stats.scheduled, 5, 'five occurrences from creation through today');
  eq(stats.attended, 4, 'four attended, one missed');
  eq(stats.currentStreak, 2, 'streak counts back from today through the miss');
  eq(stats.longestStreak, 2, 'longest run is the first two before the miss');

  const neverMet = classStats({ ...statCls, createdAt: '2026-07-27' }, {}, '2026-07-13');
  eq(neverMet, { scheduled: 0, attended: 0, currentStreak: 0, longestStreak: 0 }, 'createdAt after today: no stats yet');

  // per-day time overrides: a lecture that's longer/later on some of its
  // own days — classTimeForDay/classTimeFor fall back to the plain
  // startTime/durationMins for any day without its own entry.
  const varied = {
    id: 'v', name: 'Varied', days: [0, 2], startTime: '09:00', durationMins: 60,
    perDayTimes: { 2: { startTime: '15:00', durationMins: 120 } }, createdAt: '2026-07-01',
  };
  eq(classTimeForDay(varied, 0), { startTime: '09:00', durationMins: 60 }, 'Monday has no override: falls back to the plain fields');
  eq(classTimeForDay(varied, 2), { startTime: '15:00', durationMins: 120 }, 'Wednesday uses its own override');
  eq(classTimeFor(varied, '2026-07-13'), { startTime: '09:00', durationMins: 60 }, 'classTimeFor resolves a date to its weekday (Monday)');
  eq(classTimeFor(varied, '2026-07-15'), { startTime: '15:00', durationMins: 120 }, 'classTimeFor resolves a date to its weekday (Wednesday)');
  eq(classTimeForDay({ ...varied, perDayTimes: null }, 2), { startTime: '09:00', durationMins: 60 },
    'no perDayTimes at all: every day falls back to the plain fields');

  // one-off events: `date` set means the class meets exactly once, on that
  // date, regardless of `days`/`startDate`/`endDate` (normalizeClass keeps
  // those empty, but classOccursOn ignores them either way as a safety net).
  const event = {
    id: 'ev', name: 'Guest lecture', days: [0, 2, 4], startTime: '10:00', durationMins: 90,
    createdAt: '2026-07-01', date: '2026-07-16', startDate: '2026-01-01', endDate: '2026-12-31',
  };
  eq(classOccursOn(event, '2026-07-16'), true, 'one-off event occurs on its exact date');
  eq(classOccursOn(event, '2026-07-13'), false, 'one-off event does not occur on a day matching its (ignored) days array');
  eq(classOccursOn(event, '2026-07-17'), false, 'one-off event does not occur the day after either');
  const eventStats = classStats(event, { '2026-07-16': { ev: { done: true } } }, '2026-07-20');
  eq(eventStats, { scheduled: 1, attended: 1, currentStreak: 1, longestStreak: 1 },
    'a one-off event contributes exactly one occurrence to its own stats');
  eq(nextOccurrence(event, '2026-07-01'), '2026-07-16', 'nextOccurrence finds a future one-off event');
  eq(nextOccurrence(event, '2026-07-17'), null, 'nextOccurrence finds nothing once a one-off event has passed');

  // allClassesStats: two classes both created 2026-07-13. Mon-only "A" and
  // Mon+Wed "B" over the same three weeks; one Monday (07-20) both classes
  // ran but only B was attended, so that day isn't "perfect" and breaks
  // the streak of fully-attended days.
  const classA = { id: 'A', days: [0], startTime: '09:00', durationMins: 60, createdAt: '2026-07-13' };
  const classB = { id: 'B', days: [0, 2], startTime: '11:00', durationMins: 60, createdAt: '2026-07-13' };
  const allClasses = { A: classA, B: classB };
  const allDays = {
    '2026-07-13': { A: { done: true }, B: { done: true } }, // Mon wk1: perfect
    '2026-07-15': { B: { done: true } },                    // Wed wk1: B only scheduled, attended
    '2026-07-20': { B: { done: true } },                    // Mon wk2: A missed, B attended — not perfect
    '2026-07-22': { B: { done: true } },                    // Wed wk2: attended
    '2026-07-27': { A: { done: true }, B: { done: true } }, // Mon wk3 (today): perfect
  };
  const allStats = allClassesStats(allClasses, allDays, '2026-07-27');
  // scheduled: Mon(A+B)x3 + Wed(B)x2 = 6 + 2 = 8; attended: all logged above = 7
  eq(allStats.scheduled, 8, 'scheduled sums every class on every occurrence day');
  eq(allStats.attended, 7, 'attended sums every logged class');
  eq(allStats.currentStreak, 2, 'streak of perfect days counts back from today through the imperfect Monday');
  eq(allStats.longestStreak, 2, 'longest run of perfect days is 2 (either wk1 Mon+Wed, or wk2-Wed through today)');

  eq(allClassesStats({}, {}, '2026-07-13'), { scheduled: 0, attended: 0, currentStreak: 0, longestStreak: 0 },
    'no classes at all: zeroed out, not an error');
}

// ---------- classes: store integration ----------
{
  const store = createStore({ storage: memStorage(), seed: () => seedState('2026-07-13') });
  const studyId = store.addTracker({ name: 'Study', type: 'counter', time: true });
  const classId = store.addClass({
    name: 'Tutorial', days: [0], startTime: '14:00', durationMins: 120, linkedTrackerId: studyId,
  });

  eq(store.state.classes[classId].linkedTrackerId, studyId, 'link accepted for a time counter');

  // A one-off event strips any days/startDate/endDate it was (wrongly)
  // given — normalizeClass's job, so stored data never carries two
  // conflicting ideas of when the thing happens.
  const eventId = store.addClass({
    name: 'Exam', date: '2026-08-01', days: [1, 3], startDate: '2026-01-01', endDate: '2026-12-31', durationMins: 120,
  });
  const savedEvent = store.state.classes[eventId];
  eq(savedEvent.date, '2026-08-01', 'one-off date accepted');
  eq(savedEvent.days, [], 'days cleared for a one-off event');
  eq(savedEvent.startDate, null, 'startDate cleared for a one-off event');
  eq(savedEvent.endDate, null, 'endDate cleared for a one-off event');

  // perDayTimes: a stale entry for a day no longer in `days` is dropped;
  // an entry for a day that is stays and is validated on its own. A
  // separate linked tracker keeps this from disturbing studyId's totals
  // used by the plain-Tutorial assertions further down.
  const studyVariedId = store.addTracker({ name: 'StudyVaried', type: 'counter', time: true });
  const variedId = store.addClass({
    name: 'Varied', days: [0, 2], startTime: '09:00', durationMins: 60, linkedTrackerId: studyVariedId,
    perDayTimes: { 0: { startTime: '10:00', durationMins: 90 }, 4: { startTime: '13:00', durationMins: 45 } },
  });
  const savedVaried = store.state.classes[variedId];
  eq(savedVaried.perDayTimes, { 0: { startTime: '10:00', durationMins: 90 } },
    'the Friday (4) override is dropped — Friday is not one of this class\'s days');

  // Marking a per-day-varied class attended logs THAT day's own duration,
  // not the class's plain default, to its linked tracker. Uses its own
  // dates (a different Monday/Wednesday) so it doesn't disturb the
  // classDays['2026-07-13'] assertions further down.
  store.toggleClassDone(variedId, '2026-06-15'); // Monday: overridden to 90 min
  eq(store.state.days['2026-06-15'][studyVariedId].total, 90, 'Monday logs its own overridden duration (90), not the plain default (60)');
  store.toggleClassDone(variedId, '2026-06-17'); // Wednesday: no override, plain 60
  eq(store.state.days['2026-06-17'][studyVariedId].total, 60, 'Wednesday (no override) logs the plain default duration');

  const nowDone = store.toggleClassDone(classId, '2026-07-13');
  eq(nowDone, true, 'toggle marks attended');
  eq(store.state.classDays['2026-07-13'][classId].done, true, 'attendance recorded');
  eq(store.state.days['2026-07-13'][studyId].total, 120, 'linked tracker gains the class duration');

  const nowUndone = store.toggleClassDone(classId, '2026-07-13');
  eq(nowUndone, false, 'toggling again reverses attendance');
  eq(store.state.classDays['2026-07-13'], undefined, 'empty attendance day cleaned up');
  eq(store.state.days['2026-07-13'][studyId].total, 0,
    'reversing attendance nets the linked total back to zero (the correction sets themselves stay, like any other undo)');

  // Deleting the linked tracker clears the class's link rather than leaving
  // a dangling reference.
  store.toggleClassDone(classId, '2026-07-13');
  store.deleteTracker(studyId);
  eq(store.state.classes[classId].linkedTrackerId, null, 'link cleared when the linked tracker is deleted');

  // Editing a linked tracker away from a time counter also clears the link.
  const study2Id = store.addTracker({ name: 'Study2', type: 'counter', time: true });
  store.updateClass(classId, { linkedTrackerId: study2Id });
  eq(store.state.classes[classId].linkedTrackerId, study2Id, 'relinked to the new time counter');
  store.updateTracker(study2Id, { time: false, unit: 'sessions' });
  eq(store.state.classes[classId].linkedTrackerId, null, 'link cleared once the tracker stops being a time counter');

  store.deleteClass(classId);
  eq(store.state.classes[classId], undefined, 'deleteClass removes the class');

  // Both optional wide tiles default to hidden unless explicitly shown.
  const fresh = normalizeState({ trackers: { t: { id: 't', name: 'T', type: 'habit' } } });
  eq(fresh.meta.nutritionHidden, true, 'nutrition tile hidden by default');
  eq(fresh.meta.classesHidden, true, 'classes tile hidden by default');
  const shown = normalizeState({
    trackers: { t: { id: 't', name: 'T', type: 'habit' } },
    meta: { nutritionHidden: false, classesHidden: false },
  });
  eq(shown.meta.nutritionHidden, false, 'an explicit false sticks for nutrition');
  eq(shown.meta.classesHidden, false, 'an explicit false sticks for classes');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
