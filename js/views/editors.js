// Create/edit sheets for trackers and groups, plus the "..." options sheets
// (pin, reorder, move to group, archive, delete).

import { todayKey, isValidKey } from '../dates.js';
import { reorderContext, sortedGroups } from '../model.js';
import { PALETTE } from '../store.js';
import { h, icon, haptic, openSheet, confirmSheet, toast } from '../ui.js';

// ---- small form builders ----

function field(label, control, hint) {
  return h('div', { class: 'field' },
    h('label', {}, label),
    control,
    hint ? h('div', { class: 'hint' }, hint) : null);
}

function segmented(options, value, onChange) {
  const seg = h('div', { class: 'seg' });
  const paint = (v) => {
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  };
  for (const o of options) {
    seg.append(h('button', {
      dataset: { v: o.value },
      onclick: () => { paint(o.value); haptic(6); onChange(o.value); },
    }, o.label));
  }
  paint(value);
  return seg;
}

function switchRow(label, sub, value, onChange) {
  const sw = h('button', {
    class: `switch ${value ? 'on' : ''}`,
    role: 'switch',
    'aria-checked': String(!!value),
    'aria-label': label,
    onclick: () => {
      const on = !sw.classList.contains('on');
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-checked', String(on));
      haptic(6);
      onChange(on);
    },
  });
  return h('div', { class: 'switchrow' },
    h('div', {}, h('div', { class: 'lbl' }, label), sub ? h('div', { class: 'sub' }, sub) : null),
    sw);
}

function swatchPicker(value, onChange) {
  const row = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Accent colour' });
  for (const c of PALETTE) {
    const b = h('button', {
      class: `swatch ${c === value ? 'on' : ''}`,
      style: `background:${c}`,
      role: 'radio',
      'aria-checked': String(c === value),
      'aria-label': c,
      onclick: () => {
        row.querySelectorAll('.swatch').forEach((s) => {
          s.classList.toggle('on', s === b);
          s.setAttribute('aria-checked', String(s === b));
        });
        haptic(6);
        onChange(c);
      },
    });
    row.append(b);
  }
  return row;
}

// ---- tracker editor ----

