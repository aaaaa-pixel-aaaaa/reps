// Nutrition: a home-screen summary tile plus a bottom-sheet breakdown for
// the externally-maintained nutrition feed (nutrition-store.js). Read-only
// end to end — there is no editing UI here, by design; the source file is
// written outside the app.

import {
  todayKey, shortDate, monthOf, addMonths, cmpMonth, monthGrid, monthLabel, WEEKDAYS_MIN,
} from '../dates.js';
import {
  groupedNutrients, alwaysNutrients, nutrientCurrent, nutrientCoverage,
  dayEntries, nutrientBarModel, directionGlyph, nutrientHue, computeAllAlerts,
  summarizeAlerts, RED_HUE, nutrientDayStatus, nutritionStats,
} from '../nutrition.js';
import { nutritionData } from '../nutrition-store.js';
import { h, icon, haptic, openSheet, toast, countUp, ringSVG } from '../ui.js';

// ---- colour: oklch where supported (iOS Safari 16.4+), hsl fallback ----

const OKLCH_OK = typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('color', 'oklch(0.7 0.1 200)');

function hueLerp(a, b, t) {
  const diff = ((b - a + 540) % 360) - 180; // shortest signed delta around the wheel
  return (a + diff * t + 360) % 360;
}

// Lightness held constant; chroma scales with progress so the bar visibly
// comes alive approaching the target rather than merely growing. Past a
// max/range target the hue itself slides toward red as the only signal of
// severity, since width no longer changes.
function barColor(hue, chromaT, overshootT) {
  const L = 0.72;
  const chroma = overshootT > 0 ? 0.15 + 0.03 * overshootT : 0.15 * chromaT;
  const h = overshootT > 0 ? hueLerp(hue, RED_HUE, overshootT) : hue;
  if (OKLCH_OK) return `oklch(${L} ${chroma.toFixed(3)} ${h.toFixed(1)})`;
  const sat = Math.round(Math.min(100, (chroma / 0.2) * 100));
  return `hsl(${h.toFixed(1)} ${sat}% 58%)`;
}

function fmtNutrient(x) {
  if (x == null) return '–';
  const r = Math.round(x * 100) / 100;
  return String(parseFloat(r.toFixed(2)));
}

// ---- animated bar fill ----
// The whole view tears down and rebuilds on every change (this app's usual
// render model), so a plain CSS transition can't help — there's no "from"
// state on a brand-new element. Mirrors home.js's animatedRing: paint the
// remembered old value first, then apply the real value a frame later so
// the CSS transition on width/background actually has something to animate
// between. Band/hard-zone placement isn't animated — it barely moves render
// to render, and re-deriving it fresh every time is simpler than memoizing
// a rectangle nobody will see slide.
const lastBar = new Map(); // nutrient key -> { widthPct, color }
function animatedFill(key, widthPct, color) {
  const fill = h('div', { class: 'nutri-fill' });
  const prev = lastBar.get(key);
  fill.style.width = (prev ? prev.widthPct : widthPct) + '%';
  fill.style.background = prev ? prev.color : color;
  if (!prev || prev.widthPct !== widthPct || prev.color !== color) {
    lastBar.set(key, { widthPct, color });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fill.style.width = widthPct + '%';
      fill.style.background = color;
    }));
  }
  return fill;
}

const pct = (v, railMax) => Math.max(0, Math.min(100, (v / railMax) * 100));

// The rail: neutral track, the satisfied-band highlight, a red-tinted zone
// beyond a hard (upperLimit) ceiling if there's rail past it, then the fill
// on top — so the band reads as "still ahead" until the fill covers it, and
// as "already inside" once it does. This one function is the only place any
// surface draws a nutrient's track; the tile rows, sheet rows and (via
// energyRing) the home ring's radial band all go through the same model.
function nutriTrack(key, model, color) {
  const kids = [];
  if (model.band && model.railMax) {
    const left = pct(model.band.start, model.railMax);
    const right = pct(model.band.end, model.railMax);
    kids.push(h('div', { class: 'nutri-band', style: `left:${left}%;width:${Math.max(0, right - left)}%` }));
    if (model.band.hard && right < 100) {
      kids.push(h('div', { class: 'nutri-hardzone', style: `left:${right}%` }));
    }
  }
  kids.push(animatedFill(key, model.unknown ? 0 : model.fillFrac * 100, model.unknown ? 'transparent' : color));
  return h('div', { class: 'nutri-track' }, kids);
}

