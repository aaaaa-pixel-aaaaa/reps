// State + persistence. A single normalized state object lives in
// localStorage under one key; every mutation goes through commit() which
// re-normalizes touched entries, saves, and notifies subscribers.

import { todayKey, isValidKey, addDays, parseKey } from './dates.js';
import { roundAmount } from './model.js';

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
  };
  if (type === 'counter') {
    t.unit = str(raw.unit, '').slice(0, 20);
    t.dec = !!raw.dec;
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
  }
  return t;
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
    if (raw.done) entry.done = true;
    return entry.done || entry.goalOverride != null ? entry : null;
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
  const state = { schema: SCHEMA, trackers: {}, groups: {}, days: {}, meta: {} };

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

  const metaSrc = src.meta && typeof src.meta === 'object' ? src.meta : {};
  state.meta = {
    lastBackup: isValidKey(metaSrc.lastBackup) ? metaSrc.lastBackup : null,
    createdAt: isValidKey(metaSrc.createdAt) ? metaSrc.createdAt : todayKey(),
  };
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
    summary: { trackers, groups: Object.keys(data.groups).length, days: dayCount, sets },
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
    groupId: 'g_mind', order: 5, createdAt: start,
  };
  raw.trackers.t_water = {
    id: 't_water', name: 'Water', color: '#FFB454', type: 'counter',
    order: 6, unit: 'glasses', target: { base: 8 }, chips: [1, 2], createdAt: start,
  };

  const days = {};
  const put = (key, tid, entry) => {
    (days[key] = days[key] || {})[tid] = entry;
  };
  const noonOf = (key, i) => new Date(...key.split('-').map(Number).map((v, j) => (j === 1 ? v - 1 : v))).getTime() + (12 * 3600 + i * 900) * 1000;
  const counterDay = (key, tid, amounts) => {
    const sets = amounts.map((a, i) => ({ a, t: noonOf(key, i) }));
    put(key, tid, { sets, total: 0 });
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
    if (rand() < 0.65) put(key, 't_meditate', { done: true });
  }
  raw.days = days;
  raw.meta = { createdAt: start, lastBackup: addDays(today, -12) };
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

  function commit() {
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
        (t.type === 'habit' ? !!entry.done : (entry.sets || []).length > 0);
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
    toggleHabit(tid, dateKey, force) {
      const t = tracker(tid);
      if (!t || t.type !== 'habit') return;
      const entry = dayEntry(dateKey, tid, true);
      entry.done = force != null ? !!force : !entry.done;
      if (!entry.done) delete entry.done;
      cleanupDay(dateKey, tid);
      commit();
      return !!(state.days[dateKey] && state.days[dateKey][tid] && state.days[dateKey][tid].done);
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
    replaceAll(data) {
      state = normalizeState(data);
      commit();
    },
  };

  load();
  return api;
}