export function openTrackerEditor(store, trackerId = null, presets = {}) {
  const existing = trackerId ? store.state.trackers[trackerId] : null;
  const f = existing
    ? JSON.parse(JSON.stringify(existing))
    : {
        name: '', color: PALETTE[Object.keys(store.state.trackers).length % PALETTE.length],
        type: 'counter', groupId: presets.groupId || null, priority: false,
        unit: '', dec: false,
        target: { base: 0, mode: 'none', inc: 0, start: todayKey() },
        chips: [],
      };
  if (f.type === 'counter') {
    f.target = f.target || { base: 0, mode: 'none', inc: 0, start: todayKey() };
  }

  openSheet({
    title: existing ? `Edit ${existing.name}` : 'New tracker',
    accent: f.color,
    build(body, api) {
      const nameInput = h('input', {
        class: 'input', type: 'text', maxlength: '40',
        placeholder: f.type === 'habit' ? 'e.g. Stretch' : 'e.g. Push-ups',
      });
      nameInput.value = f.name;
      nameInput.addEventListener('input', () => { f.name = nameInput.value; });

      const counterBox = h('div', {});
      const progBox = h('div', {});

      function renderProg() {
        progBox.replaceChildren();
        if (f.type !== 'counter' || f.target.mode === 'none') return;
        const incInput = h('input', {
          class: 'input num', type: 'number', min: '0',
          step: f.dec ? '0.1' : '1', inputmode: f.dec ? 'decimal' : 'numeric',
        });
        incInput.value = f.target.inc || '';
        incInput.addEventListener('input', () => { f.target.inc = parseFloat(incInput.value) || 0; });
        const dateInput = h('input', { class: 'input num', type: 'date' });
        dateInput.value = f.target.start || todayKey();
        dateInput.addEventListener('input', () => {
          if (isValidKey(dateInput.value)) f.target.start = dateInput.value;
        });
        progBox.append(h('div', { class: 'field-row' },
          field(`+ per ${f.target.mode === 'daily' ? 'day' : 'week'}`, incInput),
          field('starting from', dateInput),
        ), h('div', { class: 'hint', style: 'margin-top:-6px' },
          'Target grows automatically from the start date. Set it to today to restart the climb.'));
      }

      function renderCounterFields() {
        counterBox.replaceChildren();
        if (f.type !== 'counter') return;
        const unitInput = h('input', { class: 'input', type: 'text', maxlength: '16', placeholder: 'reps, km, pages…' });
        unitInput.value = f.unit || '';
        unitInput.addEventListener('input', () => { f.unit = unitInput.value; });

        const targetInput = h('input', {
          class: 'input num', type: 'number', min: '0',
          step: f.dec ? '0.1' : '1', inputmode: f.dec ? 'decimal' : 'numeric',
        });
        targetInput.value = f.target.base || '';
        targetInput.addEventListener('input', () => { f.target.base = parseFloat(targetInput.value) || 0; });

        const chipsInput = h('input', {
          class: 'input num', type: 'text', inputmode: f.dec ? 'decimal' : 'numeric',
          placeholder: 'e.g. 10, 15, 20',
        });
        chipsInput.value = (f.chips || []).join(', ');
        chipsInput.addEventListener('input', () => {
          f.chips = chipsInput.value.split(/[,\s]+/).map(parseFloat)
            .filter((n) => isFinite(n) && n > 0).slice(0, 8);
        });

        counterBox.append(
          h('div', { class: 'field-row' },
            field('unit', unitInput),
            field('daily target', targetInput, ''),
          ),
          switchRow('Decimal amounts', 'for distances like 2.5 km', !!f.dec, (on) => {
            f.dec = on;
            renderCounterFields();
            renderProg();
          }),
          field('quick-add chips', chipsInput, 'comma-separated amounts shown as one-tap buttons'),
          field('target progression', segmented([
            { value: 'none', label: 'Off' },
            { value: 'daily', label: 'Daily' },
            { value: 'weekly', label: 'Weekly' },
          ], f.target.mode, (v) => {
            f.target.mode = v;
            if (v !== 'none' && !f.target.start) f.target.start = todayKey();
            renderProg();
          })),
          progBox,
        );
        renderProg();
      }

      const groupSelect = h('select', { class: 'input' },
        h('option', { value: '' }, 'Ungrouped'),
        sortedGroups(store.state).map((g) =>
          h('option', { value: g.id, selected: f.groupId === g.id }, g.name)),
      );
      groupSelect.value = f.groupId || '';
      groupSelect.addEventListener('change', () => { f.groupId = groupSelect.value || null; });

      body.append(
        field('name', nameInput),
        existing
          ? null
          : field('type', segmented([
              { value: 'counter', label: 'Counter' },
              { value: 'habit', label: 'Habit  ✓' },
            ], f.type, (v) => {
              f.type = v;
              nameInput.placeholder = v === 'habit' ? 'e.g. Stretch' : 'e.g. Push-ups';
              renderCounterFields();
            })),
        field('colour', swatchPicker(f.color, (c) => { f.color = c; api.setAccent(c); })),
        counterBox,
        field('group', groupSelect),
        switchRow('Pin to top', 'priority trackers live on the Home screen', !!f.priority,
          (on) => { f.priority = on; }),
        h('button', {
          class: 'btn btn-accent',
          style: 'margin-top:8px',
          onclick: () => {
            if (!f.name.trim()) { toast('Give it a name first'); return; }
            if (existing) {
              store.updateTracker(trackerId, f);
              toast('Saved');
            } else {
              store.addTracker(f);
              toast(`${f.name.trim()} added`);
            }
            haptic(14);
            api.close();
          },
        }, existing ? 'Save changes' : 'Create tracker'),
      );
      renderCounterFields();
      if (!existing) setTimeout(() => nameInput.focus(), 350);
    },
  });
}

