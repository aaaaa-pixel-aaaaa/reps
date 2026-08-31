// University classes: a home-screen timetable tile (today's classes, tap to
// mark attended), a management sheet, a create/edit sheet, and a per-class
// history page with a month calendar of attended/missed days — the same
// shape as a tracker's own history page, since a class's attendance is
// fundamentally a habit that only obligates you on some days of the week.
// A class can also be a one-off "event" (no weekday set, just a single
// date) — everything else about it works identically, since classOccursOn
// is the only place that distinction is resolved.

import {
  todayKey, monthOf, addMonths, cmpMonth, monthGrid, monthLabel, shortDate,
  WEEKDAYS, WEEKDAYS_MIN, isValidKey, addDays,
} from '../dates.js';
import { fmtMinutes } from '../model.js';
import {
  fmtTime12, addMinutesToTime, classEndTime, classTimeRange, classOccursOn,
  isClassDone, classesForDay, classesOccurringOn, dayAttendance, todayClassSummary,
  classDayStatus, nextOccurrence, classStats, allClassesStats,
} from '../classes.js';
import { PALETTE } from '../store.js';
import { h, icon, accentStyle, rgba, haptic, openSheet, closeAllSheets, confirmSheet, toast } from '../ui.js';
import { field, switchRow, swatchPicker, segmented, escapeHtml } from './editors.js';

// ---- home tile ----

// `onNavigate`, if given, runs right before the hash change — the day-detail
// sheet passes its own api.close so jumping to a class's history doesn't
// leave the sheet floating over the page it navigated to; the home tile
// (not inside a sheet) has nothing to pass.
function classRow(store, c, dateKey, onNavigate) {
  const done = isClassDone(store.state.classDays, dateKey, c.id);
  const linked = c.linkedTrackerId && store.state.trackers[c.linkedTrackerId];
  const subBits = [`${fmtTime12(c.startTime)}–${fmtTime12(classEndTime(c))}`];
  if (c.location) subBits.push(c.location);

  return h('div', {
    class: 'class-row', style: accentStyle(c.color),
    role: 'button', tabindex: '0',
    'aria-label': `${c.name}, ${subBits.join(', ')} — view history`,
    onclick: () => { onNavigate && onNavigate(); location.hash = `classes/${c.id}`; },
  },
    h('button', {
      class: `mini-check ${done ? 'done' : ''}`,
      'aria-label': `${c.name}: mark ${done ? 'not done' : 'done'}`,
      onclick: (e) => {
        e.stopPropagation();
        const nowDone = store.toggleClassDone(c.id, dateKey);
        haptic(nowDone ? [12, 50, 16] : 8);
        if (nowDone && linked) toast(`+${fmtMinutes(c.durationMins)} added to ${linked.name}`);
      },
    }, icon('check')),
    h('div', { class: 'trow-main' },
      h('div', { class: 'trow-name' }, c.name),
      h('div', { class: 'trow-sub' }, subBits.join(' · '),
        linked ? h('span', { class: 'class-linked' }, ` · +${fmtMinutes(c.durationMins)} → ${linked.name}`) : null)),
  );
}

export function renderClassesTile(store) {
  const { classes, classDays } = store.state;
  const today = todayKey();
  const list = classesForDay(classes, today);
  const anyClasses = Object.keys(classes).length > 0;
  const { total, done } = todayClassSummary(classes, classDays, today);

  const sub = !anyClasses ? 'Add your timetable to get started'
    : total === 0 ? 'Nothing scheduled today'
    : `${done} of ${total} done today`;

  const body = !anyClasses
    ? h('button', { class: 'add-btn', style: 'margin-top:2px', onclick: () => openClassEditor(store) },
        icon('plus'), 'Add a class')
    : total === 0
      ? null
      : h('div', { class: 'class-list' }, list.map((c) => classRow(store, c, today)));

  return h('div', { class: 'card classes-card' },
    h('button', {
      class: 'cal-btn', 'aria-label': 'All classes history',
      onclick: (e) => { e.stopPropagation(); location.hash = 'classes'; },
    }, icon('cal')),
    h('button', {
      class: 'dots', 'aria-label': 'Classes options',
      onclick: (e) => { e.stopPropagation(); openClassesOptions(store); },
    }, icon('dots')),
    h('div', { class: 'classes-head' },
      h('div', { class: 'classes-title' }, 'Classes'),
      h('div', { class: 'classes-sub' }, sub)),
    body,
  );
}

