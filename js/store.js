// State + persistence. A single normalized state object lives in
// localStorage under one key; every mutation goes through commit() which
// re-normalizes touched entries, saves, and notifies subscribers.

import { todayKey, isValidKey, addDays, parseKey, weekdayIndex } from './dates.js';
import { roundAmount, isHit, pomodoroWorkElapsedMs, advancePomodoro, skipPomodoro } from './model.js';

// Timestamp for a set logged against dateKey: real time for today, a
// synthetic noon-ish time for retro days (keeps display + undo order sane).
export function stampFor(dateKey, entry, now = Date.now()) {
  if (dateKey === todayKey()) return now;
  const n = entry && entry.sets ? entry.sets.length : 0;
  return parseKey(dateKey).getTime() + (12 * 60 + n) * 60000;
}

export const SCHEMA = 1;
export const STORAGE_KEY = 'reps_v1';
export const DEMO_KEY = 'reps_demo_v1';

export const PALETTE = [
  '#FF8A3D', '#FFB454', '#F2C94C', '#FF6B5E', '#E4573D',
  '#F27E9D', '#C77DBB', '#8E7CC3', '#64B5A6', '#A2C05A',
];

let idTick = 0;
export function genId(prefix) {
  idTick = (idTick + 1) % 1296;
  const rnd = Math.floor(Math.random() * 46656).toString(36).padStart(3, '0');
  return `${prefix}_${Date.now().toString(36)}${idTick.toString(36).padStart(2, '0')}${rnd}`;
}

const num = (x, fallback = 0) => (typeof x === 'number' && isFinite(x) ? x : fallback);
const str = (x, fallback = '') => (typeof x === 'string' ? x : fallback);

// ---- Normalization: turn possibly-partial/foreign data into a clean state ----

// Pomodoro config + live phase state, bundled in one object that lives on
// the tracker itself (like target/chips) — only time counters get one;
// everything else is null. workMins/breakMins/longBreakMins are the
// user's settings (persist across sessions); phase/phaseEndTimestamp/
// cyclesCompleted/paused/pausedRemainingMs/workAccumMs are live and only
// meaningful while phase is non-null (a session is running) — startTimer/
// stopTimer/cancelTimer in the store below set and clear them.
function normalizePomodoro(raw, isTimeCounter) {
  if (!isTimeCounter) return null;
  const src = raw && typeof raw === 'object' ? raw : {};
  const posInt = (x, fallback) => {
    const n = Math.round(num(x, fallback));
    return n > 0 ? n : fallback;
  };
  return {
    enabled: !!src.enabled,
    workMins: posInt(src.workMins, 25),
    breakMins: posInt(src.breakMins, 5),
    longBreakMins: posInt(src.longBreakMins, 15),
    cyclesPerLongBreak: posInt(src.cyclesPerLongBreak, 4),
    phase: ['work', 'break', 'longBreak'].includes(src.phase) ? src.phase : null,
    phaseEndTimestamp: isFinite(src.phaseEndTimestamp) ? src.phaseEndTimestamp : null,
    cyclesCompleted: Math.max(0, Math.round(num(src.cyclesCompleted, 0))),
    paused: !!src.paused,
    pausedRemainingMs: isFinite(src.pausedRemainingMs) ? Math.max(0, src.pausedRemainingMs) : null,
    workAccumMs: Math.max(0, num(src.workAccumMs, 0)),
  };
}

// A tracker's goal can apply every day (the default) or on only some number
// of days each week — timesPerWeek persists even while disabled, same as
// Pomodoro's settings, so re-enabling it doesn't lose the last chosen count.
function normalizeCadence(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const n = Math.round(num(src.timesPerWeek, 3));
  const timesPerWeek = n > 0 ? Math.min(7, n) : 3;
  return { enabled: !!src.enabled, timesPerWeek };
}

// Ends a tracker's live Pomodoro session (stop/cancel) — clears the phase
// bookkeeping back to "no session running" while leaving the user's
// enabled/workMins/breakMins/longBreakMins settings untouched for next time.
function clearPomodoroSession(t) {
  t.pomodoro.phase = null;
  t.pomodoro.phaseEndTimestamp = null;
  t.pomodoro.cyclesCompleted = 0;
  t.pomodoro.paused = false;
  t.pomodoro.pausedRemainingMs = null;
  t.pomodoro.workAccumMs = 0;
}

