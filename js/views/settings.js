// Settings sheet: one-tap JSON backup (Web Share API with a file so iOS
// offers "Save to Files", download fallback), validated import, archived
// tracker management, demo-mode helpers.

import { todayKey, daysBetween } from '../dates.js';
import { validateImport } from '../store.js';
import { h, icon, haptic, openSheet, confirmSheet, toast } from '../ui.js';

async function saveBackup(store) {
  const json = store.exportJSON();
  const name = `reps-backup-${todayKey()}.json`;
  const file = new File([json], name, { type: 'application/json' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Reps backup' });
      store.markBackedUp();
      toast('Backup saved');
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // user cancelled the share sheet
      // fall through to download on anything else
    }
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  store.markBackedUp();
  toast('Backup downloaded');
}

function importFlow(store, closeSettings) {
  const input = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
  document.body.append(input);
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    input.remove();
    if (!f) return;
    let obj;
    try {
      obj = JSON.parse(await f.text());
    } catch {
      toast('That file isn’t valid JSON');
      return;
    }
    const v = validateImport(obj);
    if (!v.ok) { toast(v.error); return; }
    const { trackers, groups, days, sets } = v.summary;
    const yes = await confirmSheet({
      title: 'Replace all data?',
      danger: true,
      confirmLabel: 'Import & replace',
      message: `The backup contains <b>${trackers} tracker${trackers === 1 ? '' : 's'}</b>, ` +
        `<b>${groups} group${groups === 1 ? '' : 's'}</b> and <b>${days} day${days === 1 ? '' : 's'}</b> ` +
        `of history (${sets} sets).<br><br>Everything currently in the app is replaced.`,
    });
    if (!yes) return;
    store.replaceAll(v.data);
    haptic([10, 40, 14]);
    toast('Import complete');
    closeSettings();
    location.hash = '';
  });
  input.click();
}

export function openSettings(store) {
  const demo = new URLSearchParams(location.search).get('demo') === '1';

  openSheet({
    title: 'Settings',
    build(body, api) {
      const today = todayKey();
      const { lastBackup } = store.state.meta;
      const backupAge = lastBackup === today ? 'today'
        : lastBackup ? `${daysBetween(lastBackup, today)} day${daysBetween(lastBackup, today) === 1 ? '' : 's'} ago`
        : 'never';

      const backupKV = h('div', { class: 'kv' },
        h('span', { class: 'k' }, 'Last backup'),
        h('span', { class: `v num ${lastBackup ? '' : ''}` }, backupAge));

      body.append(
        h('div', { class: 'sheet-section' }, 'Backup'),
        h('button', {
          class: 'btn btn-accent',
          onclick: async () => {
            await saveBackup(store);
            backupKV.lastChild.textContent = store.state.meta.lastBackup === today ? 'today' : backupAge;
          },
        }, icon('share'), 'Save backup'),
        backupKV,
        h('div', { class: 'hint' },
          'Exports everything as JSON. On iPhone, pick “Save to Files”. Data lives only in this browser — back up before clearing Safari data or switching phones.'),
        h('button', { class: 'btn btn-ghost', style: 'margin-top:12px', onclick: () => importFlow(store, () => api.close()) },
          icon('download'), 'Import backup…'),
        h('hr', { class: 'divider' }),
      );

      // archived trackers
      const archived = Object.values(store.state.trackers).filter((t) => t.archived);
      if (archived.length) {
        const list = h('div', { class: 'opt-list' });
        for (const t of archived) {
          const row = h('div', { class: 'opt', style: 'cursor:default' },
            h('span', { class: 'group-dot', style: `background:${t.color}` }),
            h('span', { class: 'grow' }, t.name),
            h('button', {
              class: 'chip small',
              onclick: () => {
                store.setArchived(t.id, false);
                row.remove();
                toast(`${t.name} restored`);
                if (!list.children.length) archSection.remove();
              },
            }, 'Restore'),
            h('button', {
              class: 'chip small', style: 'color:#FF8A73',
              onclick: async () => {
                const daysLogged = Object.values(store.state.days).filter((d) => d[t.id]).length;
                const yes = await confirmSheet({
                  title: `Delete ${t.name}?`,
                  danger: true,
                  confirmLabel: 'Delete forever',
                  message: `Permanently deletes it${daysLogged ? ` and its <b>${daysLogged} logged day${daysLogged === 1 ? '' : 's'}</b>` : ''}. No undo.`,
                });
                if (yes) { store.deleteTracker(t.id); row.remove(); toast('Deleted'); }
              },
            }, 'Delete'),
          );
          list.append(row);
        }
        const archSection = h('div', {},
          h('div', { class: 'sheet-section' }, 'Archived trackers'),
          list,
          h('hr', { class: 'divider' }));
        body.append(archSection);
      }

      // about / demo
      body.append(
        h('div', { class: 'sheet-section' }, 'About'),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Reps'), h('span', { class: 'v' }, 'v1.0')),
        demo
          ? h('div', {},
              h('div', { class: 'hint', style: 'margin-bottom:10px' },
                'Demo mode: this is throwaway sample data kept separate from your real data.'),
              h('button', {
                class: 'btn btn-ghost',
                onclick: () => { location.href = location.pathname; },
              }, 'Exit demo mode'))
          : h('div', { class: 'hint' },
              'Tip: in Safari, tap Share → “Add to Home Screen” to install Reps as an app.'),
      );
    },
  });
}
