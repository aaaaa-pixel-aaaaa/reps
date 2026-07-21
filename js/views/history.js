// Per-tracker history: Monday-start month calendar coloured by day status,
// all-time stats, and a chronological day log. Every cell opens the retro
// day editor.

import {
  todayKey, monthOf, addMonths, cmpMonth, monthGrid, monthLabel,
  shortDate, timeOf, WEEKDAYS_MIN, mondayOf, addWeeks, weekLabel,
  firstOfMonth, lastOfMonth, addDays,
} from '../dates.js';
import {
  entryFor, effectiveTarget, isHit, dayStatus, trackerStats, firstDayKey,
  fmtAmount, habitCount, habitTarget, hitIntensity, rangeStats,
} from '../model.js';
import { h, icon, accentStyle, haptic, ringSVG } from '../ui.js';
import { openDayEditor } from './day-editor.js';
import { openLogSheet } from './log-sheet.js';
import { openTrackerOptions, segmented } from './editors.js';

// UI state that must survive re-renders (any store change re-renders the view)
const monthMemo = new Map();   // trackerId -> {y, m}
const logLimit = new Map();    // trackerId -> rows shown
const viewMemo = new Map();    // trackerId -> 'day' | 'week' | 'month'
const periodLimit = new Map(); // `${trackerId}:${kind}` -> rows shown

export function renderHistory(root, store, trackerId) {
  const t = store.state.trackers[trackerId];
  const today = todayKey();
  if (!t) { location.hash = ''; return; }

  const days = store.state.days;
  const stats = trackerStats(t, days, today);
  const nowMonth = monthOf(today);
  let cur = monthMemo.get(trackerId) || nowMonth;
  if (cmpMonth(cur, nowMonth) > 0) cur = nowMonth;
  const mode = viewMemo.get(trackerId) || 'day';

  root.append(h('div', { style: accentStyle(t.color) },
    header(store, t),
    hero(store, t, today, stats),
    statsGrid(t, stats),
    viewToggle(store, t, mode),
    mode === 'day'
      ? h('div', {}, calendar(store, t, cur, today), dayLog(store, t, today))
      : periodList(store, t, mode, today),
  ));
}

// Re-renders the whole history view in place — same pattern the calendar
// nav and "show more" buttons already use, since nothing here is driven by
// a store change.
function rerender(store, trackerId) {
  const view = document.getElementById('view');
  view.replaceChildren();
  renderHistory(view, store, trackerId);
}

function viewToggle(store, t, mode) {
  return h('div', { class: 'hist-viewtoggle' },
    segmented([
      { value: 'day', label: 'Daily' },
      { value: 'week', label: 'Weekly' },
      { value: 'month', label: 'Monthly' },
    ], mode, (v) => { viewMemo.set(t.id, v); rerender(store, t.id); }));
}