function normalizeTracker(raw, i) {
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type === 'habit' ? 'habit' : 'counter';
  const t = {
    id: str(raw.id) || genId('t'),
    name: str(raw.name, 'Tracker').slice(0, 60) || 'Tracker',
    color: str(raw.color, PALETTE[i % PALETTE.length]),
    type,
    groupId: str(raw.groupId) || null,
    priority: !!raw.priority,
    archived: !!raw.archived,
    order: num(raw.order, i),
    pinOrder: num(raw.pinOrder, num(raw.order, i)),
    createdAt: isValidKey(raw.createdAt) ? raw.createdAt : todayKey(),
    cadence: normalizeCadence(raw.cadence),
  };
  if (type === 'counter') {
    t.time = !!raw.time; // amounts are minutes, shown as h/m
    t.unit = t.time ? '' : str(raw.unit, '').slice(0, 20);
    t.dec = t.time ? false : !!raw.dec;
    const tgRaw = raw.target && typeof raw.target === 'object' ? raw.target : {};
    const mode = ['none', 'daily', 'weekly'].includes(tgRaw.mode) ? tgRaw.mode : 'none';
    t.target = {
      base: Math.max(0, num(tgRaw.base)),
      mode,
      inc: Math.max(0, num(tgRaw.inc)),
      start: isValidKey(tgRaw.start) ? tgRaw.start : t.createdAt,
    };
    t.chips = Array.isArray(raw.chips)
      ? raw.chips.map((c) => num(c, NaN)).filter((c) => isFinite(c) && c > 0).slice(0, 8)
      : [];
    t.pomodoro = normalizePomodoro(raw.pomodoro, t.time);
  } else {
    t.perDay = Math.max(1, Math.round(num(raw.perDay, 1)));
    t.pomodoro = null;
  }
  return t;
}

// A recurring weekly class, OR a one-off event when `date` is set — in
// that case `days`/`startDate`/`endDate` are meaningless (classOccursOn
// ignores them) and kept empty here so stored data never has two
// conflicting ideas of when the thing happens. `days` are weekday indices
// (dates.js's Monday=0..Sunday=6), `startTime` is "HH:MM" 24h.
// `startDate`/`endDate` are both optional — left null a recurring class
// repeats forever, matching how a tracker never has a built-in end date
// either. `linkedTrackerId` is validated against the live tracker map by
// the caller (normalizeState on load, commit() at runtime), never here,
// since this function has no access to the tracker map.
function normalizeClass(raw, i) {
  if (!raw || typeof raw !== 'object') return null;
  const date = isValidKey(raw.date) ? raw.date : null;
  const days = !date && Array.isArray(raw.days)
    ? [...new Set(raw.days.map((d) => Math.round(num(d, -1))).filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b)
    : [];
  const createdAt = isValidKey(raw.createdAt) ? raw.createdAt : todayKey();
  return {
    id: str(raw.id) || genId('c'),
    name: str(raw.name, 'Class').slice(0, 60) || 'Class',
    color: str(raw.color, PALETTE[i % PALETTE.length]),
    days,
    date,
    startTime: /^\d{2}:\d{2}$/.test(raw.startTime) ? raw.startTime : '09:00',
    durationMins: Math.max(5, Math.round(num(raw.durationMins, 60))),
    location: str(raw.location, '').slice(0, 60),
    linkedTrackerId: str(raw.linkedTrackerId) || null,
    startDate: !date && isValidKey(raw.startDate) ? raw.startDate : null,
    endDate: !date && isValidKey(raw.endDate) ? raw.endDate : null,
    archived: !!raw.archived,
    order: num(raw.order, i),
    createdAt,
  };
}

function normalizeGroup(raw, i) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: str(raw.id) || genId('g'),
    name: str(raw.name, 'Group').slice(0, 40) || 'Group',
    color: str(raw.color, PALETTE[(i + 3) % PALETTE.length]),
    priority: !!raw.priority,
    collapsed: !!raw.collapsed,
    order: num(raw.order, i),
  };
}

function normalizeEntry(tracker, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const entry = {};
  if (raw.goalOverride != null && isFinite(raw.goalOverride) && raw.goalOverride >= 0) {
    entry.goalOverride = roundAmount(tracker, Number(raw.goalOverride));
  }
  if (tracker.type === 'habit') {
    // older data stored {done: true}; count supersedes it
    const count = Math.max(0, Math.round(num(raw.count, raw.done ? 1 : 0)));
    if (count > 0) entry.count = count;
    return entry.count || entry.goalOverride != null ? entry : null;
  }
  entry.sets = Array.isArray(raw.sets)
    ? raw.sets
        .filter((s) => s && isFinite(s.a) && s.a !== 0)
        .map((s) => ({ a: roundAmount(tracker, Number(s.a)), t: num(s.t, 0) }))
        .filter((s) => s.a !== 0)
    : [];
  entry.total = recomputeTotal(tracker, entry.sets);
  if (!entry.sets.length && entry.goalOverride == null) return null;
  return entry;
}

function recomputeTotal(tracker, sets) {
  let sum = 0;
  for (const s of sets) sum += s.a;
  return Math.max(0, roundAmount(tracker, sum));
}

