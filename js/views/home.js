// Home: today's date + summary, pinned (priority) tracker cards, collapsible
// group sections, ungrouped trackers, add buttons, backup nudge.

import { todayKey, longDate, daysBetween } from '../dates.js';
import {
  entryFor, effectiveTarget, isHit, currentStreak, fmtAmount,
  habitCount, habitTarget,
  pinnedTrackers, groupTrackers, sortedGroups, todaySummary,
} from '../model.js';
import { h, icon, accentStyle, haptic, ringSVG, reducedMotion, openSheet } from '../ui.js';
import { openLogSheet } from './log-sheet.js';
import { openTrackerOptions, openTrackerEditor, openGroupEditor, openGroupOptions } from './editors.js';
import { openSettings } from './settings.js';

// Remembered ring progress + queued toggle effects so springy animations
// survive the full re-render that follows every mutation.
const lastProgress = new Map();
const pendingFx = new Set();
export function queueFx(id) { pendingFx.add(id); }

function counterProgress(t, entry, today) {
  const target = effectiveTarget(t, today, entry);
  const total = entry ? entry.total || 0 : 0;
  if (target > 0) return Math.min(1, total / target);
  return total > 0 ? 1 : 0;
}

function animatedRing(t, size, stroke, progress) {
  const prev = lastProgress.get(t.id);
  const svg = ringSVG(size, stroke, prev ?? progress);
  if (prev !== progress) {
    lastProgress.set(t.id, progress);
    requestAnimationFrame(() => requestAnimationFrame(() => svg._setProgress(progress)));
  }
  return svg;
}

function streakChip(t, days, today, onclick) {
  const n = currentStreak(t, days, today);
  return h('button', {
    class: `streak num ${n > 0 ? 'hot' : ''}`,
    'aria-label': `${n} day streak — view history`,
    onclick,
  },
    h('span', { style: n > 0 ? '' : 'filter:grayscale(1);opacity:0.45' }, '\u{1F525}'),
    ` ${n}`);
}

const goHistory = (t) => (e) => {
  e.stopPropagation();
  location.hash = `t/${t.id}`;
};

// The face of a habit circle: a check once done (or for plain once-a-day
// habits), a "2/5" progress count for multi habits in progress.
function habitFace(t, entry, done) {
  const per = habitTarget(t, entry);
  if (done || per <= 1) return icon('check');
  return h('span', { class: 'hc-count num' }, `${habitCount(entry)}/${per}`);
}

function checkButton(store, t, today, cls) {
  const entry = entryFor(store.state.days, today, t.id);
  const done = isHit(t, entry, today);
  const count = habitCount(entry);
  const per = habitTarget(t, entry);
  const justToggled = pendingFx.delete(t.id);
  const btn = h('button', {
    class: `${cls} ${done && !justToggled ? 'done' : ''} ${!done && count > 0 ? 'part' : ''}`,
    'aria-label': per > 1
      ? `${t.name}: ${count} of ${per} today — tap to add one`
      : `${t.name}: mark ${done ? 'not done' : 'done'}`,
    onclick: (e) => {
      e.stopPropagation();
      const nowDone = store.toggleHabit(t.id, today);
      queueFx(t.id);
      haptic(nowDone ? [12, 50, 16] : 8);
    },
  }, habitFace(t, entry, done));
  if (justToggled) {
    // apply final state a frame late so the check draws + pops
    requestAnimationFrame(() => {
      btn.classList.toggle('done', done);
      if (done && !reducedMotion()) {
        btn.classList.add('pop');
        btn.addEventListener('animationend', () => btn.classList.remove('pop'), { once: true });
      }
    });
  }
  return btn;
}