function glyphSpan(glyph) {
  return glyph ? h('span', { class: 'nutri-glyph', 'aria-hidden': 'true' }, glyph) : null;
}

let lastEnergyProgress = null;
let lastEnergyColor = null;
function energyRing(model, color) {
  const progress = model.unknown ? 0 : model.fillFrac;
  const band = model.band && model.railMax
    ? { start: model.band.start / model.railMax, end: model.band.end / model.railMax }
    : null;
  const svg = ringSVG(92, 8, lastEnergyProgress ?? progress, band);
  const prog = svg.querySelector('.ring-prog');
  prog.style.stroke = lastEnergyColor ?? color;
  if (lastEnergyProgress !== progress || lastEnergyColor !== color) {
    lastEnergyProgress = progress;
    lastEnergyColor = color;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      svg._setProgress(progress);
      prog.style.stroke = color;
    }));
  }
  return svg;
}

let lastKcalValue = null;
function kcalNumeral(current) {
  const el = h('div', { class: 'ring-val num' }, '–');
  if (current != null) {
    if (lastKcalValue == null) el.textContent = fmtNutrient(current);
    else countUp(el, lastKcalValue, current, (v) => fmtNutrient(Math.round(v)));
  }
  lastKcalValue = current;
  return el;
}

// ---- small markers (detail sheet only) ----

function coverageDot(current, coverage) {
  if (current == null) return h('span', { class: 'nutri-dot unknown' }, '–');
  return h('span', { class: `nutri-dot ${coverage >= 100 ? 'full' : 'partial'}` });
}

function noteBadge(note) {
  return h('button', {
    class: 'nutri-badge note', 'aria-label': 'note',
    onclick: (e) => { e.stopPropagation(); haptic(6); toast(note, 4200); },
  }, 'i');
}

function unconfirmedBadge() {
  return h('button', {
    class: 'nutri-badge unconfirmed', 'aria-label': 'unconfirmed target',
    onclick: (e) => { e.stopPropagation(); haptic(6); toast('Unconfirmed target — won’t trigger warnings', 3400); },
  }, '?');
}

// ---- the one shared nutrient renderer ----
// Every surface that shows a nutrient's current-vs-target — the tile's four
// macro rows, every row in the detail sheet's groups — calls this and only
// this. It owns the scale, band, fill, colour and glyph; a surface only
// picks a size (via CSS) and whether it's in "detail" mode (coverage dot,
// note/unconfirmed badges — noise the compact tile rows don't need).
export function renderNutrientBar(key, def, current, { coverage, detail = false } = {}) {
  const model = nutrientBarModel(def, current);
  const unit = def.unit ? ` ${def.unit}` : '';
  const labelKids = [
    glyphSpan(model.glyph),
    detail ? coverageDot(current, coverage) : null,
    h('span', { class: 'nutri-row-label' }, def.label),
    detail && def.note ? noteBadge(def.note) : null,
    detail && def.targetConfidence === 'unconfirmed' ? unconfirmedBadge() : null,
  ];

  if (def.direction === 'none') {
    return h('div', { class: 'nutri-row nutri-row-plain' },
      h('span', { class: 'nutri-row-label-group' }, labelKids),
      h('span', { class: 'nutri-row-val num' }, current == null ? '–' : `${fmtNutrient(current)}${unit}`));
  }
  const color = model.unknown ? 'transparent' : barColor(nutrientHue(key), model.chromaT, model.overshootT);
  const valueText = model.unknown ? '–' : `${fmtNutrient(current)} / ${fmtNutrient(def.target)}${unit}`;
  return h('div', { class: 'nutri-row' },
    h('div', { class: 'nutri-row-head' },
      h('span', { class: 'nutri-row-label-group' }, labelKids),
      h('span', { class: 'nutri-row-val num' }, valueText)),
    nutriTrack(key, model, color));
}

