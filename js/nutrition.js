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

// ---- schema v6: published bounds (targetMin/targetMax/upperLimit) ----
//
// A redundant-channel prefix for every nutrient label ("↑ Protein"), so
// direction reads without relying on the bar's colour alone.
export const DIRECTION_GLYPH = { min: '↑', max: '↓', range: '↕' };
export function directionGlyph(direction) {
  return DIRECTION_GLYPH[direction] || '';
}

// The rail a nutrient's bar/ring is drawn against. It always spans
// [0, railMax], sized off the nutrient's own ceiling (softMax, else
// targetMax, else target — "min" nutrients just use target, they have no
// upper figure of their own) with 15% headroom, so an ordinary reading never
// crowds the edge. A real upperLimit (Tolerable Upper Intake Level) is at
// least 2.2x its target in this feed, so it stays off-rail — irrelevant to
// diet alone — until intake actually gets close (>=60% of it), at which
// point the rail tightens around it so a supplement-driven approach to the
// ceiling is legible. Whatever the first two rules produce, the rail is
// still widened to fit current if current would otherwise clip past it.
export function nutrientRailMax(def, current) {
  if (def.target == null || !(def.target > 0)) return null;
  const base = def.direction === 'min' ? def.target : (def.softMax ?? def.targetMax ?? def.target);
  let railMax = base / 0.85;
  if (def.upperLimit != null && current != null && current >= 0.6 * def.upperLimit) {
    railMax = def.upperLimit / 0.9;
  }
  if (current != null && current > railMax) {
    railMax = current / 0.95;
  }
  return railMax;
}

// The "satisfied" zone, drawn as a section of rail with more contrast than
// the empty track — this replaces the old fixed tick marker at the target.
// `hard` marks a real safety ceiling as the band's own upper edge, which
// gets a red-tinted rail beyond it (a soft ceiling like targetMax/softMax
// leaves the rail past it neutral).
//
// "range" nutrients without a published targetMax (in this feed, only
// energy) fall back to softMax for the band's end. Energy's targetMin is
// null and it has no targetMax, so the literal targetMax ?? target formula
// would collapse the band to a single point at target — but energy is
// meant to read as satisfied anywhere from target up to softMax (3100 to
// 3500 kcal), only warming past that, so softMax fills in as the band end.
export function nutrientBand(def, railMax) {
  if (def.direction === 'none' || def.target == null || !(def.target > 0)) return null;
  let start, end;
  if (def.direction === 'min') { start = def.target; end = def.upperLimit ?? railMax; }
  else if (def.direction === 'max') { start = 0; end = def.target; }
  else { start = def.targetMin ?? def.target; end = def.targetMax ?? def.softMax ?? def.target; }
  return { start, end, hard: def.upperLimit != null && end === def.upperLimit };
}

// The point past band.end where the colour reaches full red. A hard ceiling
// has no further headroom to ramp across — exceeding a safety limit is a
// binary fact, not a matter of degree, so it reddens the instant it's
// crossed rather than gradually.
function nutrientRedPoint(def, band) {
  if (def.softMax != null) return def.softMax;
  if (band.hard) return band.end;
  return band.end * 1.25;
}

// The full bar model for one nutrient — the single source every surface
// (tile rows, sheet rows, the energy ring) reads to draw scale, band, fill,
// and colour, so no two surfaces can ever disagree about what a nutrient's
// bar should look like. Mirrors hitIntensity/periodIntensity in model.js:
// pure ratio math here, DOM/CSS in the view layer.
//
//   unknown     no value logged at all — callers must render this as a dash,
//               never a zero-width fill standing in for a real zero.
//   railMax     the rail's right edge, in the nutrient's own unit.
//   band        { start, end, hard } in the same unit, or null for
//               direction:"none" (no target to be "satisfied" against).
//   fillFrac    0..1, current's position along [0, railMax].
//   chromaT     0..1 — 0.15 (near-grey, never fully flat) ramping to 1.0
//               (full identity-hue saturation) as current climbs from 0 to
//               band.start; already 1.0 anywhere inside or past the band.
//   overshootT  0 until current passes band.end, then 0..1 as it climbs
//               from there to the red point — this pushes hue toward red,
//               width is unaffected. Exceeding a "min" target that carries
//               no upperLimit never reddens: going over a floor with no
//               safety ceiling is purely good.
export function nutrientBarModel(def, current) {
  const glyph = directionGlyph(def.direction);
  if (def.direction === 'none' || def.target == null || !(def.target > 0)) {
    return { unknown: current == null, glyph, railMax: null, band: null, fillFrac: 0, chromaT: 0, overshootT: 0 };
  }
  if (current == null) {
    const railMax = nutrientRailMax(def, null);
    return { unknown: true, glyph, railMax, band: nutrientBand(def, railMax), fillFrac: 0, chromaT: 0, overshootT: 0 };
  }
  const railMax = nutrientRailMax(def, current);
  const band = nutrientBand(def, railMax);
  const fillFrac = Math.min(1, Math.max(0, current / railMax));

  const chromaT = (band.start <= 0 || current >= band.start)
    ? 1
    : 0.15 + 0.85 * Math.max(0, current / band.start);

  let overshootT = 0;
  const neverReddens = def.direction === 'min' && def.upperLimit == null;
  if (!neverReddens && current > band.end) {
    const redPoint = nutrientRedPoint(def, band);
    overshootT = redPoint > band.end ? Math.min(1, (current - band.end) / (redPoint - band.end)) : 1;
  }

  return { unknown: false, glyph, railMax, band, fillFrac, chromaT, overshootT };
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
      alerts.push({ key, def, type: 'streak', breachDays: breachDays.sort().reverse(), windowDays: alertRules.windowDays });
    }
  }
  return alerts;
}