// ---- manage sheet (list + add + hide) ----

function classDaysLabel(c) {
  if (c.date) return `Once · ${shortDate(c.date)}`;
  return c.days.length === 7 ? 'Every day' : c.days.map((d) => WEEKDAYS_MIN[d]).join('');
}

function classOptRow(store, c, onChange) {
  return h('button', { class: 'opt', onclick: () => openClassOptions(store, c.id, onChange) },
    h('span', { class: 'group-dot', style: `background:${c.color}` }),
    h('span', { class: 'grow' },
      h('div', {}, c.name),
      h('div', { class: 'opt-note', style: 'margin-top:2px' }, `${classDaysLabel(c)} · ${fmtTime12(c.startTime)}`)));
}

export function openClassesOptions(store) {
  openSheet({
    title: 'Classes',
    build(body) {
      function rebuild() {
        const all = Object.values(store.state.classes).sort((a, b) =>
          (a.days[0] ?? 7) - (b.days[0] ?? 7) || a.startTime.localeCompare(b.startTime) || a.name.localeCompare(b.name));
        const active = all.filter((c) => !c.archived);
        const archived = all.filter((c) => c.archived);

        const sections = [
          h('div', { class: 'opt-list' }, [
            h('button', {
              class: 'opt',
              onclick: () => { closeAllSheets(); location.hash = 'classes'; },
            }, icon('cal'), h('span', { class: 'grow' }, 'All classes history')),
            h('button', { class: 'opt', onclick: () => openClassEditor(store, null, rebuild) },
              icon('plus'), h('span', { class: 'grow' }, 'New class or event')),
            ...active.map((c) => classOptRow(store, c, rebuild)),
          ]),
        ];
        if (!active.length) {
          sections.push(h('div', { class: 'empty-note', style: 'padding:14px;font-size:13.5px' },
            'No classes yet — add your timetable above.'));
        }
        if (archived.length) {
          sections.push(
            h('div', { class: 'sheet-section' }, 'Archived'),
            h('div', { class: 'opt-list' }, archived.map((c) => classOptRow(store, c, rebuild))));
        }
        sections.push(
          h('hr', { class: 'divider' }),
          h('button', {
            class: 'opt danger',
            onclick: () => {
              store.setClassesHidden(true);
              haptic(10);
              toast('Classes card hidden — add it back from New tracker');
            },
          }, icon('trash'), h('span', { class: 'grow' }, 'Hide card')),
        );
        body.replaceChildren(...sections);
      }
      rebuild();
    },
  });
}

// ---- per-class options ----

