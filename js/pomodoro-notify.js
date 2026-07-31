// Pomodoro phase-change notifications. `new Notification()` doesn't produce
// a real lock-screen/notification-centre entry in iOS home-screen PWAs —
// showNotification() via the service worker registration does, so that's
// the only path used here. Falls back to an in-app chime alone when
// permission was never granted (or was denied) — never blocks, never throws.

const TAG_PREFIX = 'reps-pomodoro-';

export function pomodoroNotificationsSupported() {
  return typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
}

// Must be called from within a user gesture's own call stack (a click
// handler) — that's the only place iOS Safari will actually show the
// permission prompt, and this must never run on its own on page load.
// A no-op once the user has already answered either way.
export function requestPomodoroPermission() {
  if (!pomodoroNotificationsSupported() || Notification.permission !== 'default') return;
  Notification.requestPermission().catch(() => { /* dismissed/blocked: fall back silently */ });
}

function phaseCopy(tracker, phase, pomodoro) {
  if (phase === 'work') return { title: tracker.name, body: `Back to work — ${pomodoro.workMins} min` };
  if (phase === 'longBreak') return { title: tracker.name, body: `Long break — ${pomodoro.longBreakMins} min` };
  return { title: tracker.name, body: `Break — ${pomodoro.breakMins} min` };
}

// One call per phase change: always chimes (if the screen is on), and
// additionally raises a system notification when permission allows it —
// `renotify` + a per-tracker tag so a second tracker's phase change doesn't
// get silently swallowed by the first's still-visible notification, but the
// same tracker's own notifications replace each other rather than stacking.
export function firePomodoroNotification(tracker, phase, pomodoro) {
  playChime();
  if (!pomodoroNotificationsSupported() || Notification.permission !== 'granted') return;
  const { title, body } = phaseCopy(tracker, phase, pomodoro);
  navigator.serviceWorker.ready.then((reg) => {
    reg.showNotification(title, {
      body,
      tag: TAG_PREFIX + tracker.id,
      renotify: true,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { trackerId: tracker.id },
    });
  }).catch(() => { /* no active SW registration yet: chime already played */ });
}

// A short synthesized two-note chime — no audio asset, no dependency.
// Plays even without notification permission (it's the only cue in that
// case) but only while the screen is actually on and the tab is visible:
// a notification the user isn't looking at is the point of the system
// notification above; a chime for a backgrounded tab would just be a
// sound with no context to explain it.
let audioCtx = null;
export function playChime() {
  if (typeof document !== 'undefined' && document.hidden) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = audioCtx || new Ctx();
    const t0 = audioCtx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const start = t0 + i * 0.16;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.24);
    });
  } catch { /* Web Audio unavailable/blocked: a missed chime isn't fatal */ }
}