// ---- group editor ----

export function openGroupEditor(store, groupId = null, onSaved = null) {
  const existing = groupId ? store.state.groups[groupId] : null;
  const f = existing
    ? { ...existing }
    : { name: '', color: PALETTE[(Object.keys(store.state.groups).length + 4) % PALETTE.length], priority: false };

  openSheet({
    title: existing ? `Edit ${existing.name}` : 'New group',
    accent: f.color,
    build(body, api) {
      const nameInput = h('input', { class: 'input', type: 'text', maxlength: '30', placeholder: 'e.g. Fitness' });
      nameInput.value = f.name;
      nameInput.addEventListener('input', () => { f.name = nameInput.value; });
      body.append(
        field('name', nameInput),
        field('colour', swatchPicker(f.color, (c) => { f.color = c; api.setAccent(c); })),
        switchRow('Pin to top', 'priority groups sort first', !!f.priority, (on) => { f.priority = on; }),
        h('button', {
          class: 'btn btn-accent',
          style: 'margin-top:8px',
          onclick: () => {
            if (!f.name.trim()) { toast('Give it a name first'); return; }
            let id = groupId;
            if (existing) store.updateGroup(groupId, f);
            else id = store.addGroup(f);
            haptic(14);
            api.close();
            onSaved && onSaved(id);
          },
        }, existing ? 'Save changes' : 'Create group'),
      );
      if (!existing) setTimeout(() => nameInput.focus(), 350);
    },
  });
}

// ---- tracker options ----

// `context` says which list the menu was opened from — 'pinned' (Home strip)
// or 'group' (a group section) — so Move up/down reorders what you're seeing.
export function openTrackerOptions(store, trackerId, context) {
  const t = store.state.trackers[trackerId];
  if (!t) return;
  if (!context) context = t.priority ? 'pinned' : 'group';

  openSheet({
    title: t.name,
    accent: t.color,
    build(body, api) {
      const opt = (ic, label, onclick, opts = {}) =>
        h('button', { class: `opt ${opts.danger ? 'danger' : ''}`, onclick },
          icon(ic), h('span', { class: 'grow' }, label),
          opts.note ? h('span', { class: 'opt-note' }, opts.note) : null);

      const pinLabel = () => (store.state.trackers[trackerId].priority ? 'Unpin from top' : 'Pin to top');
      const pinBtn = opt(t.priority ? 'starFill' : 'star', pinLabel(), () => {
        const cur = store.state.trackers[trackerId];
        store.setTrackerPriority(trackerId, !cur.priority);
        haptic(10);
        pinBtn.querySelector('.grow').textContent = pinLabel();
        toast(store.state.trackers[trackerId].priority ? 'Pinned to Home' : 'Unpinned');
      });

      const move = (dir) => () => {
        const cur = store.state.trackers[trackerId];
        const { list, field } = reorderContext(store.state, cur, context);
        const moved = store.reorderTracker(trackerId, dir, list, field);
        haptic(moved ? 10 : 0);
        if (!moved) toast(dir < 0 ? 'Already first' : 'Already last');
      };

      body.append(h('div', { class: 'opt-list' },
        opt('cal', 'History & stats', () => { api.close(); location.hash = `t/${trackerId}`; }),
        opt('pencil', 'Edit', () => { api.close(); openTrackerEditor(store, trackerId); }),
        pinBtn,
        opt('up', 'Move up', move(-1)),
        opt('down', 'Move down', move(1)),
        opt('folder', 'Move to group…', () => { api.close(); openMoveToGroup(store, trackerId); },
          { note: t.groupId && store.state.groups[t.groupId] ? store.state.groups[t.groupId].name : 'Ungrouped' }),
        opt('archive', 'Archive', async () => {
          api.close();
          store.setArchived(trackerId, true);
          toast('Archived — restore from Settings');
        }),
        opt('trash', 'Delete…', async () => {
          const daysLogged = Object.values(store.state.days).filter((d) => d[trackerId]).length;
          api.close();
          const yes = await confirmSheet({
            title: `Delete ${t.name}?`,
            accent: t.color,
            danger: true,
            confirmLabel: 'Delete forever',
            message: `This permanently deletes <b>${escapeHtml(t.name)}</b>` +
              (daysLogged ? ` and its <b>${daysLogged} day${daysLogged === 1 ? '' : 's'}</b> of history.` : '.') +
              ' There is no undo — consider a backup first.',
          });
          if (yes) {
            store.deleteTracker(trackerId);
            toast(`${t.name} deleted`);
          }
        }, { danger: true }),
      ));
    },
  });
}