// ---- home tile ----

export function renderNutritionTile() {
  const data = nutritionData();
  if (!data || !data.nutrients || !data.nutrients.energy) return null;
  const today = todayKey();
  const day = data.days[today];
  const energyDef = data.nutrients.energy;
  const current = nutrientCurrent(day, 'energy');
  const model = nutrientBarModel(energyDef, current);
  const color = model.unknown ? 'var(--raise3)' : barColor(nutrientHue('energy'), model.chromaT, model.overshootT);

  const rows = alwaysNutrients(data.nutrients).map(([key, def]) => renderNutrientBar(key, def, nutrientCurrent(day, key)));

  const alerts = computeAllAlerts(data, today);
  const summary = summarizeAlerts(alerts);

  return h('div', {
    class: 'card nutri-card pressable',
    role: 'button',
    tabindex: '0',
    onclick: () => openNutritionSheet(today),
  },
    h('button', {
      class: 'dots', 'aria-label': 'Nutrition history & stats',
      onclick: (e) => { e.stopPropagation(); location.hash = 'nutrition'; },
    }, icon('cal')),
    h('div', { class: 'nutri-main' },
      h('div', { class: 'nutri-energy' },
        h('div', { class: 'ringbox' }, energyRing(model, color),
          h('div', { class: 'ring-label' },
            kcalNumeral(current),
            h('div', { class: 'ring-goal num' }, `/ ${fmtNutrient(energyDef.target)}`)))),
      h('div', { class: 'nutri-bars' }, rows),
    ),
    summary ? h('button', {
      class: 'nutri-alert-strip',
      onclick: (e) => { e.stopPropagation(); haptic(8); openNutritionSheet(today, { scrollToWarnings: true }); },
    }, summary) : null,
  );
}

// ---- history & stats page ----
// A single global page (unlike per-tracker history, there's only one
// nutrition feed), reachable via #/nutrition from the tile's history
// button. Lets you pick any nutrient with a real target and page through
// a month calendar of hit/miss/no-data days for it, mirroring the
// tracker history page's daily calendar shape and interactions exactly.

let historyMonth = null;    // remembered month across re-renders
let historyNutrient = 'energy';

function historyHeader() {
  return h('div', { class: 'hist-top' },
    h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => { location.hash = ''; } }, icon('chevL')),
    h('div', { class: 'view-title' }, h('span', { class: 'tdot' }), h('span', {}, 'Nutrition')),
  );
}

function historyStatsGrid(stats) {
  const cell = (val, label, sub) => h('div', { class: 'stat' },
    h('b', { class: 'num' }, val, sub ? h('small', {}, ` ${sub}`) : null),
    h('span', {}, label));
  return h('div', { class: 'stats' },
    cell(String(stats.loggedDays), 'days logged'),
    cell(String(stats.goalsHitDays), 'goals hit'),
    cell(String(stats.currentStreak), 'current streak', stats.currentStreak === 1 ? 'day' : 'days'),
    cell(String(stats.longestStreak), 'longest streak', stats.longestStreak === 1 ? 'day' : 'days'));
}

// direction:"none" nutrients have no target to judge a day against, so
// they're left out of the picker entirely rather than offering a calendar
// that can never show anything but "no data".
function nutrientPicker(nutrients, selected, onChange) {
  const options = groupedNutrients(nutrients).map(({ label, items }) => {
    const eligible = items.filter(([, def]) => def.direction !== 'none');
    if (!eligible.length) return null;
    return h('optgroup', { label },
      eligible.map(([key, def]) => h('option', { value: key, selected: key === selected },
        `${directionGlyph(def.direction)} ${def.label}`.trim())));
  }).filter(Boolean);
  const select = h('select', { class: 'input' }, options);
  select.value = selected;
  select.addEventListener('change', () => onChange(select.value));
  return h('div', { class: 'field' }, h('label', {}, 'viewing'), select);
}

