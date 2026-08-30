// Pure domain logic: effective targets, day status, streaks, stats.
// No DOM, no storage — everything takes plain data in and returns data out,
// so retro edits "recompute" simply by re-rendering.

import { addDays, daysBetween, todayKey, mondayOf } from './dates.js';

export function roundAmount(tracker, x) {
  return tracker.dec ? Math.round(x * 100) / 100 : Math.round(x);
}

// Minutes -> "45m", "1h 30m", "2h" (sign preserved for corrections).
export function fmtMinutes(x) {
  const neg = x < 0;
  const a = Math.abs(Math.round(x));
  const hp = Math.floor(a / 60);
  const m = a % 60;
  const s = hp ? (m ? `${hp}h ${m}m` : `${hp}h`) : `${m}m`;
  return neg ? `-${s}` : s;
}

// Display formatting for amounts: integers plain, decimals trimmed ("2.5",
// "3"), time counters as hours/minutes.
export function fmtAmount(tracker, x) {
  if (tracker.time) return fmtMinutes(x);
  if (!tracker.dec) return String(Math.round(x));
  const r = Math.round(x * 100) / 100;
  return String(parseFloat(r.toFixed(2)));
}

// Target from the tracker's progression settings alone (no per-day override).
export function computedTarget(tracker, dateKey) {
  if (tracker.type !== 'counter') return 0;
  const t = tracker.target || {};
  const base = t.base || 0;
  if (!t.mode || t.mode === 'none' || !t.inc || !t.start) return base;
  const elapsed = Math.max(0, daysBetween(t.start, dateKey));
  const steps = t.mode === 'weekly' ? Math.floor(elapsed / 7) : elapsed;
  return roundAmount(tracker, base + steps * t.inc);
}

// What the user must reach on that day: per-day override wins.
export function effectiveTarget(tracker, dateKey, entry) {
  if (entry && entry.goalOverride != null) return entry.goalOverride;
  return computedTarget(tracker, dateKey);
}

export function entryFor(days, dateKey, trackerId) {
  const day = days[dateKey];
  return day ? day[trackerId] : undefined;
}

// How many times a habit was checked off that day. Older data stored
// {done: true}, which reads as one check.
export function habitCount(entry) {
  if (!entry) return 0;
  if (entry.count != null) return entry.count;
  return entry.done ? 1 : 0;
}

// Checks needed to complete a habit that day (per-day override wins).
export function habitTarget(tracker, entry) {
  if (entry && entry.goalOverride != null) return entry.goalOverride;
  return Math.max(1, tracker.perDay || 1);
}

// Did this day meet its goal?
// - target 0 via explicit override: a declared rest day, always met
// - habit: checked off at least its times-per-day
// - counter with a positive target: total >= target
// - counter with no target at all: any activity counts
export function isHit(tracker, entry, dateKey) {
  if (entry && entry.goalOverride === 0) return true;
  if (tracker.type === 'habit') return habitCount(entry) >= habitTarget(tracker, entry);
  const target = effectiveTarget(tracker, dateKey, entry);
  const total = entry ? entry.total || 0 : 0;
  return target > 0 ? total >= target : total > 0;
}

// How far a hit day exceeded its goal, as 0 (exactly on target) approaching
// 1 (never quite reaching it) around 3x the goal. The curve front-loads the
// climb — 1x to 2x moves it a lot more than 2x to 3x — so the calendar can
// deepen "goal hit" into "goal crushed" without the base hit colour ever
// looking washed out.
export function hitIntensity(tracker, entry, dateKey) {
  if (!entry) return 0;
  let ratio;
  if (tracker.type === 'habit') {
    const per = habitTarget(tracker, entry);
    if (per <= 0) return 0;
    ratio = habitCount(entry) / per;
  } else {
    const target = effectiveTarget(tracker, dateKey, entry);
    if (target <= 0) return 0;
    ratio = (entry.total || 0) / target;
  }
  if (ratio <= 1) return 0;
  const x = Math.min(ratio - 1, 2); // input caps out at 3x the goal
  return (1 - Math.exp(-1.5 * x)) / (1 - Math.exp(-3));
}

