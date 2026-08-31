// App entry: builds the store, owns routing (location.hash) and the single
// render path. Views are pure "state -> DOM" functions re-run on any change.

import { createStore, STORAGE_KEY, DEMO_KEY, demoState, seedState } from './store.js';
import { renderHome } from './views/home.js';
import { renderHistory } from './views/history.js';
import { h } from './ui.js';
import { refreshNutrition, subscribeNutrition, nutritionData } from './nutrition-store.js';
import { renderNutritionHistory } from './views/nutrition.js';
import { renderClassesHistory, renderClassesOverview } from './views/classes.js';
import { checkAndNotifyPomodoro } from './pomodoro.js';

const params = new URLSearchParams(location.search);
const demo = params.get('demo') === '1';

export const store = createStore({
  storage: localStorage,
  key: demo ? DEMO_KEY : STORAGE_KEY,
  seed: demo ? demoState : seedState,
});
window.__reps = store; // console access for debugging/rescue
window.__nutrition = { get: nutritionData, refresh: refreshNutrition }; // read-only — see nutrition-store.js

const viewEl = document.getElementById('view');
const scrollMemo = new Map();
let currentRoute = '';

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name, arg] = hash.split('/');
  if (name === 't' && arg && store.state.trackers[arg]) {
    return { name: 'history', trackerId: arg };
  }
  if (name === 'nutrition') {
    return { name: 'nutrition-history' };
  }
  if (name === 'classes') {
    return arg && store.state.classes[arg]
      ? { name: 'classes-history', classId: arg }
      : { name: 'classes-overview' };
  }
  return { name: 'home' };
}

export function navigate(hash) {
  if (('#' + hash).replace(/^##/, '#') === location.hash) return render();
  location.hash = hash;
}

function render() {
  const route = parseRoute();
  const routeKey = route.name + (route.trackerId || route.classId || '');
  if (routeKey !== currentRoute) scrollMemo.set(currentRoute, window.scrollY);
  viewEl.replaceChildren();
  if (route.name === 'history') {
    renderHistory(viewEl, store, route.trackerId);
  } else if (route.name === 'nutrition-history') {
    renderNutritionHistory(viewEl);
  } else if (route.name === 'classes-history') {
    renderClassesHistory(viewEl, store, route.classId);
  } else if (route.name === 'classes-overview') {
    renderClassesOverview(viewEl, store);
  } else {
    renderHome(viewEl, store, { demo });
  }
  const y = routeKey !== currentRoute ? (scrollMemo.get(routeKey) ?? 0) : window.scrollY;
  currentRoute = routeKey;
  window.scrollTo(0, y);
}

// Coalesce bursts of mutations into one render per frame.
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

store.subscribe(scheduleRender);
subscribeNutrition(scheduleRender);
window.addEventListener('hashchange', render);

// Re-render when the app resumes on a new day (iOS keeps PWAs suspended for
// ages; "today" must not go stale). Also re-fetch nutrition.json here —
// it's maintained outside the app, so reopening from the home screen is
// the natural moment to pick up edits made elsewhere — and catch up any
// Pomodoro phase(s) that elapsed while suspended (a locked phone gets no
// setInterval ticks, so this is the moment that catch-up has to happen).
let lastRenderDay = new Date().getDate();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  refreshNutrition();
  checkAndNotifyPomodoro(store);
  if (new Date().getDate() !== lastRenderDay) {
    lastRenderDay = new Date().getDate();
    render();
  }
});

// A notification's own click is handled by the service worker (it owns
// focusing/opening the window), which then hands the tracker id back here
// via postMessage so the already-open app can navigate to it.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'pomodoro-notification-click' && e.data.trackerId) {
      navigate(`t/${e.data.trackerId}`);
    }
  });
}

refreshNutrition();
checkAndNotifyPomodoro(store);
render();