// `onChange`, if given, is called after a mutation so a list sheet further
// up the stack (the manage sheet above, or none at all from the history
// page) can refresh itself — this sheet closes rather than re-rendering in
// place, so it can't do that refresh itself.
export function openClassOptions(store, classId, onChange) {
  const c = store.state.classes[classId];
  if (!c) return;

  openSheet({
    title: c.name,
    accent: c.color,
    build(body, api) {
      const opt = (ic, label, onclick, opts = {}) =>
        h('button', { class: `opt ${opts.danger ? 'danger' : ''}`, onclick },
          icon(ic), h('span', { class: 'grow' }, label));

      body.append(h('div', { class: 'opt-list' },
        // closeAllSheets, not api.close: this sheet is commonly reached
        // through the manage sheet (dots -> Classes -> a class row), which
        // would otherwise stay open, floating over the history page this
        // navigates to.
        opt('cal', 'History & attendance', () => { closeAllSheets(); location.hash = `classes/${classId}`; }),
        opt('pencil', 'Edit', () => { api.close(); openClassEditor(store, classId, onChange); }),
        opt(c.archived ? 'archive' : 'archive', c.archived ? 'Restore' : 'Archive', () => {
          const cur = store.state.classes[classId];
          store.updateClass(classId, { archived: !cur.archived });
          haptic(10);
          api.close();
          onChange && onChange();
          toast(store.state.classes[classId].archived ? 'Archived' : 'Restored');
        }),
        opt('trash', 'Delete…', async () => {
          const daysLogged = Object.values(store.state.classDays).filter((d) => d[classId]).length;
          api.close();
          const yes = await confirmSheet({
            title: `Delete ${c.name}?`,
            accent: c.color,
            danger: true,
            confirmLabel: 'Delete forever',
            message: `This permanently deletes <b>${escapeHtml(c.name)}</b>` +
              (daysLogged ? ` and its <b>${daysLogged} day${daysLogged === 1 ? '' : 's'}</b> of attendance.` : '.') +
              ' There is no undo.',
          });
          if (yes) {
            store.deleteClass(classId);
            toast(`${c.name} deleted`);
            onChange && onChange();
            if (location.hash.replace(/^#\/?/, '') === `classes/${classId}`) location.hash = '';
          }
        }, { danger: true }),
      ));
    },
  });
}

// ---- create/edit sheet ----

export function openClassEditor(store, classId = null, onSaved = null) {
  const existing = classId ? store.state.classes[classId] : null;
  const f = existing
    ? JSON.parse(JSON.stringify(existing))
    : {
        name: '', color: PALETTE[Object.keys(store.state.classes).length % PALETTE.length],
        days: [], date: null, startTime: '09:00', durationMins: 60, location: '',
        linkedTrackerId: null, startDate: null, endDate: null,
      };

  const timeCounters = Object.values(store.state.trackers).filter((t) => t.type === 'counter' && t.time);

  openSheet({
    title: existing ? `Edit ${existing.name}` : 'New class',
    accent: f.color,
    build(body, api) {
      const nameInput = h('input', { class: 'input', type: 'text', maxlength: '60', placeholder: 'e.g. Data Structures' });
      nameInput.value = f.name;
      nameInput.addEventListener('input', () => { f.name = nameInput.value; });

      const timeHint = h('div', { class: 'hint', style: 'margin-top:-6px' });
      const updateTimeHint = () => {
        timeHint.textContent = `${fmtTime12(f.startTime)} – ${fmtTime12(addMinutesToTime(f.startTime, f.durationMins))}`;
      };

      const startInput = h('input', { class: 'input num', type: 'time' });
      startInput.value = f.startTime;
      startInput.addEventListener('input', () => {
        if (startInput.value) f.startTime = startInput.value;
        updateTimeHint();
      });

      const durInput = h('input', { class: 'input num', type: 'number', min: '5', step: '5', inputmode: 'numeric' });
      durInput.value = f.durationMins;
      durInput.addEventListener('input', () => {
        f.durationMins = Math.max(5, Math.round(parseFloat(durInput.value)) || f.durationMins);
        updateTimeHint();
      });
      updateTimeHint();

      const locInput = h('input', { class: 'input', type: 'text', maxlength: '60', placeholder: 'e.g. Building 4, Rm 12' });
      locInput.value = f.location || '';
      locInput.addEventListener('input', () => { f.location = locInput.value; });

      const linkSelect = h('select', { class: 'input' },
        h('option', { value: '' }, 'Not linked'),
        timeCounters.map((t) => h('option', { value: t.id, selected: f.linkedTrackerId === t.id }, t.name)));
      linkSelect.value = f.linkedTrackerId || '';
      linkSelect.addEventListener('change', () => { f.linkedTrackerId = linkSelect.value || null; });

      const rangeBox = h('div', {});
      function renderRange() {
        const on = !!(f.startDate || f.endDate);
        let rangeFields = null;
        if (on) {
          const startD = h('input', { class: 'input num', type: 'date' });
          const endD = h('input', { class: 'input num', type: 'date' });
          startD.value = f.startDate || todayKey();
          endD.value = f.endDate || todayKey();
          startD.addEventListener('input', () => { if (isValidKey(startD.value)) f.startDate = startD.value; });
          endD.addEventListener('input', () => { if (isValidKey(endD.value)) f.endDate = endD.value; });
          rangeFields = h('div', { class: 'field-row' }, field('starts', startD), field('ends', endD));
        }
        rangeBox.replaceChildren(...[
          switchRow('Limit to a date range', 'e.g. one semester — leave off to repeat every week', on, (checked) => {
            if (checked) { f.startDate = f.startDate || todayKey(); f.endDate = f.endDate || todayKey(); }
            else { f.startDate = null; f.endDate = null; }
            renderRange();
          }),
          rangeFields,
        ].filter(Boolean));
      }

      // Repeats every week (a weekday picker, plus the optional semester
      // range above) or just once (a single date) — an event is simply a
      // class with `date` set instead of `days`, so everything else about
      // it (time, duration, location, linking, colour, history) is shared.
      const scheduleBox = h('div', {});
      function renderSchedule() {
        const once = !!f.date;
        const repeatsToggle = field('repeats', segmented([
          { value: 'weekly', label: 'Every week' },
          { value: 'once', label: 'Just once' },
        ], once ? 'once' : 'weekly', (v) => {
          if (v === 'once') { f.date = f.date || todayKey(); f.days = []; f.startDate = null; f.endDate = null; }
          else { f.date = null; }
          renderSchedule();
        }));

        if (once) {
          const dateInput = h('input', { class: 'input num', type: 'date' });
          dateInput.value = f.date;
          dateInput.addEventListener('input', () => { if (isValidKey(dateInput.value)) f.date = dateInput.value; });
          scheduleBox.replaceChildren(repeatsToggle, field('date', dateInput));
          return;
        }
        const dayBtns = WEEKDAYS_MIN.map((label, i) => h('button', {
          class: `dp-btn ${f.days.includes(i) ? 'on' : ''}`,
          type: 'button',
          'aria-pressed': String(f.days.includes(i)),
          'aria-label': WEEKDAYS[i],
          onclick: (e) => {
            f.days = f.days.includes(i) ? f.days.filter((d) => d !== i) : [...f.days, i].sort((x, y) => x - y);
            e.currentTarget.classList.toggle('on');
            e.currentTarget.setAttribute('aria-pressed', String(f.days.includes(i)));
            haptic(6);
          },
        }, label));
        scheduleBox.replaceChildren(
          repeatsToggle,
          field('days', h('div', { class: 'daypicker' }, dayBtns), 'tap every day it meets'),
          rangeBox,
        );
        renderRange();
      }
      renderSchedule();

      body.append(...[
        field('name', nameInput),
        field('colour', swatchPicker(f.color, (c) => { f.color = c; api.setAccent(c); })),
        scheduleBox,
        h('div', { class: 'field-row' },
          field('starts', startInput),
          field('duration (min)', durInput)),
        timeHint,
        field('location', locInput, 'optional'),
        field('link to a timer', linkSelect,
          timeCounters.length
            ? 'Marking this class done also logs its duration to the linked tracker; un-marking reverses it.'
            : 'Create a time-based counter first (measures: Time) to link a class to it.'),
        h('button', {
          class: 'btn btn-accent',
          style: 'margin-top:8px',
          onclick: () => {
            if (!f.name.trim()) { toast('Give it a name first'); return; }
            if (!f.date && !f.days.length) { toast('Pick at least one day'); return; }
            if (existing) {
              store.updateClass(classId, f);
              toast('Saved');
            } else {
              store.addClass(f);
              toast(`${f.name.trim()} added`);
            }
            haptic(14);
            api.close();
            onSaved && onSaved();
          },
        }, existing ? 'Save changes' : 'Create class'),
      ]);
      if (!existing) setTimeout(() => nameInput.focus(), 350);
    },
  });
}

// ---- per-class history page ----

const monthMemo = new Map(); // classId -> {y, m}

function classHistoryHeader(store, c) {
  return h('div', { class: 'hist-top' },
    h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => { location.hash = ''; } }, icon('chevL')),
    h('div', { class: 'view-title' }, h('span', { class: 'tdot' }), h('span', {}, c.name)),
    h('button', { class: 'icon-btn', 'aria-label': 'Options', onclick: () => openClassOptions(store, c.id) }, icon('dots')));
}