// Weekly/monthly roll-up: most recent period first, each row opens onto the
// daily calendar for that period so the two views stay one tap apart.
function periodList(store, t, kind, today) {
  const days = store.state.days;
  const first = firstDayKey(t, days) || today;
  const memoKey = `${t.id}:${kind}`;
  const limit = periodLimit.get(memoKey) || 12;

  const starts = [];
  if (kind === 'week') {
    const floor = mondayOf(first);
    for (let m = mondayOf(today); m >= floor; m = addWeeks(m, -1)) starts.push(m);
  } else {
    const floor = monthOf(first);
    for (let m = monthOf(today); cmpMonth(m, floor) >= 0; m = addMonths(m, -1)) starts.push(m);
  }

  if (!starts.length) {
    return h('div', {},
      h('div', { class: 'sect-title' }, kind === 'week' ? 'Weekly totals' : 'Monthly totals'),
      h('div', { class: 'empty-note', style: 'padding:20px' }, 'Nothing logged yet.'));
  }

  const shown = starts.slice(0, limit).map((start) => {
    const isWeek = kind === 'week';
    const label = isWeek ? weekLabel(start, today) : monthLabel(start);
    const fromKey = isWeek ? start : firstOfMonth(start);
    const toKey = isWeek ? addDays(start, 6) : lastOfMonth(start);
    const stat = rangeStats(t, days, fromKey, toKey, today);
    const ratio = stat.elapsedDays > 0 ? stat.hitDays / stat.elapsedDays : 0;
    const cls = stat.elapsedDays === 0 ? '' : ratio >= 1 ? 'full' : ratio > 0 ? 'part' : 'none';

    const mainVal = t.type === 'counter'
      ? `${fmtAmount(t, stat.total)}${t.unit ? ' ' + t.unit : ''}`
      : `${stat.hitDays}/${stat.elapsedDays}`;
    const sub = t.type === 'counter'
      ? `${stat.hitDays} of ${stat.elapsedDays} day${stat.elapsedDays === 1 ? '' : 's'} hit goal`
      : ((t.perDay || 1) > 1 ? `${stat.checks} check${stat.checks === 1 ? '' : 's'} total` : `${stat.hitDays} day${stat.hitDays === 1 ? '' : 's'} done`);

    return h('button', {
      class: `prow ${cls}`,
      onclick: () => {
        viewMemo.set(t.id, 'day');
        monthMemo.set(t.id, isWeek ? monthOf(start) : start);
        haptic(6);
        rerender(store, t.id);
      },
    },
      h('div', {},
        h('div', { class: 'prow-label' }, label),
        h('div', { class: 'prow-sub' }, sub)),
      h('div', { class: 'prow-val num' }, mainVal));
  });

  const more = starts.length > limit
    ? h('button', {
        class: 'btn btn-ghost show-more',
        onclick: () => { periodLimit.set(memoKey, limit + 12); rerender(store, t.id); },
      }, `Show ${Math.min(12, starts.length - limit)} more`)
    : null;

  return h('div', {},
    h('div', { class: 'sect-title' }, kind === 'week' ? 'Weekly totals' : 'Monthly totals'),
    h('div', { class: 'plist' }, shown, more));
}

function header(store, t) {
  return h('div', { class: 'hist-top' },
    h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => { location.hash = ''; } }, icon('chevL')),
    h('div', { class: 'view-title' }, h('span', { class: 'tdot' }), h('span', {}, t.name)),
    h('button', { class: 'icon-btn', 'aria-label': 'Options', onclick: () => openTrackerOptions(store, t.id) }, icon('dots')),
  );
}

function hero(store, t, today, stats) {
  const entry = entryFor(store.state.days, today, t.id);
  const done = isHit(t, entry, today);
  let leftEl;
  let line1;
  if (t.type === 'counter') {
    const target = effectiveTarget(t, today, entry);
    const total = entry ? entry.total || 0 : 0;
    const prog = target > 0 ? Math.min(1, total / target) : (total > 0 ? 1 : 0);
    const ring = ringSVG(88, 8, prog);
    leftEl = h('div', { class: `ringbox ${done ? 'done' : ''}` }, ring,
      h('div', { class: 'ring-label' },
        h('div', { class: 'ring-val num' }, fmtAmount(t, total))));
    line1 = target > 0
      ? `${fmtAmount(t, total)} / ${fmtAmount(t, target)}${t.unit ? ' ' + t.unit : ''} today`
      : `${fmtAmount(t, total)}${t.unit ? ' ' + t.unit : ''} today`;
  } else {
    const count = habitCount(entry);
    const per = habitTarget(t, entry);
    leftEl = h('button', {
      class: `habit-check ${done ? 'done' : ''} ${!done && count > 0 ? 'part' : ''}`,
      style: 'margin:0;width:88px;height:88px',
      'aria-label': per > 1 ? `${count} of ${per} today — tap to add one` : 'toggle today',
      onclick: (e) => {
        const nowDone = store.toggleHabit(t.id, todayKey());
        haptic(nowDone ? [12, 50, 16] : 8);
      },
    }, done || per <= 1 ? icon('check') : h('span', { class: 'hc-count num' }, `${count}/${per}`));
    line1 = done ? 'Done today ✓' : (per > 1 ? `${count} of ${per} today` : 'Not done yet today');
  }
  const totalLine = t.type === 'counter'
    ? `${fmtAmount(t, stats.total)}${t.unit ? ' ' + t.unit : ''} all-time`
    : `${stats.doneDays} day${stats.doneDays === 1 ? '' : 's'} done all-time`;

  return h('div', { class: 'hero', role: t.type === 'counter' ? 'button' : undefined,
    onclick: t.type === 'counter' ? () => openLogSheet(store, t.id) : undefined },
    leftEl,
    h('div', { class: 'hero-info' },
      h('div', { class: 'hero-line1 num' }, line1),
      h('div', { class: 'hero-line2 num' }, totalLine),
      h('div', { class: 'hero-streaks' },
        h('span', { class: `streak num ${stats.currentStreak > 0 ? 'hot' : ''}` },
          `\u{1F525} ${stats.currentStreak}`),
        h('span', { class: 'streak num' }, `best ${stats.longestStreak}`),
      )),
  );
}

