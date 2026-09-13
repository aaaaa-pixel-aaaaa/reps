// University classes: a home-screen timetable tile (today's classes, tap to
// mark attended), a management sheet, a create/edit sheet, and a per-class
// history page with a month calendar of attended/missed days — the same
// shape as a tracker's own history page, since a class's attendance is
// fundamentally a habit that only obligates you on some days of the week.
// A class can also be a one-off "event" (no weekday set, just a single
// date) — everything else about it works identically, since classOccursOn
// is the only place that distinction is resolved.

import {
  todayKey, monthOf, addMonths, cmpMonth, monthGrid, monthLabel, shortDate, longDate,
  WEEKDAYS, WEEKDAYS_MIN, isValidKey, addDays, addWeeks, daysBetween, mondayOf, weekLabel, weekdayIndex,
} from '../dates.js';
import { fmtMinutes } from '../model.js';
import {
  fmtTime12, addMinutesToTime, classTimeRange, classTimeForDay, classTimeFor,
  classOccursOn, isClassDone, classesForDay, classesOccurringOn, dayAttendance, todayClassSummary,
  classDayStatus, nextOccurrence, classStats, allClassesStats,
  upcomingExams, examCountdown, EXAM_REMINDER_PRESETS, isOneWeekOnly,
  timeToMinutes, hourLabel12, timeGridRange, layoutTimeBlocks,
} from '../classes.js';
import { PALETTE } from '../store.js';
import { h, icon, accentStyle, rgba, haptic, openSheet, closeAllSheets, confirmSheet, toast } from '../ui.js';
import { field, switchRow, swatchPicker, segmented, escapeHtml } from './editors.js';
import { requestExamPermission, examNotificationsSupported } from '../exam-notify.js';

// ---- home tile ----

// `onNavigate`, if given, runs right before the hash change — the day-detail
// sheet passes its own api.close so jumping to a class's history doesn't
// leave the sheet floating over the page it navigated to; the home tile
// (not inside a sheet) has nothing to pass.
function classRow(store, c, dateKey, onNavigate) {
  const done = isClassDone(store.state.classDays, dateKey, c.id);
  const linked = c.linkedTrackerId && store.state.trackers[c.linkedTrackerId];
  const { startTime, durationMins } = classTimeFor(c, dateKey);
  const subBits = [`${fmtTime12(startTime)}–${fmtTime12(addMinutesToTime(startTime, durationMins))}`];
  if (c.location) subBits.push(c.location);
  // Only an exam ever reaches this row for a date still ahead — the
  // overview calendar's future cells are otherwise unclickable — and
  // there's nothing to mark yet, same as classHero's own treatment of a
  // class that hasn't happened today.
  const upcoming = dateKey > todayKey();

  return h('div', {
    class: `class-row ${c.isExam ? 'exam' : ''}`, style: accentStyle(c.color),
    role: 'button', tabindex: '0',
    'aria-label': `${c.name}, ${subBits.join(', ')}${c.isExam ? ', exam' : ''} — view history`,
    onclick: () => { onNavigate && onNavigate(); location.hash = `classes/${c.id}`; },
  },
    upcoming
      ? h('div', { class: 'mini-check', style: 'color:var(--faint);pointer-events:none' }, icon('clock'))
      : h('button', {
          class: `mini-check ${done ? 'done' : ''}`,
          'aria-label': `${c.name}: mark ${done ? 'not done' : 'done'}`,
          onclick: (e) => {
            e.stopPropagation();
            const nowDone = store.toggleClassDone(c.id, dateKey);
            haptic(nowDone ? [12, 50, 16] : 8);
            if (nowDone && linked) toast(`+${fmtMinutes(durationMins)} added to ${linked.name}`);
          },
        }, icon('check')),
    h('div', { class: 'trow-main' },
      h('div', { class: 'trow-name' }, c.name),
      h('div', { class: 'trow-sub' }, subBits.join(' · '),
        linked ? h('span', { class: 'class-linked' }, ` · +${fmtMinutes(durationMins)} → ${linked.name}`) : null)),
  );
}

