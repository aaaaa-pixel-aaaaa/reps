// Pure domain logic for the externally-maintained nutrition feed: coverage/
// current-value lookups, bar-fill math, nutrient hues, and alert detection.
// No DOM, no storage, no fetching — nutrition-store.js owns the data,
// views/nutrition.js owns rendering. Mirrors model.js's split for trackers.

import { addDays, todayKey } from './dates.js';

export const GROUP_ORDER = ['macro', 'fat', 'mineral', 'vitamin'];
export const GROUP_LABELS = { macro: 'Macros', fat: 'Fats', mineral: 'Minerals', vitamin: 'Vitamins' };

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 };
export function confidenceRank(c) {
  return c in CONFIDENCE_RANK ? CONFIDENCE_RANK[c] : -1;
}

// A nutrient absent from a day's totals is UNKNOWN, never zero — callers
// must check for null, not falsiness, before treating a value as "no intake".
export function nutrientCurrent(day, key) {
  const v = day && day.totals ? day.totals[key] : undefined;
  return v == null ? null : v;
}

// Coverage is metadata about data completeness, not the nutrient value
// itself — missing coverage just means "unknown how complete", which reads
// as 0 for qualification purposes without implying the intake was zero.
export function nutrientCoverage(day, key) {
  const v = day && day.coverage ? day.coverage[key] : undefined;
  return typeof v === 'number' ? v : 0;
}

export function dayEntries(day) {
  return day && Array.isArray(day.entries) ? day.entries : [];
}

// Nutrients with display:"always" other than energy, in the JSON's own key
// order — driven off the field so the tile follows the feed, never a
// hardcoded list.
export function alwaysNutrients(nutrients) {
  return Object.entries(nutrients || {}).filter(([k, def]) => def.display === 'always' && k !== 'energy');
}

// All nutrients grouped for the detail sheet, in GROUP_ORDER, each group's
// members in the JSON's own key order. Groups with no members are omitted.
export function groupedNutrients(nutrients) {
  const byGroup = {};
  for (const key in nutrients || {}) {
    const def = nutrients[key];
    (byGroup[def.group] = byGroup[def.group] || []).push([key, def]);
  }
  return GROUP_ORDER.filter((g) => byGroup[g] && byGroup[g].length)
    .map((g) => ({ group: g, label: GROUP_LABELS[g], items: byGroup[g] }));
}

// A stable hash spread across the hue wheel via the golden angle, so every
// nutrient gets its own distinct accent without a hand-maintained palette
// (there are ~34 of them across 4 groups) and without adjacent keys
// clustering in colour.
const GOLDEN = 0.6180339887498949;
function stableHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
// The colour an overshooting max/range bar always slides toward — nutrient
// hues steer clear of a band around it so an ordinary bar's natural colour
// is never mistaken for the overshoot warning.
export const RED_HUE = 29;
const RED_BAND = 26;

export function nutrientHue(key) {
  const raw = ((stableHash(key) * GOLDEN) % 1) * 360;
  const delta = Math.abs(((raw - RED_HUE + 180) % 360) - 180); // shortest distance to RED_HUE
  if (delta > RED_BAND) return raw;
  const clockwise = ((raw - RED_HUE + 360) % 360) < 180;
  const push = RED_BAND - delta + 4;
  return (raw + (clockwise ? push : -push) + 360) % 360;
}

// Bar-fill math for one nutrient, as 0..1 numbers only — views/nutrition.js
// turns these into actual CSS colours. Mirrors hitIntensity/periodIntensity
// in model.js: pure ratio math here, presentation in the view layer.
//
//   unknown     no value at all (absent from totals) — callers must render
//               this distinctly from an actual zero, never collapse both
//               down to the same "–".
//   widthPct    0..100, clamped — a "min" nutrient holds at 100% past its
//               target (exceeding a minimum is good, it doesn't grow further
//               or change colour); a "max"/"range" nutrient also holds at
//               100% once its target is reached (per the spec: overshoot
//               changes colour, not width).
//   chromaT     0..1 — how far the colour has climbed from near-grey (0) to
//               fully saturated (1) as current approaches target. Same for
//               every direction; the bar "comes alive" as you approach any
//               target, not just a "min" one.
//   overshootT  0 until a "max"/"range" nutrient exceeds its target, then
//               0..1 as current climbs from target to softMax — this is
//               what should push the hue toward red, not the width.
//   showMarker  whether to draw the fixed reference line at the target
//               position — only meaningful for "max"/"range" nutrients,
//               since a "min" nutrient's target isn't a boundary to flag.
export function barFill(def, current) {
  if (current == null || def.target == null || !(def.target > 0)) {
    return { unknown: current == null, ratio: null, widthPct: 0, chromaT: 0, overshootT: 0, showMarker: false };
  }
  const ratio = current / def.target;
  const widthPct = Math.min(Math.max(ratio, 0), 1) * 100;
  const chromaT = widthPct / 100;
  const capped = def.direction === 'max' || def.direction === 'range';
  let overshootT = 0;
  if (capped && current > def.target) {
    // Not every "range" nutrient in the feed carries a softMax (carbs
    // doesn't) — without a defined ceiling there's nothing to ramp toward,
    // so any exceedance reads as fully red rather than guessing at one.
    const soft = def.softMax > def.target ? def.softMax : def.target;
    overshootT = soft > def.target ? Math.min(Math.max((current - def.target) / (soft - def.target), 0), 1) : 1;
  }
  return { unknown: false, ratio, widthPct, chromaT, overshootT, showMarker: capped };
}

