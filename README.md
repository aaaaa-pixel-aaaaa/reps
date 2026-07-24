# Reps

A satisfying, offline-first goal & habit tracker. Built as a static PWA —
vanilla HTML/CSS/JS ES modules, no build step, no frameworks, no network
dependencies after first load. Designed for iOS Safari as an
Add-to-Home-Screen app.

## What it does

- **Counters** accumulate an amount per day toward a daily target (reps, km,
  pages…) with preset chips, a drag-to-spin wheel for logging, undo, and
  optional auto-progression (target grows daily or weekly from an anchor
  date).
- **Habits** are one satisfying tap per day; streaks count consecutive days.
- **Groups** organise trackers Chrome-tab-group style: colour, collapse,
  reorder, pin.
- **Priority** trackers/groups sort first; priority trackers live as big
  cards on Home.
- **Retro editing**: open any past day from a tracker's calendar — add/remove
  sets, set the exact total, toggle done, or override that single day's goal
  (`0` = rest day, streak-safe). Streaks and stats recompute automatically.
- **History** per tracker: Monday-start month calendar coloured by status,
  all-time stats, full day log.
- **Backup**: one tap exports `reps-backup-YYYY-MM-DD.json` via the share
  sheet (iOS offers "Save to Files") or a download; validated import
  restores it. Home nudges gently when backups go stale.