function nutritionCalendarLegend() {
  const item = (style, label) => h('span', {}, h('i', { style }), label);
  return h('div', { class: 'cal-legend' },
    item('background:var(--c)', 'goal met'),
    item('background:rgba(228,87,61,0.28)', 'missed'),
    item('background:transparent;border:1px solid var(--line)', 'no data'));
}

function nutritionCalendar(data, key, today) {
  const def = data.nutrients[key];
  const days = data.days;
  const nowMonth = monthOf(today);
  let cur = historyMonth || nowMonth;
  if (cmpMonth(cur, nowMonth) > 0) cur = nowMonth;

  const nav = (delta) => {
    const next = addMonths(cur, delta);
    if (cmpMonth(next, nowMonth) > 0) return;
    historyMonth = next;
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
        monthGrid(m.y, m.m).flat().map((dateKey) => {
          if (!dateKey) return h('div', {});
          const status = nutrientDayStatus(def, days[dateKey], key, dateKey, today);
          return h('button', {
            class: `cal-cell num ${status} ${dateKey === today ? 'today' : ''}`,
            disabled: status === 'future',
            'aria-label': `${dateKey}: ${status}`,
            onclick: () => openNutritionSheet(dateKey),
          }, String(Number(dateKey.slice(8))));
        })),
      nutritionCalendarLegend(),
    );
  }
  rebuild(cur);
  return box;
}

export function renderNutritionHistory(root) {
  const data = nutritionData();
  if (!data || !data.nutrients || !data.nutrients.energy) { location.hash = ''; return; }
  const today = todayKey();
  const stats = nutritionStats(data, today);
  if (!data.nutrients[historyNutrient]) historyNutrient = 'energy';

  const wrap = h('div', { style: `--c:${barColor(nutrientHue(historyNutrient), 1, 0)}` });
  const calBox = h('div', {});
  const rebuildCal = () => calBox.replaceChildren(nutritionCalendar(data, historyNutrient, today));
  rebuildCal();

  wrap.append(
    historyHeader(),
    historyStatsGrid(stats),
    nutrientPicker(data.nutrients, historyNutrient, (key) => {
      historyNutrient = key;
      historyMonth = null; // a freshly picked nutrient starts back at the current month
      wrap.style.setProperty('--c', barColor(nutrientHue(key), 1, 0));
      rebuildCal();
    }),
    calBox,
  );
  root.append(wrap);
}

// ---- detail sheet ----

// `type: "upperLimit"` alerts are a distinct, more serious kind — a single
// day over a safety ceiling, not a slow trend — so they get their own
// wording, a stronger head treatment (`.severe`, in CSS) and the
// upperLimitNote surfaced directly rather than tucked behind a tap, since
// most ULs concern supplemental forms only and that caveat matters.
function warningRow(alert) {
  const { def, breachDays, windowDays, type } = alert;
  const isUL = type === 'upperLimit';
  const dir = def.direction === 'min' ? 'low' : 'high';
  const box = h('div', { class: `nutri-warn collapsed${isUL ? ' severe' : ''}` });
  const head = h('button', {
    class: 'nutri-warn-head',
    'aria-expanded': 'false',
    onclick: () => {
      const collapsed = box.classList.toggle('collapsed');
      head.setAttribute('aria-expanded', String(!collapsed));
      haptic(6);
    },
  },
    // Always the warning red, not the nutrient's own decorative hue — a
    // list of things wrong should read as uniformly "wrong" at a glance,
    // whichever direction they breached in. barColor(RED_HUE, 1, 1) lerps
    // red to itself, landing on plain red while still respecting the
    // oklch/hsl feature detection.
    h('span', { class: 'nutri-warn-dot', style: `background:${barColor(RED_HUE, 1, 1)}` }),
    h('span', { class: 'nutri-warn-label' },
      glyphSpan(directionGlyph(def.direction)),
      isUL ? `${def.label} over safe limit` : `${def.label} ${dir}`),
    h('span', { class: 'nutri-warn-count num' }, isUL ? String(breachDays.length) : `${breachDays.length}/${windowDays}`),
    h('span', { class: 'nutri-warn-chev' }, icon('chevD')));
  box.append(head);
  if (isUL && def.upperLimitNote) box.append(h('div', { class: 'nutri-warn-note' }, def.upperLimitNote));
  box.append(h('div', { class: 'nutri-warn-days' }, breachDays.map((k) => h('span', { class: 'dl-set num' }, shortDate(k)))));
  return box;
}