// Whether a nutrient's target is trusted enough to ever alert on, per
// alertRules.allowedTargetConfidence — "unconfirmed" targets (in this feed,
// just omega3LC) display fully but never alert. direction:"none" nutrients
// (context-only, no target) never alert either.
function canAlert(alertRules, def) {
  return def.direction !== 'none' &&
    def.target != null && def.target > 0 &&
    Array.isArray(alertRules.allowedTargetConfidence) &&
    alertRules.allowedTargetConfidence.includes(def.targetConfidence);
}

// A day qualifies for a nutrient only if its coverage clears the bar AND
// the day's entries meet the confidence floor for the relevant field
// (macroConfidence for macro/fat groups, microConfidence for mineral/
// vitamin). Confidence is recorded per entry, not per day, so a day's
// confidence is its worst entry's — one low-confidence guess is enough to
// make the whole day's reading untrustworthy for alerting purposes.
export function dayQualifies(alertRules, def, day, key) {
  if (!day) return false;
  if (nutrientCoverage(day, key) < alertRules.minCoveragePct) return false;
  const field = (def.group === 'macro' || def.group === 'fat') ? 'macroConfidence' : 'microConfidence';
  const entries = dayEntries(day);
  if (!entries.length) return false;
  let worst = null;
  for (const e of entries) {
    const r = confidenceRank(e[field]);
    if (worst == null || r < worst) worst = r;
  }
  return worst != null && worst >= confidenceRank(alertRules.minConfidence);
}

// Alerts over the trailing window: for each alertable nutrient, walk back
// windowDays from today, tally the qualifying days that breach the
// threshold in that nutrient's direction (below lowThresholdPct of target
// for "min", above highThresholdPct for "max"/"range" — "range" is only
// ever checked on the high side, matching the rules verbatim). Non-
// qualifying days are simply skipped — they neither extend nor break
// anything, this is a plain tally within a fixed window, not a streak.
// Fires once qualifyingDaysRequired of those breaching days are found.
export function computeAlerts(nutrition, today = todayKey()) {
  const { nutrients, days, alertRules } = nutrition;
  const alerts = [];
  for (const key in nutrients) {
    const def = nutrients[key];
    if (!canAlert(alertRules, def)) continue;
    const breachDays = [];
    for (let i = 0; i < alertRules.windowDays; i++) {
      const dateKey = addDays(today, -i);
      const day = days[dateKey];
      if (!dayQualifies(alertRules, def, day, key)) continue;
      const current = nutrientCurrent(day, key);
      if (current == null) continue;
      const ratio = current / def.target;
      const breach = def.direction === 'min'
        ? ratio < alertRules.lowThresholdPct / 100
        : ratio > alertRules.highThresholdPct / 100;
      if (breach) breachDays.push(dateKey);
    }
    if (breachDays.length >= alertRules.qualifyingDaysRequired) {
      alerts.push({ key, def, breachDays: breachDays.sort().reverse(), windowDays: alertRules.windowDays });
    }
  }
  return alerts;
}

// Tile copy: one alert names it, several are summarized so the tile never
// turns into a wall of text.
export function summarizeAlerts(alerts) {
  if (!alerts.length) return null;
  if (alerts.length === 1) {
    const { def, breachDays, windowDays } = alerts[0];
    const dir = def.direction === 'min' ? 'low' : 'high';
    return `${def.label} ${dir} — ${breachDays.length} of last ${windowDays} days`;
  }
  return `${alerts.length} nutrients need attention`;
}
