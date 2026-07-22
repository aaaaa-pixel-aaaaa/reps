// Read-only sync for the externally-maintained nutrition.json. This file is
// never written by the app — there is no mutation API here, only a getter
// and a refresh trigger. Fetch on load and whenever the tab becomes visible
// again so reopening the installed app picks up edits made outside it; the
// last successful response is cached under its own localStorage key (never
// touching the tracker datastore) so the tile still has something to show
// offline. A failed or offline fetch fails silently — this is secondary to
// the trackers, so it never blocks startup or shows an error.

const NUTRITION_URL = 'https://raw.githubusercontent.com/aaaaa-pixel-aaaaa/reps/main/nutrition.json';
const CACHE_KEY = 'reps_nutrition_cache_v1';

let data = null;
const listeners = new Set();

function loadCached() {
  try {
    const json = localStorage.getItem(CACHE_KEY);
    if (json) data = JSON.parse(json);
  } catch { /* corrupted cache — wait for a fresh fetch instead */ }
}

function looksValid(json) {
  return json && typeof json === 'object' &&
    json.nutrients && typeof json.nutrients === 'object' &&
    json.days && typeof json.days === 'object' &&
    json.alertRules && typeof json.alertRules === 'object';
}

export function nutritionData() {
  return data;
}

export function subscribeNutrition(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function refreshNutrition() {
  try {
    const res = await fetch(NUTRITION_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const json = await res.json();
    if (!looksValid(json)) return;
    data = json;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(json)); } catch { /* quota: keep running in memory */ }
    for (const fn of listeners) fn();
  } catch {
    /* offline or blocked — the cached copy (if any) keeps serving */
  }
}

loadCached();