function openMoveToGroup(store, trackerId) {
  const t = store.state.trackers[trackerId];
  if (!t) return;
  openSheet({
    title: 'Move to group',
    accent: t.color,
    build(body, api) {
      const choose = (groupId) => {
        store.setTrackerGroup(trackerId, groupId);
        haptic(10);
        api.close();
        const g = groupId ? store.state.groups[groupId] : null;
        toast(g ? `Moved to ${g.name}` : 'Moved to Ungrouped');
      };
      const row = (label, groupId, colorDot) =>
        h('button', { class: 'opt', onclick: () => choose(groupId) },
          colorDot ? h('span', { class: 'group-dot', style: `background:${colorDot}` }) : icon('folder'),
          h('span', { class: 'grow' }, label),
          (t.groupId || null) === groupId ? icon('check') : null);
      body.append(h('div', { class: 'opt-list' },
        row('Ungrouped', null),
        sortedGroups(store.state).map((g) => row(g.name, g.id, g.color)),
        h('button', {
          class: 'opt',
          onclick: () => {
            api.close();
            openGroupEditor(store, null, (newId) => {
              store.setTrackerGroup(trackerId, newId);
              toast(`Moved to ${store.state.groups[newId].name}`);
            });
          },
        }, icon('plus'), h('span', { class: 'grow' }, 'New group…')),
      ));
    },
  });
}

// ---- group options ----

export function openGroupOptions(store, groupId) {
  const g = store.state.groups[groupId];
  if (!g) return;

  openSheet({
    title: g.name,
    accent: g.color,
    build(body, api) {
      const opt = (ic, label, onclick, opts = {}) =>
        h('button', { class: `opt ${opts.danger ? 'danger' : ''}`, onclick },
          icon(ic), h('span', { class: 'grow' }, label));

      const pinLabel = () => (store.state.groups[groupId].priority ? 'Unpin' : 'Pin to top');
      const pinBtn = opt(g.priority ? 'starFill' : 'star', pinLabel(), () => {
        store.updateGroup(groupId, { priority: !store.state.groups[groupId].priority });
        haptic(10);
        pinBtn.querySelector('.grow').textContent = pinLabel();
      });

      const move = (dir) => () => {
        const moved = store.reorderGroup(groupId, dir, sortedGroups(store.state));
        haptic(moved ? 10 : 0);
        if (!moved) toast(dir < 0 ? 'Already first' : 'Already last');
      };

      const memberCount = Object.values(store.state.trackers)
        .filter((t) => !t.archived && t.groupId === groupId).length;

      body.append(h('div', { class: 'opt-list' },
        opt('pencil', 'Rename & recolour', () => { api.close(); openGroupEditor(store, groupId); }),
        pinBtn,
        opt('up', 'Move up', move(-1)),
        opt('down', 'Move down', move(1)),
        opt('trash', 'Delete group…', async () => {
          api.close();
          const yes = await confirmSheet({
            title: `Delete ${g.name}?`,
            accent: g.color,
            danger: true,
            confirmLabel: 'Delete group',
            message: memberCount
              ? `Its <b>${memberCount} tracker${memberCount === 1 ? '' : 's'}</b> move to Ungrouped — no history is lost.`
              : 'The group is empty; nothing else changes.',
          });
          if (yes) {
            store.deleteGroup(groupId);
            toast(`${g.name} deleted`);
          }
        }, { danger: true }),
      ));
    },
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