function statsGrid(t, stats) {
  const cell = (val, label, sub) => h('div', { class: 'stat' },
    h('b', { class: 'num' }, val, sub ? h('small', {}, ` ${sub}`) : null),
    h('span', {}, label));
  const cells = [];
  if (t.type === 'counter') {
    cells.push(
      cell(fmtAmount(t, stats.total), 'total all-time', t.unit),
      cell(String(stats.sessions), 'sets logged'),
      cell(String(stats.goalsHit), 'goals hit'),
      cell(stats.bestDay ? fmtAmount(t, stats.bestDay.total) : '–',
        stats.bestDay ? `best day · ${shortDate(stats.bestDay.key)}` : 'best day', stats.bestDay ? t.unit : ''),
      cell(stats.sessions ? fmtAmount(t, stats.avgPerSession) : '–', 'avg per set', stats.sessions ? t.unit : ''),
      cell(String(stats.longestStreak), 'longest streak', stats.longestStreak === 1 ? 'day' : 'days'),
    );
  } else {
    cells.push(
      cell(String(stats.doneDays), 'days done'),
      cell(String(stats.goalsHit), 'goals hit'),
      cell(String(stats.currentStreak), 'current streak', stats.currentStreak === 1 ? 'day' : 'days'),
      cell(String(stats.longestStreak), 'longest streak', stats.longestStreak === 1 ? 'day' : 'days'),
    );
  }
  return h('div', { class: 'stats' }, cells);
}

function calendar(store, t, cur, today) {
  const days = store.state.days;
  const nowMonth = monthOf(today);

  // No floor on how far back you can navigate — months before the tracker
  // existed just render as empty, and every cell (bar the future) still
  // opens the retro day editor, so backfilling old data works either way.
  const nav = (delta) => {
    const next = addMonths(cur, delta);
    if (cmpMonth(next, nowMonth) > 0) return;
    monthMemo.set(t.id, next);
    haptic(6);
    rebuild(next);
  };

  const box = h('div', { class: 'cal' });

  function rebuild(m) {
    cur = m;
    box.replaceChildren(
      h('div', { class: 'cal-head' },
        h('div', { class: 'cal-month' }, monthLabel(m)),
        h('div', { class: 'cal-nav' },
          h('button', {
            class: 'icon-btn', 'aria-label': 'previous month',
            onclick: () => nav(-1),
          }, icon('chevL')),
          h('button', {
            class: 'icon-btn', 'aria-label': 'next month',
            disabled: cmpMonth(m, nowMonth) >= 0, onclick: () => nav(1),
          }, icon('chevR')))),
      h('div', { class: 'cal-grid' },
        WEEKDAYS_MIN.map((d) => h('div', { class: 'cal-dow' }, d)),
        monthGrid(m.y, m.m).flat().map((key) => {
          if (!key) return h('div', {});
          const status = dayStatus(t, days, key, today);
          const entry = entryFor(days, key, t.id);
          const overridden = !!(entry && entry.goalOverride != null);
          // Cells that hit their goal get progressively more saturated the
          // further past it they landed, capping out around 3x the target.
          const boost = status === 'hit' ? hitIntensity(t, entry, key) : 0;
          const style = boost > 0
            ? `filter:saturate(${(1 + boost * 1.4).toFixed(2)}) brightness(${(1 + boost * 0.12).toFixed(2)})`
            : undefined;
          return h('button', {
            class: `cal-cell num ${status} ${key === today ? 'today' : ''}`,
            style,
            disabled: status === 'future',
            'aria-label': `${key}: ${status}${boost > 0.5 ? ', well past goal' : ''}`,
            onclick: () => openDayEditor(store, t.id, key),
          }, String(Number(key.slice(8))), overridden ? h('span', { class: 'ovr' }) : null);
        })),
      legend(t),
    );
  }
  rebuild(cur);
  return box;
}