function classHero(store, c, today, stats) {
  const occursToday = classOccursOn(c, today);
  const done = isClassDone(store.state.classDays, today, c.id);
  const linked = c.linkedTrackerId && store.state.trackers[c.linkedTrackerId];

  let leftEl;
  let line1;
  if (occursToday) {
    leftEl = h('button', {
      class: `habit-check ${done ? 'done' : ''}`,
      style: 'margin:0;width:88px;height:88px',
      'aria-label': `mark ${done ? 'not done' : 'done'}`,
      onclick: () => {
        const nowDone = store.toggleClassDone(c.id, today);
        haptic(nowDone ? [12, 50, 16] : 8);
      },
    }, icon('check'));
    line1 = done ? 'Done today ✓' : 'Not done yet today';
  } else {
    const next = nextOccurrence(c, addDays(today, 1));
    leftEl = h('div', {
      class: 'habit-check', style: 'margin:0;width:88px;height:88px;color:var(--faint);pointer-events:none',
    }, icon('clock'));
    line1 = next ? `Next: ${shortDate(next)}`
      : c.date ? `Was on ${shortDate(c.date)}`
      : 'No upcoming classes';
  }
  const schedLine = `${classDaysLabel(c)} · ${classTimeRange(c)}${c.location ? ' · ' + c.location : ''}`;

  return h('div', { class: 'hero' },
    leftEl,
    h('div', { class: 'hero-info' },
      h('div', { class: 'hero-line1 num' }, line1),
      h('div', { class: 'hero-line2 num' }, schedLine),
      linked ? h('div', { class: 'hero-line2 num class-linked' }, `↳ +${fmtMinutes(c.durationMins)} → ${linked.name}`) : null,
      h('div', { class: 'hero-streaks' },
        h('span', { class: `streak num ${stats.currentStreak > 0 ? 'hot' : ''}` }, `\u{1F525} ${stats.currentStreak}`),
        h('span', { class: 'streak num' }, `best ${stats.longestStreak}`))));
}