- **Nutrition** (optional, read-only): a wide tile below the pinned trackers
  summarises today's energy and macros against an externally-maintained diet
  target file, colour-coded and with a warnings strip when a nutrient's been
  off for several days. See [Nutrition](#nutrition) below.

Data lives in `localStorage` under a single key (`reps_v1`), saved on every
change. `?demo=1` opens a separate throwaway dataset with weeks of generated
history.

## Nutrition

A second, independent feature layered on top of the tracker app: a home
screen tile and detail sheet that read a diet-target file maintained
**outside this repo** and render it alongside the trackers. It is
**read-only end to end — the app never writes to nutrition.json, and there
is no editing UI for it.** Whatever logs the food (a script, a spreadsheet
export, a human editing the file by hand) is entirely someone else's
problem; Reps only displays it.

### Where the data comes from

`js/nutrition-store.js` fetches
`https://raw.githubusercontent.com/<user>/reps/main/nutrition.json` on load
and whenever the tab becomes visible again (so reopening the installed app
picks up edits made elsewhere), with `cache: 'no-store'` so the browser's
HTTP cache can't go stale either. The last successful response is cached
under its own `localStorage` key (`reps_nutrition_cache_v1`) — a separate
key from the tracker data (`reps_v1`), never mixed into it — so the tile
still has something to show offline. A failed or offline fetch fails
silently: no error dialog, no blocked startup, the tile just doesn't appear
(or keeps showing the last cached copy) until the next successful fetch.
`sw.js` mirrors this at the service-worker level — everything else in the
app is cache-first, but this one URL is fetched network-first with a cache
fallback, since cache-first would mean an installed app could never see
updates to a file it doesn't control the deploys of.

### Schema

```jsonc
{
  "schema": 6,
  "updatedAt": "...", "timezone": "...",
  "profile": { "sex", "ageBand", "weightKg", "goal", "sources": [...], "notes": [...] },
  "alertRules": { "windowDays", "qualifyingDaysRequired", "lowThresholdPct",
                   "highThresholdPct", "minCoveragePct", "minConfidence",
                   "allowedTargetConfidence": [...] },
  "nutrients": {
    "<key>": {
      "label", "unit", "target", "direction", "group", "display",
      "targetConfidence", "source",
      "softMax": "optional — the overshoot point where a max/range nutrient is clearly too high",
      "targetMin": "optional — published lower bound of a dietary range (e.g. AMDR)",
      "targetMax": "optional — published upper bound of a dietary range",
      "upperLimit": "optional — Tolerable Upper Intake Level, a SAFETY ceiling, distinct from targetMax",
      "upperLimitNote": "optional — caveat, e.g. many ULs apply only to supplemental forms",
      "upperLimitSource": "optional — provenance for upperLimit",
      "note": "optional — a caveat about this target, surfaced on tap"
    }
  },
  "days": {
    "YYYY-MM-DD": {
      "entries": [{ "item", "qty", "time?", "macroConfidence", "microConfidence", "nutrients": { "<key>": value } } ],
      "totals": { "<key>": value },
      "coverage": { "<key>": "0-100" }
    }
  }
}
```

`targetMin`/`targetMax` are only present where a real published range exists
(currently the AMDR for carbs and fat) — the app never synthesises a band by
scaling `target`; a missing bound is information, not a gap to fill in.
`upperLimit` is present for 16 nutrients, each at least 2.2x its own target,
so ordinary diet alone never approaches it — it only matters once
supplements are in the picture. A `null` `upperLimit` (or `targetMin`/
`targetMax`) is itself a finding — ten nutrients carry an `upperLimitNote`
explaining why no UL is determinable, and the app surfaces that note rather
than treating the absence as missing data.

- `direction` — `"min"` (want at least this much), `"max"` (want at most),
  `"range"` (both a floor and a ceiling matter, but only the ceiling is ever
  alerted on — see below), or `"none"` (context only, no target to judge
  against — e.g. total sugars, cholesterol).
- `display` — `"always"` puts it on the home tile (energy plus whichever
  other nutrients have `display:"always"` — currently protein, carbs, fat,
  fibre); `"monitor"` means detail-sheet only. The tile is driven entirely
  off this field, not a hardcoded list — if the feed ever adds or drops an
  "always" nutrient, the tile follows without a code change.
- `group` — `"macro"`, `"fat"`, `"mineral"`, or `"vitamin"`; groups the
  detail sheet's collapsible sections, in that order.
- **A nutrient absent from an entry or a day's `totals` means unknown, not
  zero.** The app is careful to keep that distinction visible everywhere:
  an unlogged nutrient shows a dash and a "?" coverage marker, never "0".

### targetConfidence

How much to trust the target itself (not the logged data):

| Value          | Meaning                                                              |
|----------------|-----------------------------------------------------------------------|
| `confirmed`    | Verified directly against a named national reference (NHMRC/NRV, US DRI, FSANZ). |
| `guideline`    | A general public-health guideline (e.g. WHO's <10% added sugar), not a per-person RDI. |
| `derived`      | Calculated from the profile (e.g. protein target from bodyweight, energy from the NRV EER range) rather than looked up directly. |
| `unconfirmed`  | No verified source exists yet (in the current feed: omega-3 EPA+DHA+DPA, an Australian Suggested Dietary Target with no equivalent US figure). |

A nutrient with `targetConfidence` outside `alertRules.allowedTargetConfidence`
still displays fully — bars, coverage, notes, everything — it just never
triggers a warning, and gets a small "?" marker in the detail sheet making
that explicit.

### Alert rules

A day **qualifies** for a given nutrient only if `coverage[key]` clears
`minCoveragePct` *and* the day's logged entries clear `minConfidence` —
using `macroConfidence` for the `macro`/`fat` groups, `microConfidence` for
`mineral`/`vitamin`. Confidence is recorded per entry, not per day, so a
day's confidence is its **worst** entry's: one low-confidence guess is
enough to make the whole day untrustworthy for alerting, even if coverage
looks complete. Non-qualifying days are simply skipped — they neither
extend nor break anything.

An alert fires once `qualifyingDaysRequired` qualifying days inside the
trailing `windowDays` breach the threshold in that nutrient's direction:
below `lowThresholdPct` of target for `"min"`, above `highThresholdPct` for
`"max"` **or** `"range"` (a range nutrient's low side is never alerted on,
only its ceiling — the low side just isn't policed the same way a strict
minimum is). `direction:"none"` and disallowed `targetConfidence` nutrients
never alert, per above.

`upperLimit` breaches work differently: a single qualifying day over the
ceiling is enough to alert (`computeUpperLimitAlerts`, not the
`qualifyingDaysRequired` tally above) — a safety finding isn't a trend to
wait out. It's still gated on the same day-qualification rule, since an
unqualified day's reading isn't trustworthy enough to accuse it of
anything, safety included. A nutrient with `upperLimit: null` can never
raise this alert. In the detail sheet these get distinct, more serious
wording and a stronger visual treatment than an ordinary target/band
breach, and surface `upperLimitNote` directly (not behind a tap) since most
ULs concern supplemental forms only and that caveat matters.

The tile shows nothing when there are no alerts (no "all good" banner —
calm by default) and a single slim strip along the bottom edge when there
are: the specific nutrient and count for one alert ("Magnesium low — 6 of
last 10 days", or "Zinc over the safe upper limit" for a UL breach), a
plain count for several ("3 nutrients need attention"), upperLimit alerts
listed first as the more serious kind. Tapping it opens the detail sheet
scrolled to the warnings.

### The scale, and the satisfied band

Every nutrient bar (and, radially, the home tile's energy ring) is drawn by
one shared function, `renderNutrientBar` (`js/views/nutrition.js`) — every
surface that shows a nutrient calls it, so no two surfaces can ever
disagree about what a nutrient's bar looks like. It reads a single pure-math
model, `nutrientBarModel` (`js/nutrition.js`), that turns a nutrient's
definition plus its current value into a rail, a "satisfied" band, a fill
fraction, and a colour — no DOM, fully unit-tested.

The rail a bar/ring is drawn against always spans `[0, railMax]`:

```
base    = (direction === "min") ? target : (softMax ?? targetMax ?? target)
railMax = base / 0.85
if (upperLimit && current >= 0.6 * upperLimit) railMax = upperLimit / 0.9
if (current > railMax) railMax = current / 0.95
```

The middle rule is deliberate: every `upperLimit` is at least 2.2x its
target, so from food alone the ceiling never appears on the rail and never
clutters it — it only enters once intake actually approaches it (i.e. once
supplements are plausibly involved). The last rule just guarantees the
current reading never clips past the rail's own edge.

Within that rail, a **satisfied band** replaces the old fixed tick marker
at the target — a section of rail with more contrast than the empty track:

```
"min"    band = [target, upperLimit ?? railMax]
"max"    band = [0, target]
"range"  band = [targetMin ?? target, targetMax ?? softMax ?? target]
"none"   no band
```

(Energy is `"range"` with `targetMin: null` and no `targetMax`, only a
`softMax` — so its band runs `target` to `softMax`, reading as satisfied
anywhere from 3100 to 3500 kcal and only warming past that, rather than
collapsing to a single point at `target`.)

Where the fill ends relative to the band is the whole message: short of it
means under, inside means satisfied, past it means over — there's no
separate marker to read. A band whose end **is** the nutrient's own
`upperLimit` is a *hard* ceiling: the rail beyond it is rendered in a low-
opacity red tint, distinguishing a safety limit from an ordinary dietary
bound without needing a legend. A soft ceiling (`targetMax`/`softMax`)
leaves the rail past it neutral.

### Colour

Each nutrient gets its own accent hue, deterministically derived from its
key (not hand-picked — there are ~34 of them) so distinct nutrients are
visually distinguishable without a maintained palette. Chroma (not hue)
tracks *goodness*, not magnitude: 0.15 (near-grey, never fully flat) ramping
to 1.0 (fully saturated) as current climbs from 0 to the band's start, then
full saturation anywhere inside or past the band. Width tracks
`current / railMax` directly — no artificial 100% freeze.

Past the band's end, the *hue* rotates toward red instead: full red at
`softMax` if one exists, otherwise instantly at a hard ceiling (exceeding a
safety limit is binary, not a matter of degree — see above), otherwise at
1.25x the band's end. Exceeding a `"min"` target with no `upperLimit` never
reddens at all — going over a floor with nothing above it to be careful of
is purely good, however far past it you are (fibre at 150% must not look
like a warning). Colour is computed in `oklch()` where the browser supports
it (Safari 16.4+), falling back to `hsl()` otherwise — feature-detected via
`CSS.supports()` — and never relies on hue alone: a small direction glyph
(`↑` min, `↓` max, `↕` range) prefixes every nutrient's label everywhere it
appears, as a colour-independent fallback.

### targetMax vs upperLimit

They read similarly (both a ceiling) but mean different things, and the app
treats them very differently:

- **`targetMax`** (and `targetMin`) describe a *dietary* range — the AMDR
  band for carbs and fat, for instance. Landing outside it is worth noting
  but not alarming; it feeds the same trailing-window streak alert as any
  other target breach (see below).
- **`upperLimit`** is a *safety* ceiling (the Tolerable Upper Intake
  Level) — how much of a nutrient is known to become harmful, mostly
  relevant once supplements are involved rather than food alone. Breaching
  it fires its own, more serious alert **immediately** on a single
  qualifying day, not after a run of several — see Alert rules above.

## Development

Serve statically (any server) and open:

```
python -m http.server 8000       # or: npx http-server
```

Run the unit tests (date math, streaks, store mutations, wheel math,
nutrition bar-fill/alert math):

```
node tests/run-tests.mjs
```

Icons are generated by `tools/make-icons.ps1` (outputs committed).

When you change any shipped file, bump `VERSION` in `sw.js` so installed
apps pick up the update.

## Deploy to GitHub Pages

```
git push origin main
```

Then on GitHub: **Settings → Pages → Source: Deploy from a branch →
Branch: `main` / `/ (root)` → Save**. The app appears at
`https://<user>.github.io/reps/` after a minute or two.

## Install on iPhone

1. Open the GitHub Pages URL in Safari.
2. Share button → **Add to Home Screen**.
3. Launch from the icon — it runs standalone, fully offline, with the
   near-black theme and safe-area padding.

Because data is per-browser, use **Settings → Save backup** before clearing
Safari data or moving phones, then **Import backup** on the new device.
