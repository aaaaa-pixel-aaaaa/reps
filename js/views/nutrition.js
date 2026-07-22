// Nutrition: a home-screen summary tile plus a bottom-sheet breakdown for
// the externally-maintained nutrition feed (nutrition-store.js). Read-only
// end to end — there is no editing UI here, by design; the source file is
// written outside the app.

import { todayKey, shortDate } from '../dates.js';
import {
  groupedNutrients, alwaysNutrients, nutrientCurrent, nutrientCoverage,
  dayEntries, barFill, nutrientHue, computeAlerts, summarizeAlerts, RED_HUE,
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
// between.
const lastBar = new Map(); // nutrient key -> { widthPct, color }
function animatedBar(key, widthPct, color, showMarker) {
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
  return h('div', { class: 'nutri-track' }, fill, showMarker ? h('div', { class: 'nutri-marker' }) : null);
}

let lastEnergyProgress = null;
let lastEnergyColor = null;
function energyRing(progress, color) {
  const svg = ringSVG(92, 8, lastEnergyProgress ?? progress);
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

// ---- one nutrient row: label(+markers), current/target, bar ----
// `detail` toggles the coverage dot and note/unconfirmed markers, which the
// compact home-tile bars deliberately don't show.
function barRow(key, def, current, { coverage, detail = false } = {}) {
  const unit = def.unit ? ` ${def.unit}` : '';
  const labelKids = [
    detail ? coverageDot(current, coverage) : null,
    h('span', { class: 'nutri-row-label' }, def.label),
    detail && def.note ? noteBadge(def.note) : null,
    detail && def.targetConfidence === 'unconfirmed' ? unconfirmedBadge() : null,
  ].filter(Boolean);

  if (def.direction === 'none') {
    return h('div', { class: 'nutri-row nutri-row-plain' },
      h('span', { class: 'nutri-row-label-group' }, labelKids),
      h('span', { class: 'nutri-row-val num' }, current == null ? '–' : `${fmtNutrient(current)}${unit}`));
  }
  const fs = barFill(def, current);
  const color = fs.unknown ? 'transparent' : barColor(nutrientHue(key), fs.chromaT, fs.overshootT);
  const valueText = fs.unknown ? '–' : `${fmtNutrient(current)} / ${fmtNutrient(def.target)}${unit}`;
  return h('div', { class: 'nutri-row' },
    h('div', { class: 'nutri-row-head' },
      h('span', { class: 'nutri-row-label-group' }, labelKids),
      h('span', { class: 'nutri-row-val num' }, valueText)),
    animatedBar(key, fs.widthPct, color, fs.showMarker));
}

// ---- home tile ----

export function renderNutritionTile() {
  const data = nutritionData();
  if (!data || !data.nutrients || !data.nutrients.energy) return null;
  const today = todayKey();
  const day = data.days[today];
  const energyDef = data.nutrients.energy;
  const current = nutrientCurrent(day, 'energy');
  const fs = barFill(energyDef, current);
  const progress = fs.unknown ? 0 : Math.min(1, fs.ratio);
  const color = fs.unknown ? 'var(--raise3)' : barColor(nutrientHue('energy'), fs.chromaT, fs.overshootT);

  const rows = alwaysNutrients(data.nutrients).map(([key, def]) => barRow(key, def, nutrientCurrent(day, key)));

  const alerts = computeAlerts(data, today);
  const summary = summarizeAlerts(alerts);

  return h('div', {
    class: 'card nutri-card pressable',
    role: 'button',
    tabindex: '0',
    onclick: () => openNutritionSheet(today),
  },
    h('div', { class: 'nutri-main' },
      h('div', { class: 'nutri-energy' },
        h('div', { class: 'ringbox' }, energyRing(progress, color),
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

// ---- detail sheet ----

function warningRow(alert) {
  const { def, breachDays, windowDays } = alert;
  const dir = def.direction === 'min' ? 'low' : 'high';
  const box = h('div', { class: 'nutri-warn collapsed' });
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
    h('span', { class: 'nutri-warn-label' }, `${def.label} ${dir}`),
    h('span', { class: 'nutri-warn-count num' }, `${breachDays.length}/${windowDays}`),
    h('span', { class: 'nutri-warn-chev' }, icon('chevD')));
  const days = h('div', { class: 'nutri-warn-days' }, breachDays.map((k) => h('span', { class: 'dl-set num' }, shortDate(k))));
  box.append(head, days);
  return box;
}

function nutrientGroupSection(label, items, day) {
  const box = h('div', { class: 'nutri-group collapsed' });
  const body = h('div', { class: 'nutri-group-body' },
    items.map(([key, def]) =>
      barRow(key, def, nutrientCurrent(day, key), { coverage: nutrientCoverage(day, key), detail: true })));
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
  const alerts = computeAlerts(data, dateKey);

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