function classStatsGrid(stats) {
  const cell = (val, label) => h('div', { class: 'stat' }, h('b', { class: 'num' }, val), h('span', {}, label));
  const rate = stats.scheduled > 0 ? `${Math.round((stats.attended / stats.scheduled) * 100)}%` : '–';
  return h('div', { class: 'stats' },
    cell(String(stats.attended), 'attended'),
    cell(String(stats.scheduled), 'scheduled'),
    cell(rate, 'attendance'),
    cell(String(stats.longestStreak), 'longest streak'));
}

function classCalendarLegend() {
  const item = (style, label) => h('span', {}, h('i', { style }), label);
  return h('div', { class: 'cal-legend' },
    item('background:var(--c)', 'attended'),
    item('background:rgba(228,87,61,0.28)', 'missed'),
    item('background:transparent;border:1px solid var(--line)', 'no class'));
}

function classCalendar(store, c, cur, today) {
  const nowMonth = monthOf(today);

  const nav = (delta) => {
    const next = addMonths(cur, delta);
    if (cmpMonth(next, nowMonth) > 0) return;
    monthMemo.set(c.id, next);
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
          h('button', { class: 'icon-btn', 'aria-label': 'previous month', onclick: () => nav(-1) }, icon('chevL')),
          h('button', {
            class: 'icon-btn', 'aria-label': 'next month',
            disabled: cmpMonth(m, nowMonth) >= 0, onclick: () => nav(1),
          }, icon('chevR')))),
      h('div', { class: 'cal-grid' },
        WEEKDAYS_MIN.map((d) => h('div', { class: 'cal-dow' }, d)),
        monthGrid(m.y, m.m).flat().map((key) => {
          if (!key) return h('div', {});
          const status = classDayStatus(c, store.state.classDays, key, today);
          const clickable = status === 'hit' || status === 'miss' || status === 'pending';
          return h('button', {
            class: `cal-cell num ${status} ${key === today ? 'today' : ''}`,
            disabled: !clickable,
            'aria-label': `${key}: ${status}`,
            onclick: () => { store.toggleClassDone(c.id, key); haptic(8); },
          }, String(Number(key.slice(8))));
        })),
      classCalendarLegend(),
    );
  }
  rebuild(cur);
  return box;
}

