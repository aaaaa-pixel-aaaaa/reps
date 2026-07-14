// Retro day editor: open ANY day, add/remove sets, nudge the total, toggle a
// habit, or override that single day's goal (0 = declared rest day).
// Streaks/stats need no explicit recompute — they are derived at render time.

import { todayKey, shortDate, timeOf } from '../dates.js';
import {
  entryFor, effectiveTarget, computedTarget, isHit, fmtAmount, roundAmount,
} from '../model.js';
import { stampFor } from '../store.js';
import { h, icon, haptic, openSheet, toast, reducedMotion } from '../ui.js';

export function openDayEditor(store, trackerId, dateKey) {
  const t = store.state.trackers[trackerId];
  if (!t) return;
  if (dateKey > todayKey()) { toast("That day hasn't happened yet"); return; }
  const fmt = (v) => fmtAmount(t, v);
  const unit = t.unit || '';
  const isToday = dateKey === todayKey();

  let unsub = null;
  openSheet({
    title: `${t.name} · ${isToday ? 'Today' : shortDate(dateKey)}`,
    accent: t.color,
    onClose: () => unsub && unsub(),
    build(body, api) {
      const entry = () => entryFor(store.state.days, dateKey, trackerId);
      const stamp = () => stampFor(dateKey, entry());

      if (t.type === 'habit') {
        const status = h('div', { class: 'log-meta num', style: 'margin-bottom:6px' });
        const toggle = h('button', {
          class: 'bigtoggle',
          'aria-label': 'toggle done',
          onclick: () => {
            const nowDone = store.toggleHabit(trackerId, dateKey);
            haptic(nowDone ? [12, 50, 16] : 8);
            if (nowDone && !reducedMotion()) {
              toggle.classList.remove('pop');
              void toggle.offsetWidth;
              toggle.classList.add('pop');
            }
          },
        }, icon('check'));
        body.append(toggle, status);

        const update = () => {
          const done = !!(entry() && entry().done);
          toggle.classList.toggle('done', done);
          status.textContent = done
            ? (isToday ? 'Done today' : `Done on ${shortDate(dateKey)}`)
            : (isToday ? 'Not done yet' : 'Not done');
        };
        update();
        unsub = store.subscribe(update);
        return;
      }

      // ---- counter ----
      const step = t.dec ? 0.5 : 1;
      const totalNum = h('div', { class: 'de-num num' }, '0');
      const minus = h('button', {
        class: 'step-btn num', 'aria-label': 'subtract',
        onclick: () => {
          const e = entry();
          if (!e || (e.total || 0) <= 0) return;
          store.logSet(trackerId, dateKey, -Math.min(step, e.total), stamp());
          haptic(8);
        },
      }, '−');
      const plus = h('button', {
        class: 'step-btn num', 'aria-label': 'add',
        onclick: () => { store.logSet(trackerId, dateKey, step, stamp()); haptic(8); },
      }, '+');

      const chipsRow = h('div', { class: 'chips', style: 'justify-content:center' },
        (t.chips || []).map((c) => h('button', {
          class: 'chip small num',
          onclick: () => { store.logSet(trackerId, dateKey, c, stamp()); haptic(10); },
        }, `+${fmt(c)}`)));

      const amtInput = h('input', {
        class: 'input num', type: 'number', min: '0',
        inputmode: t.dec ? 'decimal' : 'numeric', step: t.dec ? '0.1' : '1',
        placeholder: unit ? `add amount (${unit})` : 'add amount',
      });
      const addRow = h('div', { class: 'field-row', style: 'margin-top:10px' },
        h('div', { class: 'field', style: 'margin:0;flex:1' }, amtInput),
        h('button', {
          class: 'btn btn-ghost', style: 'width:92px;flex:none',
          onclick: () => {
            const v = roundAmount(t, parseFloat(amtInput.value));
            if (!isFinite(v) || v <= 0) { toast('Enter an amount above zero'); return; }
            store.logSet(trackerId, dateKey, v, stamp());
            amtInput.value = '';
            haptic(12);
          },
        }, 'Add'));

      const setTotalInput = h('input', {
        class: 'input num', type: 'number', min: '0',
        inputmode: t.dec ? 'decimal' : 'numeric', step: t.dec ? '0.1' : '1',
        placeholder: 'set exact total',
      });
      const setTotalRow = h('div', { class: 'field-row', style: 'margin-top:10px;display:none' },
        h('div', { class: 'field', style: 'margin:0;flex:1' }, setTotalInput),
        h('button', {
          class: 'btn btn-ghost', style: 'width:92px;flex:none',
          onclick: () => {
            const v = parseFloat(setTotalInput.value);
            if (!isFinite(v) || v < 0) { toast('Enter zero or more'); return; }
            store.setDayTotal(trackerId, dateKey, v, stamp());
            setTotalInput.value = '';
            haptic(12);
          },
        }, 'Set'));
      const setTotalToggle = h('button', {
        class: 'linklike',
        onclick: () => {
          const show = setTotalRow.style.display === 'none';
          setTotalRow.style.display = show ? 'flex' : 'none';
          if (show) setTotalInput.focus();
        },
      }, 'Set exact total…');

      const setsBox = h('div', { class: 'setlist' });

      // goal override
      const goalInfo = h('div', { class: 'grow' });
      const goalBtns = h('div', { style: 'display:flex;gap:6px' });
      const goalRow = h('div', { class: 'goalrow' }, goalInfo, goalBtns);
      const goalInput = h('input', {
        class: 'input num', type: 'number', min: '0',
        inputmode: t.dec ? 'decimal' : 'numeric', step: t.dec ? '0.1' : '1',
        placeholder: 'goal for this day',
      });
      const goalEditRow = h('div', { class: 'field-row', style: 'display:none;margin-top:-4px;margin-bottom:10px' },
        h('div', { class: 'field', style: 'margin:0;flex:1' }, goalInput),
        h('button', {
          class: 'btn btn-ghost', style: 'width:92px;flex:none',
          onclick: () => {
            const v = parseFloat(goalInput.value);
            if (!isFinite(v) || v < 0) { toast('Enter zero or more'); return; }
            store.setGoalOverride(trackerId, dateKey, v);
            goalEditRow.style.display = 'none';
            haptic(12);
          },
        }, 'Set'));

      body.append(
        h('div', { class: 'de-total' },
          minus,
          h('div', {}, totalNum, h('small', { style: 'display:block;text-align:center;font-size:13px;color:var(--dim);font-weight:600' }, unit || 'total')),
          plus),
        chipsRow,
        addRow,
        setTotalToggle,
        setTotalRow,
        goalRow,
        goalEditRow,
        h('div', { class: 'sheet-section' }, 'Logged sets'),
        setsBox,
      );

      function update() {
        const e = entry();
        const total = e ? e.total || 0 : 0;
        totalNum.textContent = fmt(total);

        // goal row
        const target = effectiveTarget(t, dateKey, e);
        const auto = computedTarget(t, dateKey);
        const overridden = !!(e && e.goalOverride != null);
        const hit = isHit(t, e, dateKey);
        goalInfo.replaceChildren(
          h('div', { class: 'g-lbl' }, 'Goal this day'),
          h('div', { class: 'g-val num', style: hit ? 'color:var(--c)' : '' },
            target > 0 ? `${fmt(target)}${unit ? ' ' + unit : ''}` : (overridden ? 'Rest day' : 'none'),
            hit ? '  ✓' : ''),
          h('div', { class: 'g-note' },
            overridden ? `overridden for this day only (usually ${fmt(auto)})` : 'from tracker settings'),
        );
        goalBtns.replaceChildren(
          h('button', {
            class: 'chip small num',
            onclick: () => {
              goalInput.value = target || '';
              goalEditRow.style.display = 'flex';
              goalInput.focus();
            },
          }, 'Edit'),
          overridden
            ? h('button', {
                class: 'chip small',
                onclick: () => { store.setGoalOverride(trackerId, dateKey, null); haptic(8); },
              }, 'Reset')
            : h('button', {
                class: 'chip small',
                onclick: () => { store.setGoalOverride(trackerId, dateKey, 0); haptic(8); toast('Rest day — streak safe'); },
              }, 'Rest day'),
        );

        // sets
        setsBox.replaceChildren();
        const sets = e && e.sets ? e.sets : [];
        if (!sets.length) {
          setsBox.append(h('div', { style: 'color:var(--faint);font-size:13.5px;padding:6px 2px 12px' },
            'Nothing logged this day yet.'));
        } else {
          sets.forEach((s, i) => {
            setsBox.append(h('div', { class: 'setrow' },
              h('span', { class: 'amt num', style: s.a < 0 ? 'color:var(--dim)' : '' },
                `${s.a > 0 ? '+' : ''}${fmt(s.a)}`),
              h('span', { class: 'when num' }, timeOf(s.t)),
              h('button', {
                class: 'del', 'aria-label': 'delete set',
                onclick: () => { store.removeSet(trackerId, dateKey, i); haptic(8); },
              }, icon('trash')),
            ));
          });
        }
      }
      update();
      unsub = store.subscribe(update);
    },
  });
}