function counterCard(store, t, today) {
  const entry = entryFor(store.state.days, today, t.id);
  const target = effectiveTarget(t, today, entry);
  const total = entry ? entry.total || 0 : 0;
  const done = isHit(t, entry, today);
  const ring = animatedRing(t, 108, 10, counterProgress(t, entry, today));
  return h('div', {
    class: `card pressable ${done ? 'done' : ''}`,
    style: accentStyle(t.color),
    role: 'button',
    tabindex: '0',
    onclick: () => openLogSheet(store, t.id),
  },
    h('button', { class: 'dots', 'aria-label': `${t.name} options`, onclick: (e) => { e.stopPropagation(); openTrackerOptions(store, t.id, 'pinned'); } }, icon('dots')),
    h('div', { class: 'ringbox' }, ring,
      h('div', { class: 'ring-label' },
        h('div', { class: 'ring-val num' }, fmtAmount(t, total)),
        h('div', { class: 'ring-goal num' }, target > 0 ? `/ ${fmtAmount(t, target)}` : (t.unit || '')),
      )),
    h('div', { class: 'card-name' }, t.name),
    streakChip(t, store.state.days, today, goHistory(t)),
  );
}

function habitCard(store, t, today) {
  return h('div', {
    class: 'card pressable',
    style: accentStyle(t.color),
    role: 'button',
    tabindex: '0',
    onclick: goHistory(t),
  },
    h('button', { class: 'dots', 'aria-label': `${t.name} options`, onclick: (e) => { e.stopPropagation(); openTrackerOptions(store, t.id, 'pinned'); } }, icon('dots')),
    checkButton(store, t, today, 'habit-check'),
    h('div', { class: 'card-name' }, t.name),
    streakChip(t, store.state.days, today, goHistory(t)),
  );
}

function trackerRow(store, t, today) {
  const entry = entryFor(store.state.days, today, t.id);
  const done = isHit(t, entry, today);
  const lead = t.type === 'habit'
    ? checkButton(store, t, today, 'mini-check')
    : h('div', { class: 'mini-ring' }, animatedRing(t, 40, 4.5, counterProgress(t, entry, today)));
  const target = t.type === 'counter' ? effectiveTarget(t, today, entry) : 0;
  const total = entry ? entry.total || 0 : 0;
  const streak = currentStreak(t, store.state.days, today);
  return h('div', {
    class: `trow ${done ? 'done' : ''}`,
    style: accentStyle(t.color),
    role: 'button',
    tabindex: '0',
    onclick: () => (t.type === 'counter' ? openLogSheet(store, t.id) : (location.hash = `t/${t.id}`)),
  },
    lead,
    h('div', { class: 'trow-main' },
      h('div', { class: 'trow-name' }, t.name,
        t.priority ? h('span', { class: 'trow-star', 'aria-label': 'pinned' }, icon('starFill')) : null),
      h('div', { class: 'trow-sub num' },
        streak > 0 ? `\u{1F525} ${streak} day${streak === 1 ? '' : 's'}`
          : (t.type === 'habit'
              ? (habitTarget(t, entry) > 1 ? `${habitCount(entry)} of ${habitTarget(t, entry)} today` : 'tap circle to check off')
              : (t.time ? 'minutes' : (t.unit || 'counter'))),
      )),
    t.type === 'counter'
      ? h('div', { class: 'trow-val num' }, fmtAmount(t, total), target > 0 ? h('small', {}, ` / ${fmtAmount(t, target)}`) : null)
      : null,
    h('button', { class: 'dots', 'aria-label': `${t.name} options`, onclick: (e) => { e.stopPropagation(); openTrackerOptions(store, t.id, 'group'); } }, icon('dots')),
  );
}

function groupSection(store, g, today) {
  const members = groupTrackers(store.state, g.id);
  return h('section', { class: `group ${g.collapsed ? 'collapsed' : ''}`, style: accentStyle(g.color) },
    h('div', {
      class: 'group-head',
      role: 'button',
      tabindex: '0',
      'aria-expanded': String(!g.collapsed),
      onclick: () => store.toggleGroupCollapsed(g.id),
    },
      h('span', { class: 'group-dot' }),
      h('span', { class: 'group-name' }, g.name),
      g.priority ? h('span', { class: 'star' }, icon('starFill')) : null,
      h('span', { class: 'group-count num' }, String(members.length)),
      h('button', { class: 'icon-btn dots', style: 'width:38px;height:38px', 'aria-label': `${g.name} options`, onclick: (e) => { e.stopPropagation(); openGroupOptions(store, g.id); } }, icon('dots')),
      h('span', { class: 'group-chev' }, icon('chevD')),
    ),
    g.collapsed ? null : h('div', { class: 'group-body' },
      members.length
        ? members.map((t) => trackerRow(store, t, today))
        : h('div', { class: 'empty-note', style: 'padding:14px;font-size:13.5px' },
            'No trackers yet — add one from below'),
    ),
  );
}