export function normalizeState(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const state = { schema: SCHEMA, trackers: {}, groups: {}, days: {}, classes: {}, classDays: {}, meta: {} };

  const groupsSrc = src.groups && typeof src.groups === 'object' ? src.groups : {};
  let gi = 0;
  for (const key in groupsSrc) {
    const g = normalizeGroup(groupsSrc[key], gi++);
    if (g) state.groups[g.id] = g;
  }

  const trackersSrc = src.trackers && typeof src.trackers === 'object' ? src.trackers : {};
  let ti = 0;
  for (const key in trackersSrc) {
    const t = normalizeTracker(trackersSrc[key], ti++);
    if (!t) continue;
    if (t.groupId && !state.groups[t.groupId]) t.groupId = null;
    state.trackers[t.id] = t;
  }

  const daysSrc = src.days && typeof src.days === 'object' ? src.days : {};
  for (const dateKey in daysSrc) {
    if (!isValidKey(dateKey)) continue;
    const daySrc = daysSrc[dateKey];
    if (!daySrc || typeof daySrc !== 'object') continue;
    const day = {};
    for (const tid in daySrc) {
      const tracker = state.trackers[tid];
      if (!tracker) continue;
      const entry = normalizeEntry(tracker, daySrc[tid]);
      if (entry) day[tid] = entry;
    }
    if (Object.keys(day).length) state.days[dateKey] = day;
  }

  const classesSrc = src.classes && typeof src.classes === 'object' ? src.classes : {};
  let ci = 0;
  for (const key in classesSrc) {
    const c = normalizeClass(classesSrc[key], ci++);
    if (!c) continue;
    if (c.linkedTrackerId) {
      const lt = state.trackers[c.linkedTrackerId];
      if (!lt || lt.type !== 'counter' || !lt.time) c.linkedTrackerId = null;
    }
    state.classes[c.id] = c;
  }

  const classDaysSrc = src.classDays && typeof src.classDays === 'object' ? src.classDays : {};
  for (const dateKey in classDaysSrc) {
    if (!isValidKey(dateKey)) continue;
    const daySrc = classDaysSrc[dateKey];
    if (!daySrc || typeof daySrc !== 'object') continue;
    const day = {};
    for (const cid in daySrc) {
      if (state.classes[cid] && daySrc[cid] && daySrc[cid].done) day[cid] = { done: true };
    }
    if (Object.keys(day).length) state.classDays[dateKey] = day;
  }

  // Both optional wide home-screen tiles default to hidden unless a prior
  // explicit choice says otherwise — undefined ("never touched") reads as
  // hidden, but an explicit `false` (the user picked "show again" at some
  // point) sticks, same as an explicit `true` sticks.
  const metaSrc = src.meta && typeof src.meta === 'object' ? src.meta : {};
  state.meta = {
    lastBackup: isValidKey(metaSrc.lastBackup) ? metaSrc.lastBackup : null,
    createdAt: isValidKey(metaSrc.createdAt) ? metaSrc.createdAt : todayKey(),
    nutritionHidden: metaSrc.nutritionHidden == null ? true : !!metaSrc.nutritionHidden,
    classesHidden: metaSrc.classesHidden == null ? true : !!metaSrc.classesHidden,
  };

  // Live timers: a plain timestamp per tracker. Surviving a reload/backgrounded
  // phone needs no ticking anything — elapsed time is just Date.now() minus
  // this, computed whenever it's next read.
  const timersSrc = src.timers && typeof src.timers === 'object' ? src.timers : {};
  state.timers = {};
  for (const tid in timersSrc) {
    const tracker = state.trackers[tid];
    const raw = timersSrc[tid];
    if (tracker && tracker.type === 'counter' && tracker.time && raw && isFinite(raw.startedAt)) {
      state.timers[tid] = { startedAt: raw.startedAt };
    }
  }
  return state;
}

// Quick shape check + summary for the import flow.
export function validateImport(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'Not a JSON object.' };
  if (obj.trackers == null || typeof obj.trackers !== 'object') {
    return { ok: false, error: 'Missing "trackers" — this doesn’t look like a Reps backup.' };
  }
  if (obj.days != null && typeof obj.days !== 'object') {
    return { ok: false, error: '"days" has the wrong shape.' };
  }
  const data = normalizeState(obj);
  const trackers = Object.keys(data.trackers).length;
  if (!trackers) return { ok: false, error: 'No valid trackers found in that file.' };
  let sets = 0;
  const dayCount = Object.keys(data.days).length;
  for (const k in data.days) {
    for (const tid in data.days[k]) sets += (data.days[k][tid].sets || []).length;
  }
  return {
    ok: true,
    data,
    summary: {
      trackers, groups: Object.keys(data.groups).length, days: dayCount, sets,
      classes: Object.keys(data.classes).length,
    },
  };
}

// ---- Seed + demo content ----