// Earliest day with any entry for this tracker (or null).
export function firstLogKey(tracker, days) {
  let first = null;
  for (const key in days) {
    if (days[key][tracker.id] && (first === null || key < first)) first = key;
  }
  return first;
}

// Earliest day that "exists" for the tracker: first log or creation day.
export function firstDayKey(tracker, days) {
  const log = firstLogKey(tracker, days);
  if (log && (!tracker.createdAt || log < tracker.createdAt)) return log;
  return tracker.createdAt || log;
}

// Calendar cell status.
//   'hit' | 'partial' (counter under target) | 'miss' | 'pending' (today,
//   nothing yet) | 'empty' (before the tracker existed / padding) | 'future'
export function dayStatus(tracker, days, dateKey, today = todayKey()) {
  if (dateKey > today) return 'future';
  const entry = entryFor(days, dateKey, tracker.id);
  if (isHit(tracker, entry, dateKey)) return 'hit';
  if (tracker.type === 'counter' && entry && (entry.total || 0) > 0) return 'partial';
  if (tracker.type === 'habit' && habitCount(entry) > 0) return 'partial';
  const first = firstDayKey(tracker, days);
  if (!first || dateKey < first) return 'empty';
  if (dateKey === today) return 'pending';
  // A counter with no goal that day isn't "missed", just quiet.
  if (tracker.type === 'counter' && effectiveTarget(tracker, dateKey, entry) <= 0) return 'empty';
  // A weekly-cadence tracker has no fixed daily obligation — an off day
  // isn't a failure, so it reads the same as any other non-required day.
  if (tracker.cadence && tracker.cadence.enabled) return 'empty';
  return 'miss';
}