function backupNudge(store, today) {
  const { meta, days } = store.state;
  const logged = Object.keys(days).length;
  if (!logged) return null;
  let text = null;
  if (!meta.lastBackup) {
    if (logged >= 5) text = 'No backup yet — save one to keep your history safe';
  } else {
    const age = daysBetween(meta.lastBackup, today);
    if (age > 7) text = `Last backup ${age} days ago — worth saving a fresh one`;
  }
  if (!text) return null;
  return h('button', { class: 'nudge pressable', onclick: () => openSettings(store) },
    icon('download'), h('span', {}, text));
}

export function renderHome(root, store, { demo } = {}) {
  const state = store.state;
  const today = todayKey();
  const { goals, hit } = todaySummary(state, today);

  root.append(h('header', { class: 'top' },
    h('div', {},
      h('div', { class: 'top-date' }, longDate(today)),
      h('div', { class: 'top-sub' },
        demo ? h('span', { style: 'color:#E8C268;font-weight:700' }, 'demo data · ') : null,
        goals
          ? [h('span', { class: 'hitcount num' }, `${hit} of ${goals}`), ' goals hit today']
          : 'add a tracker to get started'),
    ),
    h('div', { class: 'top-actions' },
      h('button', { class: 'icon-btn', 'aria-label': 'New tracker or group', onclick: () => openAddSheet(store) }, icon('plus')),
      h('button', { class: 'icon-btn', 'aria-label': 'Settings & backup', onclick: () => openSettings(store) }, icon('gear')),
    ),
  ));

  const nudge = backupNudge(store, today);
  if (nudge) root.append(nudge);

  const pinned = pinnedTrackers(state);
  if (pinned.length) {
    root.append(h('div', { class: 'cards' },
      pinned.map((t) => (t.type === 'counter' ? counterCard(store, t, today) : habitCard(store, t, today)))));
  }

  for (const g of sortedGroups(state)) root.append(groupSection(store, g, today));

  const ungrouped = groupTrackers(state, null);
  if (ungrouped.length) {
    root.append(h('section', { class: 'group' },
      h('div', { class: 'group-head', style: 'pointer-events:none' },
        h('span', { class: 'group-name', style: 'color:var(--dim)' }, 'Ungrouped'),
        h('span', { class: 'group-count num' }, String(ungrouped.length))),
      h('div', { class: 'group-body' }, ungrouped.map((t) => trackerRow(store, t, today))),
    ));
  }

  const anyTracker = Object.values(state.trackers).some((t) => !t.archived);
  if (!anyTracker && !Object.keys(state.groups).length) {
    root.append(h('div', { class: 'empty-note' },
      h('b', {}, 'Nothing here yet'),
      'Create your first tracker — reps, kilometres, glasses of water, or a simple daily habit.'));
  }

  root.append(h('div', { class: 'add-row' },
    h('button', { class: 'add-btn', onclick: () => openTrackerEditor(store) }, icon('plus'), 'New tracker'),
    h('button', { class: 'add-btn', onclick: () => openGroupEditor(store) }, icon('folder'), 'New group'),
  ));
}

function openAddSheet(store) {
  openSheet({
    title: 'Add',
    build(body, api) {
      body.append(h('div', { class: 'opt-list' },
        h('button', { class: 'opt', onclick: () => { api.close(); openTrackerEditor(store); } },
          icon('plus'), h('span', { class: 'grow' }, 'New tracker'), h('span', { class: 'opt-note' }, 'counter or habit')),
        h('button', { class: 'opt', onclick: () => { api.close(); openGroupEditor(store); } },
          icon('folder'), h('span', { class: 'grow' }, 'New group'), h('span', { class: 'opt-note' }, 'organise trackers')),
      ));
    },
  });
}