// An upcoming exam's own row — brighter than a plain class row (its own
// accent, boosted by the same .exam glow classRow above uses on exam day)
// and, since there's nothing to check off days ahead of time, a countdown
// in place of the mini-check.
function examUpcomingRow(c, today) {
  return h('div', {
    class: 'class-row exam', style: accentStyle(c.color),
    role: 'button', tabindex: '0',
    'aria-label': `${c.name}, exam ${examCountdown(daysBetween(today, c.date))} — view details`,
    onclick: () => { location.hash = `classes/${c.id}`; },
  },
    h('div', { class: 'exam-dot', 'aria-hidden': 'true' }, icon('bell')),
    h('div', { class: 'trow-main' },
      h('div', { class: 'trow-name' }, c.name),
      h('div', { class: 'trow-sub' }, `${shortDate(c.date, today)} · ${classTimeRange(c)}`)),
    h('div', { class: 'exam-countdown' }, examCountdown(daysBetween(today, c.date))),
  );
}

export function renderClassesTile(store) {
  const { classes, classDays } = store.state;
  const today = todayKey();
  const list = classesForDay(classes, today);
  const anyClasses = Object.keys(classes).length > 0;
  const { total, done } = todayClassSummary(classes, classDays, today);
  // Strictly future — today's own exam already shows (glowing) in the
  // today list above, via the same classesForDay/classRow every other
  // class goes through, so it isn't repeated here.
  const laterExams = upcomingExams(classes, today).filter((c) => c.date > today).slice(0, 3);

  const nextExam = laterExams[0];
  const sub = !anyClasses ? 'Add your timetable to get started'
    : total > 0 ? `${done} of ${total} done today`
    : nextExam ? `${nextExam.name} ${examCountdown(daysBetween(today, nextExam.date))}`
    : 'Nothing scheduled today';

  const todayList = total === 0 ? null : h('div', { class: 'class-list' }, list.map((c) => classRow(store, c, today)));
  const examList = laterExams.length
    ? h('div', { class: 'class-list', style: todayList ? 'margin-top:2px' : '' }, laterExams.map((c) => examUpcomingRow(c, today)))
    : null;

  const body = !anyClasses
    ? h('button', { class: 'add-btn', style: 'margin-top:2px', onclick: () => openClassEditor(store) },
        icon('plus'), 'Add a class')
    : (todayList || examList) ? h('div', {}, [todayList, examList].filter(Boolean)) : null;

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
  if (c.date) return `${c.isExam ? 'Exam' : 'Once'} · ${shortDate(c.date)}`;
  if (isOneWeekOnly(c)) return `One week · ${weekLabel(c.startDate)}`;
  return c.days.length === 7 ? 'Every day' : c.days.map((d) => WEEKDAYS_MIN[d]).join('');
}

function dayRangeLabel(c, dayIndex) {
  const t = classTimeForDay(c, dayIndex);
  return `${fmtTime12(t.startTime)}–${fmtTime12(addMinutesToTime(t.startTime, t.durationMins))}`;
}

function offWeeksNote(c) {
  const n = c.offWeeks ? c.offWeeks.length : 0;
  return n ? ` · ${n} week${n === 1 ? '' : 's'} off` : '';
}

// A class's overall schedule as one line, for anywhere it's described
// independent of any specific date (the manage sheet's row note, a class's
// own history hero). A `perDayTimes` class spells out each day's own
// range rather than a single shared one, since a shared range would be
// wrong for at least one of its days — a one-week-only schedule is always
// exactly this shape (see isOneWeekOnly, js/classes.js), just with its
// one week named up front instead of an off-weeks note at the end.
function classScheduleSummary(c) {
  if (c.date) return `${c.isExam ? 'Exam' : 'Once'} · ${shortDate(c.date)} · ${classTimeRange(c)}`;
  if (isOneWeekOnly(c)) {
    return `${weekLabel(c.startDate)} · ` + c.days.map((d) => `${WEEKDAYS_MIN[d]} ${dayRangeLabel(c, d)}`).join(', ');
  }
  if (!c.perDayTimes) return `${classDaysLabel(c)} · ${classTimeRange(c)}${offWeeksNote(c)}`;
  return c.days.map((d) => `${WEEKDAYS_MIN[d]} ${dayRangeLabel(c, d)}`).join(', ') + offWeeksNote(c);
}

