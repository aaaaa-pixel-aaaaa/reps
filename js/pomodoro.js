// The one place that ties store.checkPomodoroPhases() (pure data — did any
// tracker's phase elapse?) to the user-visible side effect of telling them
// about it. Called from app.js on load and on visibilitychange, and from
// the log-sheet's own repaint tick while a Pomodoro session's sheet is open
// — so a boundary crossed while actively watching the countdown advances
// immediately instead of waiting for the next visibilitychange.
import { firePomodoroNotification } from './pomodoro-notify.js';

export function checkAndNotifyPomodoro(store) {
  const changed = store.checkPomodoroPhases();
  for (const { tracker, phase } of changed) {
    firePomodoroNotification(tracker, phase, tracker.pomodoro);
  }
  return changed;
}
