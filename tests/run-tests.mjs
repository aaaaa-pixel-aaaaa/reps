// Sanity tests for the tricky bits. Run with:  node tests/run-tests.mjs
import {
  keyOf, parseKey, todayKey, isValidKey, addDays, daysBetween, weekdayIndex,
  monthGrid, monthOf, addMonths, cmpMonth, daysInMonth,
} from '../js/dates.js';
import {
  computedTarget, effectiveTarget, isHit, dayStatus, currentStreak,
  longestStreak, trackerStats, todaySummary, fmtAmount,
} from '../js/model.js';
import { createStore, normalizeState, validateImport, seedState, demoState } from '../js/store.js';
import { pinnedTrackers, groupTrackers, reorderContext } from '../js/model.js';
import { wrapDelta, stepsFor, angleAt } from '../js/wheel.js';

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