// Consecutive goal-hit days ending today; an unfinished today doesn't break
// the run, it just doesn't count yet. Weekly-cadence trackers dispatch to
// the week-granularity versions below — same philosophy, one level up.
export function currentStreak(tracker, days, today = todayKey()) {
  if (tracker.cadence && tracker.cadence.enabled) return currentWeeklyStreak(tracker, days, today);
  let d = today;
  if (!isHit(tracker, entryFor(days, d, tracker.id), d)) d = addDays(d, -1);
  let n = 0;
  while (isHit(tracker, entryFor(days, d, tracker.id), d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export function longestStreak(tracker, days, today = todayKey()) {
  if (tracker.cadence && tracker.cadence.enabled) return longestWeeklyStreak(tracker, days, today);
  const first = firstDayKey(tracker, days);
  if (!first) return 0;
  let best = 0;
  let run = 0;
  for (let d = first; d <= today; d = addDays(d, 1)) {
    if (isHit(tracker, entryFor(days, d, tracker.id), d)) {
      run++;
      if (run > best) best = run;
    } else if (d !== today) {
      run = 0; // today still in progress doesn't reset the run
    }
  }
  return best;
}

// Consecutive quota-met weeks (Mon-Sun) ending with this week. A week still
// in progress that hasn't reached quota yet doesn't break the streak, it
// just isn't counted yet — mirrors currentStreak's "today in progress" rule
// one level up. Terminates naturally once it reaches weeks before the
// tracker existed (hitDays is 0 there, always below quota) — no explicit
// lower bound needed, since rangeStats returns zeroes for weeks with no data.
function currentWeeklyStreak(tracker, days, today) {
  const quota = tracker.cadence.timesPerWeek;
  let monday = mondayOf(today);
  const cur = rangeStats(tracker, days, monday, addDays(monday, 6), today);
  if (cur.hitDays < quota) monday = addDays(monday, -7);
  let n = 0;
  for (;;) {
    const stat = rangeStats(tracker, days, monday, addDays(monday, 6), today);
    if (stat.hitDays < quota) break;
    n++;
    monday = addDays(monday, -7);
  }
  return n;
}

function longestWeeklyStreak(tracker, days, today) {
  const first = firstDayKey(tracker, days);
  if (!first) return 0;
  const quota = tracker.cadence.timesPerWeek;
  const curMonday = mondayOf(today);
  let best = 0;
  let run = 0;
  for (let monday = mondayOf(first); monday <= curMonday; monday = addDays(monday, 7)) {
    const stat = rangeStats(tracker, days, monday, addDays(monday, 6), today);
    if (stat.hitDays >= quota) {
      run++;
      if (run > best) best = run;
    } else if (monday !== curMonday) {
      run = 0; // the current week in progress doesn't reset the run
    }
  }
  return best;
}

// Hit-days-so-far vs quota for the Mon-Sun week containing `today` — the
// shared building block views use to show weekly-cadence progress.
export function weekProgress(tracker, days, today = todayKey()) {
  const quota = tracker.cadence ? tracker.cadence.timesPerWeek : 0;
  const monday = mondayOf(today);
  const stat = rangeStats(tracker, days, monday, addDays(monday, 6), today);
  return { hitDays: stat.hitDays, quota, met: stat.hitDays >= quota };
}

// All-time stats for the history view.
export function trackerStats(tracker, days, today = todayKey()) {
  const s = {
    total: 0,
    sessions: 0,
    goalsHit: 0,
    doneDays: 0,
    bestDay: null, // {key, total}
    avgPerSession: 0,
    currentStreak: currentStreak(tracker, days, today),
    longestStreak: longestStreak(tracker, days, today),
    loggedDays: 0,
  };
  let positiveSum = 0;
  for (const key in days) {
    if (key > today) continue;
    const entry = days[key][tracker.id];
    if (!entry) continue;
    s.loggedDays++;
    if (isHit(tracker, entry, key)) s.goalsHit++;
    if (tracker.type === 'habit') {
      if (habitCount(entry) > 0) s.doneDays++;
      continue;
    }
    const total = entry.total || 0;
    s.total += total;
    for (const set of entry.sets || []) {
      if (set.a > 0) {
        s.sessions++;
        positiveSum += set.a;
      }
    }
    if (total > 0 && (!s.bestDay || total > s.bestDay.total)) {
      s.bestDay = { key, total };
    }
  }
  s.total = roundAmount(tracker, s.total);
  if (s.sessions > 0) s.avgPerSession = positiveSum / s.sessions;
  return s;
}

// Roll a tracker's days up over an inclusive date-key range, clamped so a
// period that's still in progress (this week/month) only counts elapsed
// days, not ones that haven't happened yet. targetSum is the exception: it
// sums the *whole* nominal period's daily goals (including days still to
// come), since it's the denominator weekly/monthly views compare the
// period's total against — a week's "expected" total assumes the week
// eventually completes, not just the part of it that's happened so far.
export function rangeStats(tracker, days, fromKey, toKey, today = todayKey()) {
  const end = toKey > today ? today : toKey;
  const s = { total: 0, checks: 0, hitDays: 0, elapsedDays: 0, targetSum: 0 };
  if (fromKey <= end) {
    for (let k = fromKey; k <= end; k = addDays(k, 1)) {
      s.elapsedDays++;
      const entry = entryFor(days, k, tracker.id);
      if (tracker.type === 'habit') s.checks += habitCount(entry);
      else s.total += entry ? entry.total || 0 : 0;
      if (isHit(tracker, entry, k)) s.hitDays++;
    }
    s.total = roundAmount(tracker, s.total);
  }
  for (let k = fromKey; k <= toKey; k = addDays(k, 1)) {
    const entry = entryFor(days, k, tracker.id);
    s.targetSum += tracker.type === 'habit' ? habitTarget(tracker, entry) : effectiveTarget(tracker, k, entry);
  }
  return s;
}

// Continuous 0..1 "how loaded" a week/month should look, ramping between
// two multiples of the period's target sum. Unlike hitIntensity there's no
// hard hit/miss gate here — a week has no single "done" moment, so colour
// just tracks progress along the ramp: nothing below lowerMult, maxed out
// at/above upperMult, linear in between.
export function periodIntensity(achieved, targetSum, lowerMult, upperMult) {
  if (targetSum <= 0) return 0;
  const ratio = achieved / targetSum;
  if (ratio <= lowerMult) return 0;
  if (ratio >= upperMult) return 1;
  return (ratio - lowerMult) / (upperMult - lowerMult);
}

// ---- Pomodoro ----
// Rides on top of the plain live timer (state.timers[tid].startedAt still
// owns "is a session running"): this just overlays phase boundaries on top,
// computed from stored timestamps rather than ticked down, so a locked
// phone can never drift or stall it — every value here is re-derived fresh
// from Date.now() and the persisted schedule, never accumulated tick by
// tick. Pure data in, data out; store.js owns persistence, the views own
// display and the setInterval that repaints them (see log-sheet.js).

export const DEFAULT_POMODORO_CYCLES_FOR_LONG_BREAK = 4;
export const POMODORO_PHASE_LABEL = { work: 'Work', break: 'Break', longBreak: 'Long break' };

function pomodoroPhaseDurationMs(p, phase) {
  if (phase === 'work') return p.workMins * 60000;
  if (phase === 'longBreak') return p.longBreakMins * 60000;
  return p.breakMins * 60000;
}

// Work phase -> break (long break every cyclesPerLongBreak-th cycle, a
// per-tracker setting); anything else (break or long break) -> back to work.
function nextPomodoroPhase(p) {
  if (p.phase === 'work') {
    const n = p.cyclesPerLongBreak || DEFAULT_POMODORO_CYCLES_FOR_LONG_BREAK;
    return p.cyclesCompleted > 0 && p.cyclesCompleted % n === 0
      ? 'longBreak' : 'break';
  }
  return 'work';
}

// Work-only elapsed for a running session, in ms — breaks are excluded
// from the tracker's total by design (see the Pomodoro feature notes):
// only completed work phases (workAccumMs) plus, if currently in a work
// phase, however much of it has elapsed so far. Paused freezes that at
// pausedRemainingMs rather than reading the (stale) live clock.
export function pomodoroWorkElapsedMs(p, now = Date.now()) {
  if (!p || !p.phase) return 0;
  let extra = 0;
  if (p.phase === 'work') {
    const durationMs = pomodoroPhaseDurationMs(p, 'work');
    const remaining = p.paused ? (p.pausedRemainingMs || 0) : Math.max(0, p.phaseEndTimestamp - now);
    extra = Math.max(0, durationMs - Math.max(0, remaining));
  }
  return (p.workAccumMs || 0) + extra;
}

// Time left in the current phase, ms (never negative) — 0 means a phase
// boundary has been reached but not yet advanced (advancePomodoro's job).
export function pomodoroRemainingMs(p, now = Date.now()) {
  if (!p || !p.phase) return 0;
  if (p.paused) return p.pausedRemainingMs || 0;
  return Math.max(0, p.phaseEndTimestamp - now);
}

// Advances a session's phase as many times as elapsed real time demands —
// a phone locked through more than one boundary catches up fully in one
// call, rather than getting stuck on the first missed phase. Each new
// phase's end is anchored to the *previous* end plus its own duration
// (not "now" + duration), so a catch-up run doesn't drift the schedule
// forward. A paused session never advances. Returns the possibly-updated
// pomodoro state plus the ordered list of phases transitioned into (the
// last entry is the phase that's current now).
export function advancePomodoro(p, now = Date.now()) {
  if (!p || !p.phase || p.paused) return { pomodoro: p, transitions: [] };
  const cur = { ...p };
  const transitions = [];
  let guard = 0;
  while (cur.phaseEndTimestamp != null && now >= cur.phaseEndTimestamp && guard++ < 1000) {
    if (cur.phase === 'work') {
      cur.workAccumMs = (cur.workAccumMs || 0) + pomodoroPhaseDurationMs(cur, 'work');
      cur.cyclesCompleted += 1;
    }
    const next = nextPomodoroPhase(cur);
    cur.phaseEndTimestamp += pomodoroPhaseDurationMs(cur, next);
    cur.phase = next;
    transitions.push(next);
  }
  return { pomodoro: cur, transitions };
}

// A user-initiated skip: ends the current phase right now rather than
// waiting for it to elapse. A work phase skipped early still credits
// whatever of it was completed (progress isn't thrown away) and still
// counts toward the long-break cadence; a break skipped early credits
// nothing, since breaks were never counted. The new phase is anchored to
// "now", not the old schedule — a manual skip is a deliberate reset of
// the cadence, unlike a catch-up.
export function skipPomodoro(p, now = Date.now()) {
  if (!p || !p.phase) return p;
  const cur = { ...p };
  if (cur.phase === 'work') {
    const durationMs = pomodoroPhaseDurationMs(cur, 'work');
    const remaining = cur.paused ? (cur.pausedRemainingMs || 0) : Math.max(0, cur.phaseEndTimestamp - now);
    cur.workAccumMs = (cur.workAccumMs || 0) + Math.max(0, durationMs - remaining);
    cur.cyclesCompleted += 1;
  }
  const next = nextPomodoroPhase(cur);
  cur.phase = next;
  cur.phaseEndTimestamp = now + pomodoroPhaseDurationMs(cur, next);
  cur.paused = false;
  cur.pausedRemainingMs = null;
  return cur;
}

// ---- Sorting helpers shared by views and reorder mutations ----

const byOrder = (a, b) => (a.order - b.order) || String(a.id).localeCompare(String(b.id));

export function activeTrackers(state) {
  return Object.values(state.trackers).filter((t) => !t.archived);
}

// Priority trackers, pinned to the top of Home. The strip has its own
// ordering (pinOrder) independent of positions inside groups.
export function pinnedTrackers(state) {
  return activeTrackers(state)
    .filter((t) => t.priority)
    .sort((a, b) => ((a.pinOrder ?? a.order) - (b.pinOrder ?? b.order)) || byOrder(a, b));
}

// All trackers inside a group (groupId null = ungrouped), pinned included —
// pinning surfaces a tracker on Home, it doesn't remove it from its group.
export function groupTrackers(state, groupId) {
  return activeTrackers(state)
    .filter((t) => (t.groupId || null) === (groupId || null))
    .sort(byOrder);
}

export function sortedGroups(state) {
  return Object.values(state.groups).sort(
    (a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0) || byOrder(a, b)
  );
}

// What "move up/down" operates on, given where the menu was opened from:
// the pinned strip reorders pinOrder, a group section reorders order.
export function reorderContext(state, tracker, context) {
  if (context === 'pinned' && tracker.priority) {
    return { list: pinnedTrackers(state), field: 'pinOrder' };
  }
  return { list: groupTrackers(state, tracker.groupId), field: 'order' };
}

// Today's headline: how many goals are hit out of those that exist today.
// Counters with no target that day don't count as goals.
export function todaySummary(state, today = todayKey()) {
  let goals = 0;
  let hit = 0;
  for (const t of activeTrackers(state)) {
    if (t.cadence && t.cadence.enabled) continue; // no fixed daily obligation
    const entry = entryFor(state.days, today, t.id);
    if (t.type === 'counter' && effectiveTarget(t, today, entry) <= 0 &&
        !(entry && entry.goalOverride === 0)) continue;
    goals++;
    if (isHit(t, entry, today)) hit++;
  }
  return { goals, hit };
}