export function renderClassesHistory(root, store, classId) {
  const c = store.state.classes[classId];
  const today = todayKey();
  if (!c) { location.hash = ''; return; }

  const stats = classStats(c, store.state.classDays, today);
  const nowMonth = monthOf(today);
  let cur = monthMemo.get(classId) || nowMonth;
  if (cmpMonth(cur, nowMonth) > 0) cur = nowMonth;

  root.append(h('div', { style: accentStyle(c.color) },
    classHistoryHeader(store, c),
    classHero(store, c, today, stats),
    classStatsGrid(stats),
    classCalendar(store, c, cur, today),
  ));
}

// ---- all-classes overview: one calendar across every class at once ----

// No single class's colour fits an aggregate view, so this page uses a
// fixed accent (the palette's first, also the root default) rather than
// scoping to any one class.
const OVERVIEW_ACCENT = PALETTE[0];

// A day's fill: alpha alone carries how complete it was — a day where a
// class was missed doesn't switch to a warning colour, it just recedes
// (lower alpha, i.e. literally a darker shade of the same hue), while a
// fully-attended day comes in strong. Mirrors history.js's own loadColor
// for weekly/monthly tracker views, one level up (per-day instead of
// per-week), with a non-zero floor so "scheduled but missed entirely"
// still reads as a coloured (if dim) day rather than empty/no-class.
function attendanceColor(ratio) {
  return rgba(OVERVIEW_ACCENT, 0.16 + ratio * 0.74);
}

function overviewHeader(store) {
  return h('div', { class: 'hist-top' },
    h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => { location.hash = ''; } }, icon('chevL')),
    h('div', { class: 'view-title' }, h('span', { class: 'tdot' }), h('span', {}, 'All classes')),
    h('button', { class: 'icon-btn', 'aria-label': 'Manage classes', onclick: () => openClassesOptions(store) }, icon('dots')));
}

function overviewStatsGrid(stats) {
  const cell = (val, label, sub) => h('div', { class: 'stat' },
    h('b', { class: 'num' }, val, sub ? h('small', {}, ` ${sub}`) : null),
    h('span', {}, label));
  const rate = stats.scheduled > 0 ? `${Math.round((stats.attended / stats.scheduled) * 100)}%` : '–';
  return h('div', { class: 'stats' },
    cell(String(stats.attended), 'attended'),
    cell(String(stats.scheduled), 'scheduled'),
    cell(rate, 'attendance'),
    cell(String(stats.currentStreak), 'day streak', stats.currentStreak === 1 ? 'perfect day' : 'perfect days'),
    cell(String(stats.longestStreak), 'best streak', stats.longestStreak === 1 ? 'perfect day' : 'perfect days'));
}

function overviewCalendarLegend() {
  const item = (style, label) => h('span', {}, h('i', { style }), label);
  return h('div', { class: 'cal-legend' },
    item(`background:${attendanceColor(1)}`, 'fully attended'),
    item(`background:${attendanceColor(0)}`, 'missed (darker = fewer attended)'),
    item('background:transparent;border:1px solid var(--line)', 'no class'));
}

