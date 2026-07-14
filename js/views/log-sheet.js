// Counter logging bottom sheet: spin wheel (primary), preset chips, custom
// amount, +/- quick-adjust stepper, undo last set. Live-updates as the store
// changes; the sheet never re-renders wholesale so the wheel gesture state
// survives every log.

import { todayKey, shortDate } from '../dates.js';
import { entryFor, effectiveTarget, isHit, currentStreak, fmtAmount, roundAmount } from '../model.js';
import { stampFor } from '../store.js';
import { h, icon, haptic, openSheet, toast, countUp, reducedMotion } from '../ui.js';
import { createWheel } from '../wheel.js';
import { openDayEditor } from './day-editor.js';

export function openLogSheet(store, trackerId, dateKey = todayKey()) {
  const t = store.state.trackers[trackerId];
  if (!t || t.type !== 'counter') return;
  const isToday = dateKey === todayKey();
  const fmt = (v) => fmtAmount(t, v);
  const unit = t.unit || '';

  let unsub = null;
  openSheet({
    title: t.name + (isToday ? '' : ` · ${shortDate(dateKey)}`),
    accent: t.color,
    onClose: () => unsub && unsub(),
    build(body, api) {
      const log = (amount) =>
        store.logSet(t.id, dateKey, amount, stampFor(dateKey, entryFor(store.state.days, dateKey, t.id)));
      const totalEl = h('span', { class: 'log-total num' }, '0');
      const goalEl = h('span', { class: 'log-goal num' }, '');
      const metaEl = h('div', { class: 'log-meta num' }, '');

      const wheel = createWheel({
        stepDeg: t.dec ? 36 : 18,
        stepVal: t.dec ? 0.1 : 1,
        round: (x) => roundAmount(t, x),
        onChange: (p) => {
          addBtn.disabled = p <= 0;
          addBtn.textContent = p > 0 ? `Add ${fmt(p)}${unit ? ' ' + unit : ''}` : 'Add';
        },
        onRev: () => haptic(12),
      });
      wheel.format = fmt;

      const addBtn = h('button', {
        class: 'btn btn-accent',
        disabled: true,
        onclick: () => {
          if (wheel.pending <= 0) return;
          log(wheel.pending);
          wheel.reset();
          haptic(18);
        },
      }, 'Add');

      const chips = (t.chips || []).map((c) =>
        h('button', {
          class: 'chip num',
          onclick: () => { log(c); haptic(10); },
        }, `+${fmt(c)}`));

      // custom amount, revealed on demand
      const customInput = h('input', {
        class: 'input num',
        type: 'number',
        inputmode: t.dec ? 'decimal' : 'numeric',
        step: t.dec ? '0.1' : '1',
        min: '0',
        placeholder: unit ? `amount (${unit})` : 'amount',
      });
      const customRow = h('div', { class: 'field-row', style: 'display:none;margin-top:2px' },
        h('div', { class: 'field', style: 'margin:0;flex:1' }, customInput),
        h('button', {
          class: 'btn btn-ghost',
          style: 'width:92px;flex:none',
          onclick: () => {
            const v = roundAmount(t, parseFloat(customInput.value));
            if (!isFinite(v) || v <= 0) { toast('Enter an amount above zero'); return; }
            log(v);
            customInput.value = '';
            haptic(12);
          },
        }, 'Add'));
      const customToggle = h('button', {
        class: 'linklike',
        onclick: () => {
          const show = customRow.style.display === 'none';
          customRow.style.display = show ? 'flex' : 'none';
          if (show) customInput.focus();
        },
      }, 'Custom amount');

      const step = t.dec ? 0.5 : 1;
      const minus = h('button', {
        class: 'step-btn num', 'aria-label': 'subtract one',
        onclick: () => {
          const entry = entryFor(store.state.days, dateKey, t.id);
          if (!entry || (entry.total || 0) <= 0) return;
          log(-Math.min(step, entry.total));
          haptic(8);
        },
      }, '−');
      const plus = h('button', {
        class: 'step-btn num', 'aria-label': 'add one',
        onclick: () => { log(step); haptic(8); },
      }, '+');

      const undoBtn = h('button', {
        class: 'linklike',
        style: 'display:none',
        onclick: () => {
          const gone = store.undoLastSet(t.id, dateKey);
          if (gone) haptic(8);
        },
      }, '');

      const editDay = h('button', {
        class: 'linklike',
        onclick: () => { api.close(); openDayEditor(store, t.id, dateKey); },
      }, 'Edit this day');

      body.append(
        h('div', { class: 'log-today' }, totalEl, goalEl),
        metaEl,
        wheel.el,
        h('div', { class: 'log-actions' },
          addBtn,
          chips.length ? h('div', { class: 'chips', style: 'justify-content:center' }, chips) : null,
          customToggle,
          customRow,
          h('div', { class: 'stepper' },
            minus,
            h('span', { class: 'step-lbl' }, 'quick adjust'),
            plus),
          undoBtn,
          editDay,
        ),
      );

      let lastTotal = null;
      let wasDone = null;
      function update() {
        const entry = entryFor(store.state.days, dateKey, t.id);
        const total = entry ? entry.total || 0 : 0;
        const target = effectiveTarget(t, dateKey, entry);
        const done = isHit(t, entry, dateKey);

        if (lastTotal === null) totalEl.textContent = fmt(total);
        else if (total !== lastTotal) countUp(totalEl, lastTotal, total, (v) => fmt(roundAmount(t, v)));
        lastTotal = total;

        goalEl.textContent = target > 0 ? `/ ${fmt(target)}${unit ? ' ' + unit : ''}` : unit;
        totalEl.classList.toggle('done', done);

        const streak = currentStreak(t, store.state.days, todayKey());
        if (done) {
          metaEl.innerHTML = `<span class="hit">goal hit!</span>${streak > 1 ? ` · \u{1F525} ${streak} day streak` : ''}`;
        } else if (target > 0) {
          metaEl.textContent = `${fmt(roundAmount(t, Math.max(0, target - total)))} to go`;
        } else {
          metaEl.textContent = streak > 0 ? `\u{1F525} ${streak} day streak` : '';
        }

        const sets = entry && entry.sets ? entry.sets : [];
        if (sets.length) {
          let last = sets[0];
          for (const s of sets) if (s.t >= last.t) last = s;
          undoBtn.style.display = '';
          undoBtn.replaceChildren(icon('undo'), ` Undo ${last.a > 0 ? '+' : ''}${fmt(last.a)}`);
          undoBtn.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:6px';
        } else {
          undoBtn.style.display = 'none';
        }

        if (wasDone === false && done) {
          haptic([15, 60, 25]);
          if (!reducedMotion()) {
            totalEl.classList.remove('goalpop');
            void totalEl.offsetWidth;
            totalEl.classList.add('goalpop');
          }
        }
        wasDone = done;
      }
      update();
      unsub = store.subscribe(update);
    },
  });
}