export function seedState(today = todayKey()) {
  const fit = { id: 'g_fitness', name: 'Fitness', color: '#FF8A3D', order: 0 };
  const mk = (t) => ({ createdAt: today, ...t });
  return normalizeState({
    groups: { [fit.id]: fit },
    trackers: {
      t_pushups: mk({
        id: 't_pushups', name: 'Push-ups', color: '#FF8A3D', type: 'counter',
        groupId: fit.id, priority: true, order: 0, unit: 'reps',
        target: { base: 50 }, chips: [10, 15, 20, 25, 30],
      }),
      t_crunches: mk({
        id: 't_crunches', name: 'Crunches', color: '#FF6B5E', type: 'counter',
        groupId: fit.id, order: 1, unit: 'reps',
        target: { base: 60 }, chips: [15, 20, 30],
      }),
      t_run: mk({
        id: 't_run', name: 'Run', color: '#F2C94C', type: 'counter',
        groupId: fit.id, order: 2, unit: 'km', dec: true,
        target: { base: 3 }, chips: [0.5, 1, 2, 3, 5],
      }),
      t_stretch: mk({
        id: 't_stretch', name: 'Stretch', color: '#A2C05A', type: 'habit',
        priority: true, order: 3,
      }),
    },
    meta: { createdAt: today },
  });
}

// Deterministic PRNG so demo data is stable for testing.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoState(today = todayKey()) {
  const rand = mulberry32(42);
  const SPAN = 76; // ~11 weeks of history
  const start = addDays(today, -SPAN);
  const weekStart = addDays(today, -70);

  const raw = seedState(today);
  for (const t of Object.values(raw.trackers)) t.createdAt = start;
  raw.trackers.t_pushups.target = { base: 30, mode: 'weekly', inc: 5, start: weekStart };
  raw.groups.g_mind = { id: 'g_mind', name: 'Mind', color: '#8E7CC3', order: 1 };
  raw.trackers.t_reading = {
    id: 't_reading', name: 'Reading', color: '#C77DBB', type: 'counter',
    groupId: 'g_mind', order: 4, unit: 'pages', target: { base: 20 },
    chips: [5, 10, 20], createdAt: start,
  };
  raw.trackers.t_meditate = {
    id: 't_meditate', name: 'Meditate', color: '#64B5A6', type: 'habit',
    groupId: 'g_mind', order: 5, createdAt: start, perDay: 2,
  };
  raw.trackers.t_water = {
    id: 't_water', name: 'Water', color: '#FFB454', type: 'counter',
    order: 6, unit: 'glasses', target: { base: 8 }, chips: [1, 2], createdAt: start,
  };
  raw.trackers.t_study = {
    id: 't_study', name: 'Study', color: '#F27E9D', type: 'counter',
    groupId: 'g_mind', order: 7, time: true, target: { base: 90 },
    chips: [15, 30, 60], createdAt: start,
  };

  // A small demo timetable showing the Classes card off the shelf: a
  // twice-weekly lecture, a tutorial linked to Study (so attending it adds
  // its minutes there automatically), and an unlinked lab.
  raw.classes = {
    c_datastruct: {
      id: 'c_datastruct', name: 'Data Structures', color: '#FF8A3D',
      days: [0, 2], startTime: '09:00', durationMins: 60,
      location: 'Building 4, Rm 12', linkedTrackerId: null, createdAt: start, order: 0,
    },
    c_algo_tut: {
      id: 'c_algo_tut', name: 'Algorithms Tutorial', color: '#8E7CC3',
      days: [3], startTime: '14:00', durationMins: 120,
      location: 'Lab 3', linkedTrackerId: 't_study', createdAt: start, order: 1,
    },
    c_physlab: {
      id: 'c_physlab', name: 'Physics Lab', color: '#64B5A6',
      days: [4], startTime: '13:00', durationMins: 120,
      location: 'Building 7', linkedTrackerId: null, createdAt: start, order: 2,
    },
  };

  const days = {};
  const classDays = {};
  const put = (key, tid, entry) => {
    (days[key] = days[key] || {})[tid] = entry;
  };
  const putClass = (key, cid) => {
    (classDays[key] = classDays[key] || {})[cid] = { done: true };
  };
  const noonOf = (key, i) => new Date(...key.split('-').map(Number).map((v, j) => (j === 1 ? v - 1 : v))).getTime() + (12 * 3600 + i * 900) * 1000;
  const counterDay = (key, tid, amounts) => {
    const sets = amounts.map((a, i) => ({ a, t: noonOf(key, i) }));
    put(key, tid, { sets, total: 0 });
  };
  // Appends rather than replaces — t_study can be topped up twice in one
  // day (a linked tutorial plus independent study), and a plain counterDay
  // call would clobber whichever happened first.
  const addSets = (key, tid, amounts) => {
    const day = days[key] || {};
    const existing = (day[tid] && day[tid].sets) || [];
    const sets = [...existing, ...amounts.map((a, i) => ({ a, t: noonOf(key, existing.length + i) }))];
    days[key] = day;
    day[tid] = { sets, total: 0 };
  };

  for (let off = SPAN; off >= 0; off--) {
    const key = addDays(today, -off);
    const isToday = off === 0;
    // Push-ups: most days, 2-4 sets around the growing target.
    if (rand() < (isToday ? 0.7 : 0.85)) {
      const n = 2 + Math.floor(rand() * 3);
      counterDay(key, 't_pushups', Array.from({ length: n }, () => 10 + Math.floor(rand() * 16)));
    } else if (rand() < 0.25) {
      put(key, 't_pushups', { sets: [], total: 0, goalOverride: 0 }); // declared rest day
    }
    // Crunches: ~70% of days.
    if (rand() < 0.7) {
      const n = 2 + Math.floor(rand() * 2);
      counterDay(key, 't_crunches', Array.from({ length: n }, () => 20 + Math.floor(rand() * 16)));
    }
    // Run: ~4 days a week, decimal km.
    if (rand() < 0.55 && !isToday) {
      counterDay(key, 't_run', [Math.round((2 + rand() * 4.5) * 10) / 10]);
    }
    // Reading: ~60%.
    if (rand() < 0.6) {
      counterDay(key, 't_reading', [5 + Math.floor(rand() * 30)]);
    }
    // Water: most days, several small sets.
    if (rand() < 0.8) {
      const n = 4 + Math.floor(rand() * 5);
      counterDay(key, 't_water', Array.from({ length: n }, () => (rand() < 0.7 ? 1 : 2)));
    }
    // Habits.
    if (rand() < 0.8) put(key, 't_stretch', { done: true });
    if (rand() < 0.65) put(key, 't_meditate', { count: rand() < 0.6 ? 2 : 1 });

    // Classes: mostly attended, occasionally skipped (never "today", which
    // starts unmarked so the tile has something to check off live).
    const wd = weekdayIndex(key);
    if (!isToday) {
      if ((wd === 0 || wd === 2) && rand() < 0.9) putClass(key, 'c_datastruct');
      if (wd === 3 && rand() < 0.85) {
        putClass(key, 'c_algo_tut');
        addSets(key, 't_study', [120]); // the tutorial's own linked minutes
      }
      if (wd === 4 && rand() < 0.8) putClass(key, 'c_physlab');
    }
    // Some independent study time on top of whatever the tutorial added.
    if (!isToday && rand() < 0.4) addSets(key, 't_study', [15 + Math.floor(rand() * 40)]);
  }
  raw.days = days;
  raw.classDays = classDays;
  raw.meta = {
    createdAt: start, lastBackup: addDays(today, -12),
    nutritionHidden: false, classesHidden: false,
  };
  return normalizeState(raw);
}