function classOptRow(store, c, onChange) {
  return h('button', { class: `opt ${c.isExam ? 'exam' : ''}`, onclick: () => openClassOptions(store, c.id, onChange) },
    c.isExam ? h('span', { class: 'exam-dot', style: accentStyle(c.color) }, icon('bell'))
      : h('span', { class: 'group-dot', style: `background:${c.color}` }),
    h('span', { class: 'grow' },
      h('div', {}, c.name),
      h('div', { class: 'opt-note', style: 'margin-top:2px' }, classScheduleSummary(c))));
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
        days: [], date: null, startTime: '09:00', durationMins: 60, perDayTimes: null, location: '',
        linkedTrackerId: null, startDate: null, endDate: null, offWeeks: [],
        isExam: false, reminders: [], notifiedReminders: [],
      };

  const timeCounters = Object.values(store.state.trackers).filter((t) => t.type === 'counter' && t.time);

  openSheet({
    title: existing ? `Edit ${existing.name}` : 'New class',
    accent: f.color,
    build(body, api) {
      const nameInput = h('input', { class: 'input', type: 'text', maxlength: '60', placeholder: 'e.g. Data Structures' });
      nameInput.value = f.name;
      nameInput.addEventListener('input', () => { f.name = nameInput.value; });

      // The shared "same time every day" fields — used for a one-off event
      // (its only occurrence) and for a recurring class with no per-day
      // overrides. When per-day times are on, these are hidden entirely in
      // favour of one row per selected day, so there's never a question of
      // which value actually wins.
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
      const sharedTimeFields = h('div', {},
        h('div', { class: 'field-row' }, field('starts', startInput), field('duration (min)', durInput)),
        timeHint);

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

      // Off weeks: specific weeks this recurring class doesn't meet — a
      // semester break, a public holiday — on top of its normal weekly
      // days. Picking any date snaps to that date's own Monday
      // (mondayOf), since a week is the unit skipped, not a single day;
      // classOccursOn then treats the whole week as if the class simply
      // didn't exist that week, everywhere (calendar, stats, streaks).
      const offWeeksBox = h('div', {});
      function renderOffWeeks() {
        const weeks = f.offWeeks || [];
        const rows = weeks.map((wk) => h('div', { class: 'offweek-row' },
          h('span', {}, weekLabel(wk)),
          h('button', {
            class: 'offweek-remove', type: 'button', 'aria-label': `Remove ${weekLabel(wk)} as an off week`,
            onclick: () => {
              f.offWeeks = f.offWeeks.filter((w) => w !== wk);
              haptic(6);
              renderOffWeeks();
            },
          }, icon('x'))));

        const addDate = h('input', { class: 'input num', type: 'date', style: 'flex:1' });
        addDate.value = todayKey();
        const addBtn = h('button', {
          class: 'btn btn-ghost offweek-add', type: 'button',
          onclick: () => {
            if (!isValidKey(addDate.value)) return;
            const wk = mondayOf(addDate.value);
            if (!f.offWeeks.includes(wk)) { f.offWeeks = [...f.offWeeks, wk].sort(); haptic(8); }
            renderOffWeeks();
          },
        }, icon('plus'), 'Add');

        offWeeksBox.replaceChildren(field('off weeks', h('div', {},
          rows.length ? h('div', { class: 'offweek-list' }, rows) : null,
          h('div', { class: 'offweek-form' }, addDate, addBtn),
        ), 'pick any date in a week to skip it entirely'));
      }

      // One compact row per selected day — a day label, a time, a duration
      // — shown only once "different time each day" is switched on, and
      // only offered at all once there's more than one day to differ.
      function perDayRow(dayIndex) {
        const entry = f.perDayTimes[dayIndex] || (f.perDayTimes[dayIndex] = { startTime: f.startTime, durationMins: f.durationMins });
        const t = h('input', { class: 'input num', type: 'time' });
        t.value = entry.startTime;
        t.addEventListener('input', () => { if (t.value) entry.startTime = t.value; });
        const d = h('input', { class: 'input num', type: 'number', min: '5', step: '5', inputmode: 'numeric' });
        d.value = entry.durationMins;
        d.addEventListener('input', () => {
          entry.durationMins = Math.max(5, Math.round(parseFloat(d.value)) || entry.durationMins);
        });
        return h('div', { class: 'perday-row' },
          h('span', { class: 'perday-day' }, WEEKDAYS_MIN[dayIndex]), t, d);
      }

      // Repeats every week (a weekday picker, plus the optional semester
      // range and per-day time overrides above) or just once (a single
      // date) — an event is simply a class with `date` set instead of
      // `days`, so everything else about it (time, duration, location,
      // linking, colour, history) is shared.
      const scheduleBox = h('div', {});
      function renderSchedule() {
        const once = !!f.date;
        const oneWeek = !once && isOneWeekOnly(f);
        const mode = once ? 'once' : oneWeek ? 'week' : 'weekly';
        const repeatsToggle = field('repeats', segmented([
          { value: 'weekly', label: 'Every week' },
          { value: 'week', label: 'One week' },
          { value: 'once', label: 'Just once' },
        ], mode, (v) => {
          if (v === 'once') {
            f.date = f.date || todayKey();
            f.days = []; f.perDayTimes = null; f.startDate = null; f.endDate = null; f.offWeeks = [];
          } else if (v === 'week') {
            f.date = null; f.isExam = false; f.reminders = []; f.notifiedReminders = []; f.offWeeks = [];
            // Snap to the week already set (if it was already exactly one
            // week) or the current week otherwise — never left blank, so
            // there's always a real week to show days/times against.
            const monday = f.startDate && f.startDate === mondayOf(f.startDate) ? f.startDate : mondayOf(todayKey());
            f.startDate = monday;
            f.endDate = addDays(monday, 6);
            f.perDayTimes = f.perDayTimes || {};
            for (const day of f.days) f.perDayTimes[day] = f.perDayTimes[day] || { startTime: f.startTime, durationMins: f.durationMins };
          } else {
            // Every week: startDate/endDate/perDayTimes are left exactly
            // as they are — this mode's own "limit to a date range" and
            // "different time each day" switches already expose and can
            // clear them, so a class arriving from "one week" simply shows
            // up as a recurring class already scoped to that one week,
            // which is both correct and easy to broaden from here.
            f.date = null; f.isExam = false; f.reminders = []; f.notifiedReminders = [];
          }
          renderSchedule();
        }));

        if (once) {
          const dateInput = h('input', { class: 'input num', type: 'date' });
          dateInput.value = f.date;
          dateInput.addEventListener('input', () => { if (isValidKey(dateInput.value)) f.date = dateInput.value; });

          // Reminders reuse a preset menu of day-offsets rather than a free
          // number, and only mean anything once "This is an exam" is on —
          // this box rebuilds itself independent of the schedule box above
          // so toggling a reminder chip doesn't need to re-render the whole
          // date/time section around it.
          const examBox = h('div', {});
          function renderExamBox() {
            const on = !!f.isExam;
            const chips = on ? h('div', { class: 'chip-row' },
              EXAM_REMINDER_PRESETS.map(({ days, label }) => h('button', {
                class: `chip-btn ${f.reminders.includes(days) ? 'on' : ''}`,
                type: 'button',
                onclick: () => {
                  f.reminders = f.reminders.includes(days)
                    ? f.reminders.filter((d) => d !== days)
                    : [...f.reminders, days];
                  haptic(6);
                  renderExamBox();
                },
              }, label))) : null;
            examBox.replaceChildren(
              switchRow('This is an exam', 'brighter on the calendar, with reminder notifications', on, (checked) => {
                f.isExam = checked;
                // Same rule Pomodoro's own permission request follows: must
                // run inside this click handler, never on load, since iOS
                // only honours the prompt as a direct result of a gesture.
                if (checked) { f.reminders = f.reminders.length ? f.reminders : [1, 7]; requestExamPermission(); }
                renderExamBox();
              }),
              on ? field('remind me', chips,
                examNotificationsSupported() ? null
                  : 'Notifications aren’t supported here — reminders will still show brighter on the calendar.') : null,
            );
          }
          renderExamBox();

          scheduleBox.replaceChildren(repeatsToggle, field('date', dateInput), sharedTimeFields, examBox);
          return;
        }

        // "One week": a one-off schedule spread across several days of a
        // single specific week, each on its own time — a temp roster
        // (Mon 9-11, Tue 3-5, Thu 4-5), a one-off makeup-class week, and
        // so on. Under the hood it's an ordinary recurring class (`days` +
        // `perDayTimes`) whose startDate/endDate happen to bound it to
        // exactly that Monday-Sunday week (isOneWeekOnly, js/classes.js) —
        // classOccursOn already stops it dead at endDate, so nothing else
        // needs to know this mode exists at all. Always shows one time row
        // per day (no "different time each day" toggle to find first),
        // since per-day variation is the entire point here.
        if (oneWeek) {
          const weekInput = h('input', { class: 'input num', type: 'date' });
          weekInput.value = f.startDate;
          const weekHint = h('div', { class: 'hint', style: 'margin-top:-6px' });
          const updateWeekHint = () => { weekHint.textContent = weekLabel(f.startDate); };
          updateWeekHint();
          weekInput.addEventListener('input', () => {
            if (!isValidKey(weekInput.value)) return;
            f.startDate = mondayOf(weekInput.value);
            f.endDate = addDays(f.startDate, 6);
            updateWeekHint();
          });

          const dayBtns = WEEKDAYS_MIN.map((label, i) => h('button', {
            class: `dp-btn ${f.days.includes(i) ? 'on' : ''}`,
            type: 'button',
            'aria-pressed': String(f.days.includes(i)),
            'aria-label': WEEKDAYS[i],
            onclick: () => {
              const wasOn = f.days.includes(i);
              f.days = wasOn ? f.days.filter((d) => d !== i) : [...f.days, i].sort((x, y) => x - y);
              if (wasOn) delete f.perDayTimes[i];
              else f.perDayTimes[i] = { startTime: f.startTime, durationMins: f.durationMins };
              haptic(6);
              renderSchedule();
            },
          }, label));

          scheduleBox.replaceChildren(...[
            repeatsToggle,
            field('week of', weekInput),
            weekHint,
            field('days', h('div', { class: 'daypicker' }, dayBtns), 'tap every day it happens that week'),
            f.days.length ? h('div', { class: 'perday-list' }, f.days.map((d) => perDayRow(d))) : null,
          ].filter(Boolean));
          return;
        }

        const dayBtns = WEEKDAYS_MIN.map((label, i) => h('button', {
          class: `dp-btn ${f.days.includes(i) ? 'on' : ''}`,
          type: 'button',
          'aria-pressed': String(f.days.includes(i)),
          'aria-label': WEEKDAYS[i],
          onclick: () => {
            const wasOn = f.days.includes(i);
            f.days = wasOn ? f.days.filter((d) => d !== i) : [...f.days, i].sort((x, y) => x - y);
            if (f.perDayTimes) {
              if (wasOn) delete f.perDayTimes[i];
              else f.perDayTimes[i] = { startTime: f.startTime, durationMins: f.durationMins };
              // fewer than two days left: per-day variation no longer means
              // anything, and its toggle is about to disappear from the UI
              if (f.days.length <= 1) f.perDayTimes = null;
            }
            haptic(6);
            renderSchedule();
          },
        }, label));

        const perDayOn = !!f.perDayTimes;
        const perDayToggle = f.days.length > 1 ? switchRow(
          'Different time each day', 'e.g. 9–11 Mon, 3–5 Wed', perDayOn, (checked) => {
            if (checked) {
              f.perDayTimes = {};
              for (const day of f.days) f.perDayTimes[day] = { startTime: f.startTime, durationMins: f.durationMins };
            } else {
              f.perDayTimes = null;
            }
            renderSchedule();
          },
        ) : null;

        scheduleBox.replaceChildren(...[
          repeatsToggle,
          field('days', h('div', { class: 'daypicker' }, dayBtns), 'tap every day it meets'),
          perDayToggle,
          perDayOn ? h('div', { class: 'perday-list' }, f.days.map((d) => perDayRow(d))) : sharedTimeFields,
          rangeBox,
          offWeeksBox,
        ].filter(Boolean));
        renderRange();
        renderOffWeeks();
      }
      renderSchedule();

      body.append(...[
        field('name', nameInput),
        field('colour', swatchPicker(f.color, (c) => { f.color = c; api.setAccent(c); })),
        scheduleBox,
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
  const schedLine = `${classScheduleSummary(c)}${c.location ? ' · ' + c.location : ''}`;

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

function classCalendarLegend(c) {
  const item = (style, label) => h('span', {}, h('i', { style }), label);
  return h('div', { class: 'cal-legend' },
    item('background:var(--c)', 'attended'),
    item('background:rgba(228,87,61,0.28)', 'missed'),
    item('background:transparent;border:1px solid var(--line)', 'no class'),
    c.isExam ? item('background:var(--c);box-shadow:0 0 6px 1px var(--c-70)', 'exam') : null);
}

// A class's own calendar clamps forward navigation to the current month —
// there's nothing to show ahead of today for attendance. An exam is the
// one exception: its date can sit years out, so this calendar needs to be
// pageable at least that far to actually show it.
function classCalendarMaxMonth(c, nowMonth) {
  if (!c.isExam || !c.date) return nowMonth;
  const examMonth = monthOf(c.date);
  return cmpMonth(examMonth, nowMonth) > 0 ? examMonth : nowMonth;
}

function classCalendar(store, c, cur, today) {
  const nowMonth = monthOf(today);
  const maxMonth = classCalendarMaxMonth(c, nowMonth);

  const nav = (delta) => {
    const next = addMonths(cur, delta);
    if (cmpMonth(next, maxMonth) > 0) return;
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
            disabled: cmpMonth(m, maxMonth) >= 0, onclick: () => nav(1),
          }, icon('chevR')))),
      h('div', { class: 'cal-grid' },
        WEEKDAYS_MIN.map((d) => h('div', { class: 'cal-dow' }, d)),
        monthGrid(m.y, m.m).flat().map((key) => {
          if (!key) return h('div', {});
          const status = classDayStatus(c, store.state.classDays, key, today);
          const isExamDay = c.isExam && key === c.date;
          const clickable = status === 'hit' || status === 'miss' || status === 'pending';
          return h('button', {
            class: `cal-cell num ${status} ${key === today ? 'today' : ''} ${isExamDay ? 'exam' : ''}`,
            style: isExamDay ? accentStyle(c.color) : '',
            disabled: !clickable,
            'aria-label': `${key}: ${status}${isExamDay ? ', exam' : ''}`,
            onclick: () => { store.toggleClassDone(c.id, key); haptic(8); },
          }, String(Number(key.slice(8))));
        })),
      classCalendarLegend(c),
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
  const maxMonth = classCalendarMaxMonth(c, nowMonth);
  // First visit to a future exam opens straight on its own month rather
  // than the current one — there'd be nothing else to see in between.
  const defaultMonth = c.isExam && c.date > today ? monthOf(c.date) : nowMonth;
  let cur = monthMemo.get(classId) || defaultMonth;
  if (cmpMonth(cur, maxMonth) > 0) cur = maxMonth;

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

function overviewCalendarLegend(hasExams) {
  const item = (style, label) => h('span', {}, h('i', { style }), label);
  return h('div', { class: 'cal-legend' },
    item(`background:${attendanceColor(1)}`, 'fully attended'),
    item(`background:${attendanceColor(0)}`, 'missed (darker = fewer attended)'),
    item('background:var(--c-25);box-shadow:inset 0 0 0 1.5px var(--c)', 'not done yet'),
    item('background:transparent;border:1px solid var(--line)', 'no class'),
    hasExams ? item(`background:${OVERVIEW_ACCENT};box-shadow:0 0 6px 1px ${rgba(OVERVIEW_ACCENT, 0.7)}`, 'exam') : null);
}

// Tapping a day opens every class scheduled on it with its own check —
// useful when a day carries more than one class, since a month cell can
// only show one blended colour (and a time-grid block, though it's
// already its own class, opens the same sheet for consistency: one tap
// target behaviour everywhere in this view). classRow itself already
// swaps a future day's checkbox for an inert clock icon, so opening this
// for a day that hasn't happened yet is safe — nothing here lets you
// mark tomorrow's class attended today.
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

// ---- view-mode state (module-level, survives re-renders — same idiom
// history.js's own viewMemo/monthMemo use, one level up) ----
let overviewMode = 'month'; // 'day' | 'week' | 'month'
let overviewMonth = null;   // {y, m} — month view's paged month
let overviewDay = null;     // date key — day view's shown day
let overviewWeek = null;    // Monday date key — week view's shown week

function rerenderOverview(store) {
  const view = document.getElementById('view');
  view.replaceChildren();
  renderClassesOverview(view, store);
}

function overviewViewToggle(store) {
  return h('div', { class: 'hist-viewtoggle' },
    segmented([
      { value: 'day', label: 'Daily' },
      { value: 'week', label: 'Weekly' },
      { value: 'month', label: 'Monthly' },
    ], overviewMode, (v) => { overviewMode = v; rerenderOverview(store); }));
}

// Month view: unchanged blended-colour month grid, with one addition — a
// future day that has something scheduled now gets its own "not done yet"
// treatment (a hollow ring) instead of vanishing into the same flat grey
// as a day with nothing on it at all, and every direction (including
// forward) pages freely rather than stopping at the current month.
function overviewCalendar(store, cur, today) {
  const hasExams = upcomingExams(store.state.classes, today).length > 0;

  const nav = (delta) => {
    const next = addMonths(cur, delta);
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
          h('button', { class: 'icon-btn', 'aria-label': 'next month', onclick: () => nav(1) }, icon('chevR')))),
      h('div', { class: 'cal-grid' },
        WEEKDAYS_MIN.map((d) => h('div', { class: 'cal-dow' }, d)),
        monthGrid(m.y, m.m).flat().map((key) => {
          if (!key) return h('div', {});
          const isToday = key === today;
          if (key > today) {
            // A future day is otherwise a dead grey square — attendance
            // hasn't happened yet — except an exam (brightest signal) or
            // any other scheduled class ("not done yet" — what's left to
            // do), each worth seeing coming from a distance.
            const examsOnDay = classesOccurringOn(store.state.classes, key).filter((e) => e.isExam);
            if (examsOnDay.length) {
              return h('button', {
                class: 'cal-cell num future exam',
                style: accentStyle(examsOnDay[0].color),
                'aria-label': `${key}: exam — ${examsOnDay.map((e) => e.name).join(', ')}`,
                onclick: () => openDayClassesSheet(store, key),
              }, String(Number(key.slice(8))));
            }
            const { scheduled } = dayAttendance(store.state.classes, store.state.classDays, key);
            if (scheduled > 0) {
              return h('button', {
                class: 'cal-cell num upcoming',
                'aria-label': `${key}: ${scheduled} scheduled, not done yet`,
                onclick: () => openDayClassesSheet(store, key),
              }, String(Number(key.slice(8))));
            }
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
      overviewCalendarLegend(hasExams),
    );
  }
  rebuild(cur);
  return box;
}

// ---- Day/Week views: an Apple Calendar-style time grid ----

const HOUR_PX = 56;

// Every occurrence on one day, resolved to its real time and attendance
// status. Filters out anything classDayStatus would call 'empty' — a
// class occurring on this weekday before it existed (classOccursOn's own
// documented edge case, since it doesn't check createdAt itself) — so a
// stray pre-creation occurrence never renders a phantom block.
function dayOccurrences(store, dayKey, today) {
  return classesOccurringOn(store.state.classes, dayKey)
    .map((cls) => ({ cls, ...classTimeFor(cls, dayKey), status: classDayStatus(cls, store.state.classDays, dayKey, today) }))
    .filter((o) => o.status !== 'empty');
}

function timeGridLegend(hasExams) {
  const item = (style, label) => h('span', {}, h('i', { style }), label);
  return h('div', { class: 'cal-legend' },
    item('background:var(--c)', 'attended'),
    item('background:rgba(228,87,61,0.28)', 'missed'),
    item('background:var(--c-25);box-shadow:inset 0 0 0 1.5px var(--c)', 'not done yet'),
    hasExams ? item('background:var(--c);box-shadow:0 0 6px 1px var(--c-70)', 'exam') : null);
}

// Shared grid for both the day view (`days.length === 1`) and the week
// view (7 Monday-Sunday keys) — one vertical hour axis shared by every
// column so a week's classes line up, sized to fit whatever's actually
// scheduled (timeGridRange) rather than a fixed one-size-fits-all window.
// Each occurrence is one absolutely-positioned block: top/height from its
// own time, left/width from layoutTimeBlocks when it shares a slot with
// another class that day. Colour carries status the same way the month
// view's cells do — solid for attended, dimmed red for missed, a hollow
// ring for not done yet — plus an exam's usual brighter glow on top.
// Tapping any block opens that day's quick-check sheet, same as tapping a
// month-view day cell.
function timeGrid(store, days, today) {
  const occByDay = days.map((d) => dayOccurrences(store, d, today));
  const range = timeGridRange(occByDay.flat());
  const heightPx = ((range.endMin - range.startMin) / 60) * HOUR_PX;
  const hourMarks = [];
  for (let m = range.startMin; m <= range.endMin; m += 60) hourMarks.push(m);
  const topFor = (mins) => ((mins - range.startMin) / 60) * HOUR_PX;

  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const dayCols = days.map((dayKey, i) => {
    const laidOut = layoutTimeBlocks(occByDay[i]);
    const blocks = laidOut.map(({ cls, startTime, durationMins, status, col, cols }) => {
      const widthPct = 100 / cols;
      const statusLabel = status === 'hit' ? 'attended' : status === 'miss' ? 'missed' : 'not done yet';
      // A week column is only ~40px wide — nowhere near enough for a
      // class name on one line — so it wraps to as many lines as the
      // block's own height (from its duration) allows instead of
      // ellipsis-ing down to a single surviving letter; the block's own
      // overflow:hidden crops anything past that, same as a single-line
      // truncation would, just with far more of the name actually read.
      // The day view has a whole column to itself, so it keeps the
      // original single-line-plus-time layout.
      const narrow = days.length > 1;
      return h('button', {
        class: `tg-block ${status} ${cls.isExam ? 'exam' : ''} ${narrow ? 'narrow' : ''}`,
        style: `top:${topFor(timeToMinutes(startTime))}px;height:${Math.max(20, (durationMins / 60) * HOUR_PX - 2)}px;` +
          `left:${col * widthPct}%;width:calc(${widthPct}% - 3px);${accentStyle(cls.color)}`,
        'aria-label': `${cls.name}, ${classTimeRange({ startTime, durationMins })}, ${statusLabel}`,
        onclick: () => openDayClassesSheet(store, dayKey),
      },
        h('span', { class: `tg-block-name ${narrow ? 'wrap' : ''}` }, cls.name),
        !narrow ? h('span', { class: 'tg-block-time' }, classTimeRange({ startTime, durationMins })) : null);
    });

    const isToday = dayKey === today;
    const nowLine = isToday && nowMins >= range.startMin && nowMins <= range.endMin
      ? h('div', { class: 'tg-now', style: `top:${topFor(nowMins)}px` })
      : null;

    return h('div', { class: `tg-day-col ${isToday ? 'today' : ''}` },
      hourMarks.map((m) => h('div', { class: 'tg-hourline', style: `top:${topFor(m)}px` })),
      blocks, nowLine);
  });

  return h('div', { class: 'tg' },
    days.length > 1 ? h('div', { class: 'tg-daynames' },
      h('div', { class: 'tg-gutter-spacer' }),
      days.map((d) => h('div', { class: `tg-dayname ${d === today ? 'today' : ''}` },
        h('span', {}, WEEKDAYS[weekdayIndex(d)].slice(0, 3)),
        h('span', { class: 'tg-daynum' }, String(Number(d.slice(8))))))) : null,
    h('div', { class: 'tg-body', style: `height:${heightPx}px` },
      h('div', { class: 'tg-gutter' },
        hourMarks.map((m) => h('span', { class: 'tg-hour-label', style: `top:${topFor(m)}px` }, hourLabel12(m)))),
      h('div', { class: 'tg-days' }, dayCols)));
}

function overviewDayNav(store, delta) {
  overviewDay = addDays(overviewDay, delta);
  haptic(6);
  rerenderOverview(store);
}

function dayView(store, dayKey, today) {
  const hasExams = classesOccurringOn(store.state.classes, dayKey).some((c) => c.isExam);
  return h('div', { class: 'cal' },
    h('div', { class: 'cal-head' },
      h('div', { class: 'cal-month' }, longDate(dayKey)),
      h('div', { class: 'cal-nav' },
        h('button', { class: 'icon-btn', 'aria-label': 'previous day', onclick: () => overviewDayNav(store, -1) }, icon('chevL')),
        h('button', { class: 'icon-btn', 'aria-label': 'next day', onclick: () => overviewDayNav(store, 1) }, icon('chevR')))),
    timeGrid(store, [dayKey], today),
    timeGridLegend(hasExams));
}

function overviewWeekNav(store, delta) {
  overviewWeek = addWeeks(overviewWeek, delta);
  haptic(6);
  rerenderOverview(store);
}

function weekView(store, monday, today) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const hasExams = days.some((d) => classesOccurringOn(store.state.classes, d).some((c) => c.isExam));
  return h('div', { class: 'cal' },
    h('div', { class: 'cal-head' },
      h('div', { class: 'cal-month' }, weekLabel(monday, today)),
      h('div', { class: 'cal-nav' },
        h('button', { class: 'icon-btn', 'aria-label': 'previous week', onclick: () => overviewWeekNav(store, -1) }, icon('chevL')),
        h('button', { class: 'icon-btn', 'aria-label': 'next week', onclick: () => overviewWeekNav(store, 1) }, icon('chevR')))),
    timeGrid(store, days, today),
    timeGridLegend(hasExams));
}

export function renderClassesOverview(root, store) {
  const today = todayKey();
  const stats = allClassesStats(store.state.classes, store.state.classDays, today);

  if (!Object.keys(store.state.classes).length) {
    root.append(h('div', { style: accentStyle(OVERVIEW_ACCENT) },
      overviewHeader(store),
      h('div', { class: 'empty-note' },
        h('b', {}, 'No classes yet'),
        'Add your timetable from the Classes card on Home.')));
    return;
  }

  let body;
  if (overviewMode === 'day') {
    if (!overviewDay) overviewDay = today;
    body = dayView(store, overviewDay, today);
  } else if (overviewMode === 'week') {
    if (!overviewWeek) overviewWeek = mondayOf(today);
    body = weekView(store, overviewWeek, today);
  } else {
    body = overviewCalendar(store, overviewMonth || monthOf(today), today);
  }

  root.append(h('div', { style: accentStyle(OVERVIEW_ACCENT) },
    overviewHeader(store),
    overviewStatsGrid(stats),
    overviewViewToggle(store),
    body,
  ));
}