// upperLimit breaches are a safety finding, not a slow trend — a single
// qualifying day over the ceiling is enough to alert, unlike the trailing-
// window tally computeAlerts uses for target/band breaches. Still gated on
// the same day-qualification rule (coverage + confidence), since an
// unqualified day's reading isn't trustworthy enough to accuse it of
// anything, safety included. Never fires for a nutrient with no upperLimit.
export function computeUpperLimitAlerts(nutrition, today = todayKey()) {
  const { nutrients, days, alertRules } = nutrition;
  const alerts = [];
  for (const key in nutrients) {
    const def = nutrients[key];
    if (def.upperLimit == null) continue;
    const breachDays = [];
    for (let i = 0; i < alertRules.windowDays; i++) {
      const dateKey = addDays(today, -i);
      const day = days[dateKey];
      if (!dayQualifies(alertRules, def, day, key)) continue;
      const current = nutrientCurrent(day, key);
      if (current == null) continue;
      if (current > def.upperLimit) breachDays.push(dateKey);
    }
    if (breachDays.length) {
      alerts.push({ key, def, type: 'upperLimit', breachDays: breachDays.sort().reverse(), windowDays: alertRules.windowDays });
    }
  }
  return alerts;
}

// Everything the tile/sheet warn about, upperLimit breaches first — they're
// the more serious, immediate-fire kind.
export function computeAllAlerts(nutrition, today = todayKey()) {
  return [...computeUpperLimitAlerts(nutrition, today), ...computeAlerts(nutrition, today)];
}

// Tile copy: one alert names it, several are summarized so the tile never
// turns into a wall of text.
export function summarizeAlerts(alerts) {
  if (!alerts.length) return null;
  if (alerts.length === 1) {
    const a = alerts[0];
    if (a.type === 'upperLimit') return `${a.def.label} over the safe upper limit`;
    const dir = a.def.direction === 'min' ? 'low' : 'high';
    return `${a.def.label} ${dir} — ${a.breachDays.length} of last ${a.windowDays} days`;
  }
  return `${alerts.length} nutrients need attention`;
}

// ---- history page: per-nutrient day status, streaks, overall stats ----

// Whether a single value satisfies a nutrient's own goal — a plain boolean,
// unlike barFill's continuous ratio, for calendar/streak purposes.
// direction:"none" has no goal to satisfy, so it's never "hit".
export function nutrientHit(def, current) {
  if (current == null || def.target == null || !(def.target > 0)) return false;
  if (def.direction === 'min') return current >= def.target;
  if (def.direction === 'max' || def.direction === 'range') return current <= def.target;
  return false;
}

// Calendar cell status for one nutrient on one day, mirroring dayStatus in
// model.js: 'future' | 'pending' (today, nothing yet) | 'hit' | 'miss' |
// 'empty' (no entry logged that day at all — distinct from a real miss).
export function nutrientDayStatus(def, day, key, dateKey, today = todayKey()) {
  if (dateKey > today) return 'future';
  const current = nutrientCurrent(day, key);
  if (current == null) return dateKey === today ? 'pending' : 'empty';
  return nutrientHit(def, current) ? 'hit' : 'miss';
}

// A day "succeeds" only if every home-tile nutrient (energy plus whichever
// others carry display:"always") hit its own goal — missing data for any
// of them means the day doesn't count, same as a tracker's isHit treating
// an absent entry as not-yet-done rather than silently skipping it.
export function allGoalsHit(nutrients, day) {
  const goals = [['energy', nutrients.energy], ...alwaysNutrients(nutrients)].filter(([, def]) => def);
  if (!goals.length) return false;
  return goals.every(([key, def]) => nutrientHit(def, nutrientCurrent(day, key)));
}

export function nutritionCurrentStreak(nutrients, days, today = todayKey()) {
  let d = today;
  if (!allGoalsHit(nutrients, days[d])) d = addDays(d, -1);
  let n = 0;
  while (allGoalsHit(nutrients, days[d])) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export function nutritionLongestStreak(nutrients, days, today = todayKey()) {
  const keys = Object.keys(days).filter((k) => k <= today).sort();
  if (!keys.length) return 0;
  let best = 0;
  let run = 0;
  for (let d = keys[0]; d <= today; d = addDays(d, 1)) {
    if (allGoalsHit(nutrients, days[d])) {
      run++;
      if (run > best) best = run;
    } else if (d !== today) {
      run = 0; // today still in progress doesn't reset the run
    }
  }
  return best;
}

// All-time stats for the nutrition history page. A day counts as "logged"
// if it recorded any totals at all — checked against totals rather than
// entries, since totals (not entries) is what every other reader in this
// module treats as the source of truth for "does this day have data".
export function nutritionStats(data, today = todayKey()) {
  const { nutrients, days } = data;
  let loggedDays = 0;
  let goalsHitDays = 0;
  for (const key in days) {
    if (key > today) continue;
    const totals = days[key] && days[key].totals;
    if (!totals || !Object.keys(totals).length) continue;
    loggedDays++;
    if (allGoalsHit(nutrients, days[key])) goalsHitDays++;
  }
  return {
    loggedDays,
    goalsHitDays,
    currentStreak: nutritionCurrentStreak(nutrients, days, today),
    longestStreak: nutritionLongestStreak(nutrients, days, today),
  };
}