// ---- Store factory ----

export function createStore({ storage, key = STORAGE_KEY, seed = seedState } = {}) {
  let state;
  const listeners = new Set();

  function load() {
    let raw = null;
    try {
      const json = storage.getItem(key);
      if (json) raw = JSON.parse(json);
    } catch (e) { /* corrupted storage falls through to seed */ }
    state = raw ? normalizeState(raw) : seed();
    if (!raw) save();
  }

  function save() {
    try {
      storage.setItem(key, JSON.stringify(state));
    } catch (e) { /* quota errors: keep running in memory */ }
  }

  // Only a live time counter is a valid link target. Re-checked on every
  // commit (cheap — there are never many classes) rather than threaded
  // through every place a tracker can change shape or disappear, so a
  // class link can never point at a stale/invalid tracker no matter which
  // mutation caused it (edited to Count, changed type, deleted, restored
  // from a backup missing it).
  function isValidLinkTarget(id) {
    const t = state.trackers[id];
    return !!(t && t.type === 'counter' && t.time);
  }

  function commit() {
    for (const c of Object.values(state.classes)) {
      if (c.linkedTrackerId && !isValidLinkTarget(c.linkedTrackerId)) c.linkedTrackerId = null;
    }
    save();
    for (const fn of listeners) fn();
  }

  const tracker = (id) => state.trackers[id];

  function dayEntry(dateKey, tid, create = false) {
    let day = state.days[dateKey];
    if (!day && create) day = state.days[dateKey] = {};
    if (!day) return null;
    let entry = day[tid];
    if (!entry && create) {
      entry = day[tid] = tracker(tid).type === 'habit' ? {} : { sets: [], total: 0 };
    }
    return entry || null;
  }

  // Drop empty entries/days so "no data" and "empty day" stay the same thing.
  function cleanupDay(dateKey, tid) {
    const day = state.days[dateKey];
    if (!day) return;
    const entry = day[tid];
    if (entry) {
      const t = tracker(tid);
      const keep = entry.goalOverride != null ||
        (t.type === 'habit' ? (entry.count || 0) > 0 : (entry.sets || []).length > 0);
      if (!keep) delete day[tid];
    }
    if (!Object.keys(day).length) delete state.days[dateKey];
  }

  function nextOrder(objects) {
    let max = -1;
    for (const o of Object.values(objects)) if (o.order > max) max = o.order;
    return max + 1;
  }

  // Newly pinned trackers join the end of the pinned strip.
  function nextPinOrder(exceptId) {
    let max = -1;
    for (const t of Object.values(state.trackers)) {
      if (t.priority && t.id !== exceptId && t.pinOrder > max) max = t.pinOrder;
    }
    return max + 1;
  }

  const api = {
    get state() { return state; },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    // -- trackers --
    addTracker(fields) {
      const t = normalizeTracker(
        { ...fields, id: genId('t'), order: nextOrder(state.trackers) },
        Object.keys(state.trackers).length
      );
      if (t.groupId && !state.groups[t.groupId]) t.groupId = null;
      state.trackers[t.id] = t;
      commit();
      return t.id;
    },
    updateTracker(id, patch) {
      const cur = tracker(id);
      if (!cur) return;
      const next = normalizeTracker({ ...cur, ...patch, id, type: cur.type }, 0);
      next.order = cur.order;
      if (!cur.priority && next.priority) next.pinOrder = nextPinOrder(id);
      if (next.groupId && !state.groups[next.groupId]) next.groupId = null;
      state.trackers[id] = next;
      commit();
    },
    setTrackerPriority(id, priority) {
      const t = tracker(id);
      if (!t) return;
      if (!t.priority && priority) t.pinOrder = nextPinOrder(id);
      t.priority = !!priority;
      commit();
    },
    setTrackerGroup(id, groupId) {
      const t = tracker(id);
      if (!t) return;
      t.groupId = groupId && state.groups[groupId] ? groupId : null;
      t.order = nextOrder(state.trackers);
      commit();
    },
    setArchived(id, archived) {
      const t = tracker(id);
      if (!t) return;
      t.archived = !!archived;
      if (archived) t.priority = false;
      commit();
    },
    deleteTracker(id) {
      if (!tracker(id)) return;
      delete state.trackers[id];
      delete state.timers[id];
      for (const dateKey of Object.keys(state.days)) {
        delete state.days[dateKey][id];
        if (!Object.keys(state.days[dateKey]).length) delete state.days[dateKey];
      }
      commit();
    },
    // Swap with the neighbor in the given displayed sibling list. `field`
    // is 'order' (position in group) or 'pinOrder' (position in the pinned
    // strip) so the two lists reorder independently.
    reorderTracker(id, dir, siblings, field = 'order') {
      const idx = siblings.findIndex((t) => t.id === id);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= siblings.length) return false;
      siblings.forEach((t, i) => { state.trackers[t.id][field] = i; });
      const a = state.trackers[siblings[idx].id];
      const b = state.trackers[siblings[j].id];
      [a[field], b[field]] = [b[field], a[field]];
      commit();
      return true;
    },

    // -- groups --
    addGroup(fields) {
      const g = normalizeGroup(
        { ...fields, id: genId('g'), order: nextOrder(state.groups) },
        Object.keys(state.groups).length
      );
      state.groups[g.id] = g;
      commit();
      return g.id;
    },
    updateGroup(id, patch) {
      const cur = state.groups[id];
      if (!cur) return;
      const next = normalizeGroup({ ...cur, ...patch, id }, 0);
      next.order = cur.order;
      state.groups[id] = next;
      commit();
    },
    deleteGroup(id) {
      if (!state.groups[id]) return;
      delete state.groups[id];
      for (const t of Object.values(state.trackers)) {
        if (t.groupId === id) t.groupId = null;
      }
      commit();
    },
    toggleGroupCollapsed(id) {
      const g = state.groups[id];
      if (!g) return;
      g.collapsed = !g.collapsed;
      commit();
    },
    reorderGroup(id, dir, sorted) {
      const idx = sorted.findIndex((g) => g.id === id);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= sorted.length) return false;
      // Only swap within the same priority band; the star always wins.
      if (!!sorted[idx].priority !== !!sorted[j].priority) return false;
      sorted.forEach((g, i) => { state.groups[g.id].order = i; });
      const a = state.groups[sorted[idx].id];
      const b = state.groups[sorted[j].id];
      [a.order, b.order] = [b.order, a.order];
      commit();
      return true;
    },

    // -- logging --
    logSet(tid, dateKey, amount, tMs = Date.now()) {
      const t = tracker(tid);
      if (!t || t.type !== 'counter') return;
      const a = roundAmount(t, Number(amount));
      if (!isFinite(a) || a === 0) return;
      const entry = dayEntry(dateKey, tid, true);
      entry.sets.push({ a, t: tMs });
      entry.total = recomputeTotal(t, entry.sets);
      cleanupDay(dateKey, tid);
      commit();
    },
    removeSet(tid, dateKey, index) {
      const t = tracker(tid);
      const entry = dayEntry(dateKey, tid);
      if (!t || !entry || !entry.sets || index < 0 || index >= entry.sets.length) return;
      entry.sets.splice(index, 1);
      entry.total = recomputeTotal(t, entry.sets);
      cleanupDay(dateKey, tid);
      commit();
    },
    // Remove the most recently logged set that day; returns it (or null).
    undoLastSet(tid, dateKey) {
      const t = tracker(tid);
      const entry = dayEntry(dateKey, tid);
      if (!t || !entry || !entry.sets || !entry.sets.length) return null;
      let idx = 0;
      for (let i = 1; i < entry.sets.length; i++) {
        if (entry.sets[i].t >= entry.sets[idx].t) idx = i;
      }
      const [removed] = entry.sets.splice(idx, 1);
      entry.total = recomputeTotal(t, entry.sets);
      cleanupDay(dateKey, tid);
      commit();
      return removed;
    },
    // Set the day's total directly by appending a correction set.
    setDayTotal(tid, dateKey, newTotal, tMs = Date.now()) {
      const t = tracker(tid);
      if (!t || t.type !== 'counter') return;
      const target = Math.max(0, roundAmount(t, Number(newTotal) || 0));
      const entry = dayEntry(dateKey, tid, true);
      if (target === 0) {
        // Zeroing a day clears its activity rather than stacking corrections.
        entry.sets = [];
      } else {
        const delta = roundAmount(t, target - entry.total);
        if (delta !== 0) entry.sets.push({ a: delta, t: tMs });
      }
      entry.total = recomputeTotal(t, entry.sets);
      if (entry.total !== target) {
        // History contained stray negatives; consolidate to the asked-for total.
        entry.sets = [{ a: target, t: tMs }];
        entry.total = recomputeTotal(t, entry.sets);
      }
      cleanupDay(dateKey, tid);
      commit();
    },
    // Tap semantics: each tap adds one check; a tap on a completed day clears
    // it (the natural generalization of toggling a once-a-day habit).
    // Returns whether the day is now hit.
    toggleHabit(tid, dateKey, force) {
      const t = tracker(tid);
      if (!t || t.type !== 'habit') return;
      const entry = dayEntry(dateKey, tid, true);
      const per = Math.max(1, t.perDay || 1);
      const cur = entry.count || 0;
      let next;
      if (force != null) next = force ? per : 0;
      else next = cur >= per ? 0 : cur + 1;
      if (next > 0) entry.count = next; else delete entry.count;
      delete entry.done;
      cleanupDay(dateKey, tid);
      commit();
      const now = state.days[dateKey] && state.days[dateKey][tid];
      return isHit(t, now, dateKey);
    },
    // Set a habit day's check count directly (day editor stepper).
    setHabitCount(tid, dateKey, count) {
      const t = tracker(tid);
      if (!t || t.type !== 'habit') return;
      const entry = dayEntry(dateKey, tid, true);
      const v = Math.max(0, Math.round(Number(count) || 0));
      if (v > 0) entry.count = v; else delete entry.count;
      delete entry.done;
      cleanupDay(dateKey, tid);
      commit();
    },
    // Live timer for a time counter. Only one runs per tracker at a time;
    // the tracker id maps straight to a start timestamp, so it needs no
    // interval anywhere — closing the app, locking the phone, or a service
    // worker restart can't lose it, only clearing storage can. When the
    // tracker has Pomodoro mode on, this also kicks off its first work
    // phase — one Start button covers both the plain and Pomodoro cases.
    startTimer(tid) {
      const t = tracker(tid);
      if (!t || t.type !== 'counter' || !t.time || state.timers[tid]) return;
      state.timers[tid] = { startedAt: Date.now() };
      if (t.pomodoro && t.pomodoro.enabled) {
        t.pomodoro.phase = 'work';
        t.pomodoro.phaseEndTimestamp = Date.now() + t.pomodoro.workMins * 60000;
        t.pomodoro.cyclesCompleted = 0;
        t.pomodoro.paused = false;
        t.pomodoro.pausedRemainingMs = null;
        t.pomodoro.workAccumMs = 0;
      }
      commit();
    },
    // Stops a running timer and logs the elapsed minutes against dateKey
    // (today, unless the caller is closing out a session that ran past
    // midnight). Returns the minutes logged, or null if none was running.
    // A Pomodoro session logs work-only time (pomodoroWorkElapsedMs) — the
    // whole point of phases is that breaks don't count toward the total.
    stopTimer(tid, dateKey = todayKey()) {
      const running = state.timers[tid];
      if (!running) return null;
      delete state.timers[tid];
      const t = tracker(tid);
      let mins;
      if (t && t.pomodoro && t.pomodoro.phase) {
        mins = Math.round(pomodoroWorkElapsedMs(t.pomodoro) / 60000);
        clearPomodoroSession(t);
      } else {
        mins = Math.round((Date.now() - running.startedAt) / 60000);
      }
      if (t && mins > 0) {
        const entry = dayEntry(dateKey, tid, true);
        entry.sets.push({ a: mins, t: Date.now() });
        entry.total = recomputeTotal(t, entry.sets);
        cleanupDay(dateKey, tid);
      }
      commit();
      return mins;
    },
    // Discards a running timer without logging anything (started by mistake).
    cancelTimer(tid) {
      if (!state.timers[tid]) return;
      delete state.timers[tid];
      const t = tracker(tid);
      if (t && t.pomodoro) clearPomodoroSession(t);
      commit();
    },
    // Ends the current phase early — see skipPomodoro's own comment for
    // what happens to partial work-phase progress.
    skipPomodoroPhase(tid) {
      const t = tracker(tid);
      if (!t || !t.pomodoro || !t.pomodoro.phase) return;
      t.pomodoro = skipPomodoro(t.pomodoro);
      commit();
    },
    pausePomodoroPhase(tid) {
      const t = tracker(tid);
      if (!t || !t.pomodoro || !t.pomodoro.phase || t.pomodoro.paused) return;
      t.pomodoro.pausedRemainingMs = Math.max(0, t.pomodoro.phaseEndTimestamp - Date.now());
      t.pomodoro.paused = true;
      commit();
    },
    resumePomodoroPhase(tid) {
      const t = tracker(tid);
      if (!t || !t.pomodoro || !t.pomodoro.paused) return;
      t.pomodoro.phaseEndTimestamp = Date.now() + (t.pomodoro.pausedRemainingMs || 0);
      t.pomodoro.paused = false;
      t.pomodoro.pausedRemainingMs = null;
      commit();
    },
    // Catches up any Pomodoro phase(s) that elapsed while the app wasn't
    // running the interval that normally repaints the countdown (screen
    // locked, tab backgrounded, or just not loaded yet) — called on load
    // and on visibilitychange becoming visible. Returns the trackers whose
    // phase just changed (each with its now-current phase), so the caller
    // can fire one notification per tracker; a no-op run touches nothing
    // and never commits.
    checkPomodoroPhases() {
      const changed = [];
      for (const t of Object.values(state.trackers)) {
        if (!t.pomodoro || !t.pomodoro.phase || t.pomodoro.paused) continue;
        const { pomodoro, transitions } = advancePomodoro(t.pomodoro);
        if (transitions.length) {
          t.pomodoro = pomodoro;
          changed.push({ tracker: t, phase: transitions[transitions.length - 1] });
        }
      }
      if (changed.length) commit();
      return changed;
    },
    setGoalOverride(tid, dateKey, value) {
      const t = tracker(tid);
      if (!t) return;
      const entry = dayEntry(dateKey, tid, true);
      if (value == null || !isFinite(Number(value)) || Number(value) < 0) {
        delete entry.goalOverride;
      } else {
        entry.goalOverride = roundAmount(t, Number(value));
      }
      cleanupDay(dateKey, tid);
      commit();
    },

    // -- backup --
    exportJSON() {
      return JSON.stringify(state, null, 1);
    },
    markBackedUp(dateKey = todayKey()) {
      state.meta.lastBackup = dateKey;
      commit();
    },
    setNutritionHidden(hidden) {
      state.meta.nutritionHidden = !!hidden;
      commit();
    },
    setClassesHidden(hidden) {
      state.meta.classesHidden = !!hidden;
      commit();
    },

    // -- classes --
    addClass(fields) {
      const c = normalizeClass(
        { ...fields, id: genId('c'), order: nextOrder(state.classes) },
        Object.keys(state.classes).length
      );
      state.classes[c.id] = c;
      commit();
      return c.id;
    },
    updateClass(id, patch) {
      const cur = state.classes[id];
      if (!cur) return;
      const next = normalizeClass({ ...cur, ...patch, id }, 0);
      next.order = cur.order;
      state.classes[id] = next;
      commit();
    },
    deleteClass(id) {
      if (!state.classes[id]) return;
      delete state.classes[id];
      for (const dateKey of Object.keys(state.classDays)) {
        delete state.classDays[dateKey][id];
        if (!Object.keys(state.classDays[dateKey]).length) delete state.classDays[dateKey];
      }
      commit();
    },
    // Toggles today-or-any-day attendance. When the class links to a time
    // counter, this is also the one place that logs to it: marking done
    // appends +durationMins as a set on the linked tracker (dateKey, so a
    // retro toggle logs against that day, not today); un-marking appends
    // the matching negative — an additive correction, the same idiom
    // logSet's own undo/minus-stepper use, rather than tracking which
    // exact set to remove. Returns the class's new done state.
    toggleClassDone(classId, dateKey, now = Date.now()) {
      const c = state.classes[classId];
      if (!c) return;
      const day = state.classDays[dateKey] || (state.classDays[dateKey] = {});
      const nowDone = !(day[classId] && day[classId].done);
      if (nowDone) day[classId] = { done: true }; else delete day[classId];
      if (!Object.keys(day).length) delete state.classDays[dateKey];

      const linked = c.linkedTrackerId && tracker(c.linkedTrackerId);
      if (linked && linked.type === 'counter' && linked.time) {
        const entry = dayEntry(dateKey, linked.id, true);
        const tMs = stampFor(dateKey, entry, now);
        const amount = roundAmount(linked, nowDone ? c.durationMins : -c.durationMins);
        entry.sets.push({ a: amount, t: tMs });
        entry.total = recomputeTotal(linked, entry.sets);
        cleanupDay(dateKey, linked.id);
      }
      commit();
      return nowDone;
    },
    replaceAll(data) {
      state = normalizeState(data);
      commit();
    },
  };

  load();
  return api;
}