// Tapping a day opens every class scheduled on it with its own check —
// useful when a day carries more than one class, since the calendar cell
// itself can only show one blended colour, not each class's own state.
function openDayClassesSheet(store, dateKey) {
  let unsub = null;
  openSheet({
    title: shortDate(dateKey),
    accent: OVERVIEW_ACCENT,
    onClose: () => { unsub && unsub(); },
    build(body, api) {
      function rebuild() {
        const list = classesOccurringOn(store.state.classes, dateKey);
        body.replaceChildren(
          list.length
            ? h('div', { class: 'class-list' }, list.map((c) => classRow(store, c, dateKey, api.close)))
            : h('div', { class: 'empty-note', style: 'padding:20px' }, 'No classes that day.'));
      }
      rebuild();
      unsub = store.subscribe(rebuild);
    },
  });
}

let overviewMonth = null; // remembered month across re-renders, like nutrition's own history page

function overviewCalendar(store, cur, today) {
  const nowMonth = monthOf(today);

  const nav = (delta) => {
    const next = addMonths(cur, delta);
    if (cmpMonth(next, nowMonth) > 0) return;
    overviewMonth = next;
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
          h('button', { class: 'icon-btn', 'aria-label': 'previous month', onclick: () => nav(-1) }, icon('chevL')),
          h('button', {
            class: 'icon-btn', 'aria-label': 'next month',
            disabled: cmpMonth(m, nowMonth) >= 0, onclick: () => nav(1),
          }, icon('chevR')))),
      h('div', { class: 'cal-grid' },
        WEEKDAYS_MIN.map((d) => h('div', { class: 'cal-dow' }, d)),
        monthGrid(m.y, m.m).flat().map((key) => {
          if (!key) return h('div', {});
          const isToday = key === today;
          if (key > today) {
            return h('button', { class: 'cal-cell num future', disabled: true }, String(Number(key.slice(8))));
          }
          const { scheduled, attended, ratio } = dayAttendance(store.state.classes, store.state.classDays, key);
          if (!scheduled) {
            return h('button', {
              class: `cal-cell num empty ${isToday ? 'today' : ''}`, disabled: true,
            }, String(Number(key.slice(8))));
          }
          if (isToday && attended === 0) {
            return h('button', {
              class: 'cal-cell num pending today',
              'aria-label': `${key}: nothing marked yet, ${scheduled} scheduled`,
              onclick: () => openDayClassesSheet(store, key),
            }, String(Number(key.slice(8))));
          }
          return h('button', {
            class: `cal-cell num ${isToday ? 'today' : ''} ${ratio >= 0.95 ? 'attend-full' : ''}`,
            style: `background:${attendanceColor(ratio)}`,
            'aria-label': `${key}: ${attended} of ${scheduled} attended`,
            onclick: () => openDayClassesSheet(store, key),
          }, String(Number(key.slice(8))));
        })),
      overviewCalendarLegend(),
    );
  }
  rebuild(cur);
  return box;
}

export function renderClassesOverview(root, store) {
  const today = todayKey();
  const stats = allClassesStats(store.state.classes, store.state.classDays, today);
  const nowMonth = monthOf(today);
  let cur = overviewMonth || nowMonth;
  if (cmpMonth(cur, nowMonth) > 0) cur = nowMonth;

  if (!Object.keys(store.state.classes).length) {
    root.append(h('div', { style: accentStyle(OVERVIEW_ACCENT) },
      overviewHeader(store),
      h('div', { class: 'empty-note' },
        h('b', {}, 'No classes yet'),
        'Add your timetable from the Classes card on Home.')));
    return;
  }

  root.append(h('div', { style: accentStyle(OVERVIEW_ACCENT) },
    overviewHeader(store),
    overviewStatsGrid(stats),
    overviewCalendar(store, cur, today),
  ));
}