function legend(t) {
  const item = (style, label) => h('span', {}, h('i', { style }), label);
  return h('div', { class: 'cal-legend' },
    item('background:var(--c)', t.type === 'habit' ? 'done' : 'goal hit'),
    item('background:var(--c);filter:saturate(2.4) brightness(1.12)', 'exceeded'),
    t.type === 'counter' || (t.perDay || 1) > 1 ? item('background:var(--c-25)', 'partial') : null,
    item('background:rgba(228,87,61,0.28)', 'missed'),
    item('background:transparent;border:1px solid var(--line)', 'empty'),
  );
}

function dayLog(store, t, today) {
  const days = store.state.days;
  const keys = Object.keys(days)
    .filter((k) => days[k][t.id] && k <= today)
    .sort()
    .reverse();
  if (!keys.length) {
    return h('div', {},
      h('div', { class: 'sect-title' }, 'Day log'),
      h('div', { class: 'empty-note', style: 'padding:20px' }, 'No days logged yet.'));
  }
  const limit = logLimit.get(t.id) || 30;
  const shown = keys.slice(0, limit);

  const rows = shown.map((key) => {
    const entry = days[key][t.id];
    const hit = isHit(t, entry, key);
    const overridden = entry.goalOverride != null;
    let right;
    let setPills = null;
    if (t.type === 'counter') {
      right = h('div', { class: 'dl-total num' }, fmtAmount(t, entry.total || 0),
        t.unit ? h('small', {}, ` ${t.unit}`) : null);
      const sets = (entry.sets || []).slice().sort((a, b) => a.t - b.t);
      if (sets.length) {
        setPills = h('div', { class: 'dl-sets' },
          sets.map((s) => h('span', { class: 'dl-set num' },
            `${s.a > 0 ? '+' : ''}${fmtAmount(t, s.a)} · ${timeOf(s.t)}`)));
      }
    } else {
      const count = habitCount(entry);
      const per = habitTarget(t, entry);
      right = h('div', { class: 'dl-total num' },
        hit ? (per > 1 ? `${count}/${per} ✓` : '✓') : (count > 0 ? `${count}/${per}` : '–'));
    }
    return h('button', { class: 'dl', onclick: () => openDayEditor(store, t.id, key) },
      h('div', { class: 'dl-head' },
        h('div', { class: 'dl-date num' }, shortDate(key),
          hit ? h('span', { class: 'dl-hit' }, '✓ goal') : null,
          overridden ? h('span', { style: 'color:var(--faint);margin-left:6px;font-size:12px' },
            entry.goalOverride === 0 ? 'rest day' : `goal ${fmtAmount(t, entry.goalOverride)}`) : null),
        right),
      setPills);
  });

  // "show more" re-renders the view without a store change
  const more = keys.length > limit
    ? h('button', {
        class: 'btn btn-ghost show-more',
        onclick: () => {
          logLimit.set(t.id, limit + 60);
          const view = document.getElementById('view');
          view.replaceChildren();
          renderHistory(view, store, t.id);
        },
      }, `Show ${Math.min(60, keys.length - limit)} more`)
    : null;

  return h('div', {},
    h('div', { class: 'sect-title' }, `Day log · ${keys.length} day${keys.length === 1 ? '' : 's'}`),
    h('div', { class: 'daylog' }, rows, more));
}