function nutrientGroupSection(label, items, day) {
  const box = h('div', { class: 'nutri-group collapsed' });
  const body = h('div', { class: 'nutri-group-body' },
    items.map(([key, def]) =>
      renderNutrientBar(key, def, nutrientCurrent(day, key), { coverage: nutrientCoverage(day, key), detail: true })));
  const head = h('div', {
    class: 'nutri-group-head', role: 'button', tabindex: '0', 'aria-expanded': 'false',
    onclick: () => {
      const collapsed = box.classList.toggle('collapsed');
      head.setAttribute('aria-expanded', String(!collapsed));
      haptic(6);
    },
  },
    h('span', { class: 'nutri-group-name' }, label),
    h('span', { class: 'nutri-group-count num' }, String(items.length)),
    h('span', { class: 'nutri-group-chev' }, icon('chevD')));
  box.append(head, body);
  return box;
}

const ENTRY_MACRO_KEYS = ['energy', 'protein', 'carbs', 'fat'];

function entriesSection(day, nutrients) {
  const entries = dayEntries(day);
  if (!entries.length) {
    return h('div', {},
      h('div', { class: 'sheet-section' }, 'Logged'),
      h('div', { class: 'empty-note', style: 'padding:20px' }, 'Nothing logged this day.'));
  }
  const rows = entries.map((entry) => {
    const bits = ENTRY_MACRO_KEYS
      .filter((k) => entry.nutrients && entry.nutrients[k] != null && nutrients[k])
      .map((k) => `${fmtNutrient(entry.nutrients[k])}${nutrients[k].unit ? ' ' + nutrients[k].unit : ''} ${nutrients[k].label.toLowerCase()}`);
    return h('div', { class: 'dl' },
      h('div', { class: 'dl-head' },
        h('div', { class: 'dl-date num' },
          entry.item,
          entry.qty ? h('small', {}, ` · ${entry.qty}`) : null,
          entry.time ? h('span', { style: 'color:var(--faint);margin-left:6px;font-size:12px' }, entry.time) : null)),
      bits.length ? h('div', { class: 'dl-sets' }, bits.map((b) => h('span', { class: 'dl-set num' }, b))) : null);
  });
  return h('div', {},
    h('div', { class: 'sheet-section' }, `Logged · ${entries.length} item${entries.length === 1 ? '' : 's'}`),
    h('div', { class: 'daylog' }, rows));
}

export function openNutritionSheet(dateKey = todayKey(), { scrollToWarnings = false } = {}) {
  const data = nutritionData();
  if (!data || !data.nutrients) { toast('Nutrition data not loaded yet'); return; }
  const day = data.days[dateKey];
  const isToday = dateKey === todayKey();
  const alerts = computeAllAlerts(data, dateKey);

  openSheet({
    title: `Nutrition${isToday ? '' : ` · ${shortDate(dateKey)}`}`,
    build(body, api) {
      const sections = [];

      if (alerts.length) {
        sections.push(h('div', { class: 'nutri-warnings' },
          h('div', { class: 'sheet-section' }, 'Needs attention'),
          h('div', { class: 'nutri-warn-list' }, alerts.map(warningRow))));
      }

      for (const { label, items } of groupedNutrients(data.nutrients)) {
        sections.push(nutrientGroupSection(label, items, day));
      }

      sections.push(entriesSection(day, data.nutrients));

      body.append(...sections);

      if (scrollToWarnings) {
        requestAnimationFrame(() => {
          body.querySelector('.nutri-warnings')?.scrollIntoView({ block: 'start' });
        });
      }
    },
  });
}
