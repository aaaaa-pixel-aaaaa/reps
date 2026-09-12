// Exam reminder notifications — same constraint pomodoro-notify.js
// documents: this is a static, backend-less app, so there's no way to push
// a notification to a closed app from a server. What this *can* do is
// catch up on any reminder whose moment has passed as soon as the app is
// next opened or foregrounded (see checkAndNotifyExams, called from
// app.js) — reliable for something opened somewhat regularly, silent for
// weeks of not touching the app at all.

import { classTimeRange } from './classes.js';

const TAG_PREFIX = 'reps-exam-';

export function examNotificationsSupported() {
  return typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
}

// Same user-gesture rule as requestPomodoroPermission: call this only from
// inside a click handler (the exam editor's own "This is an exam" toggle),
// never on load.
export function requestExamPermission() {
  if (!examNotificationsSupported() || Notification.permission !== 'default') return;
  Notification.requestPermission().catch(() => { /* dismissed/blocked: falls back to calendar-only */ });
}

function offsetCopy(offset) {
  if (offset === 0) return 'today';
  if (offset === 1) return 'tomorrow';
  return `in ${offset} days`;
}

function fireExamNotification(exam, offset) {
  navigator.serviceWorker.ready.then((reg) => {
    reg.showNotification(`${exam.name} ${offsetCopy(offset)}`, {
      body: `${classTimeRange(exam)}${exam.location ? ' · ' + exam.location : ''}`,
      tag: TAG_PREFIX + exam.id,
      renotify: true,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { classId: exam.id },
    });
  }).catch(() => { /* no active SW registration yet: nothing else to fall back to */ });
}

// Ties store.checkExamReminders() (pure data: which reminders are newly
// due) to the notification side effect — same split pomodoro.js's own
// checkAndNotifyPomodoro makes one level up. Called from app.js on load
// and on visibilitychange.
export function checkAndNotifyExams(store) {
  const due = store.checkExamReminders();
  if (!due.length || !examNotificationsSupported() || Notification.permission !== 'granted') return due;
  for (const { exam, offset } of due) fireExamNotification(exam, offset);
  return due;
}
