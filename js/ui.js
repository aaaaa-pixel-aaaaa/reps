// DOM + interaction primitives: element builder, icons, accent theming,
// haptics, bottom-sheet manager, toasts, confirm sheet, count-up animation.

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== 'type' && k !== 'value') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(9)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

// ---- accent theming ----

export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Inline style that sets the contextual accent + its alpha steps.
export function accentStyle(hex) {
  return `--c:${hex};--c-70:${rgba(hex, 0.7)};--c-40:${rgba(hex, 0.4)};--c-25:${rgba(hex, 0.25)}`;
}

// ---- icons (inline SVG, stroke follows currentColor) ----

const S = (inner, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const icons = {
  gear: S('<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  x: S('<path d="M18 6 6 18M6 6l12 12"/>'),
  check: S('<path d="M4.5 12.8 9.7 18 19.5 7"/>'),
  chevD: S('<path d="m6 9 6 6 6-6"/>'),
  chevL: S('<path d="m15 18-6-6 6-6"/>'),
  chevR: S('<path d="m9 18 6-6-6-6"/>'),
  dots: S('<circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/>'),
  star: S('<path d="m12 2.5 2.9 5.9 6.6 1-4.7 4.6 1.1 6.5-5.9-3.1-5.9 3.1 1.1-6.5L2.5 9.4l6.6-1z"/>'),
  starFill: S('<path fill="currentColor" stroke="none" d="m12 2.5 2.9 5.9 6.6 1-4.7 4.6 1.1 6.5-5.9-3.1-5.9 3.1 1.1-6.5L2.5 9.4l6.6-1z"/>'),
  trash: S('<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>'),
  pencil: S('<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>'),
  cal: S('<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  up: S('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  down: S('<path d="M12 5v14M19 12l-7 7-7-7"/>'),
  share: S('<path d="M12 15V3m0 0L7 8m5-5 5 5"/><path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/>'),
  download: S('<path d="M12 3v12m0 0 5-5m-5 5-5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
  undo: S('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  archive: S('<rect x="2" y="4" width="20" height="5" rx="1.5"/><path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9M10 13h4"/>'),
  folder: S('<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.2 3.9A2 2 0 0 0 7.5 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>'),
  flame: S('<path d="M12 22c4.4 0 7.5-3 7.5-7.2 0-2.8-1.3-4.9-3-6.8-.9-1-2-2-2.6-3.5-.2-.6-.4-1.3-.4-2-1.4.6-2.5 1.8-3 3.2-.4 1.1-.4 2.2-.2 3.4-1-.4-1.8-1.3-2.2-2.3-1.7 1.7-3.6 4.3-3.6 8C4.5 19 7.6 22 12 22z"/>'),
  wave: S('<path d="M2 12h3l2.5-7 4 14 3-10 2 3h5.5"/>'),
};

export function icon(name) {
  const span = h('span', { class: 'icon', html: icons[name] || '' });
  return span.firstChild;
}

// ---- haptics (silently absent on iOS Safari) ----

export function haptic(pattern = 10) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch { /* no-op */ }
}

export const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- bottom sheets ----

const sheetStack = [];

export function openSheet({ title, accent, build, onClose } = {}) {
  const host = document.getElementById('sheets');
  const backdrop = h('div', { class: 'backdrop' });
  const headEls = [];
  const titleEl = h('div', { class: 'sheet-title' },
    accent ? h('span', { class: 'tdot' }) : null,
    title || '');
  const closeBtn = h('button', { class: 'sheet-x', 'aria-label': 'Close' }, icon('x'));
  const body = h('div', { class: 'sheet-body' });
  const sheet = h('div', {
    class: 'sheet',
    role: 'dialog',
    style: accent ? accentStyle(accent) : '',
  }, h('div', { class: 'sheet-grab' }), h('div', { class: 'sheet-head' }, titleEl, closeBtn), body);

  let closed = false;
  const api = {
    el: sheet,
    body,
    setTitle(t) { titleEl.lastChild.textContent = t; },
    setAccent(hex) { sheet.style.cssText += ';' + accentStyle(hex); },
    close(result) {
      if (closed) return;
      closed = true;
      const idx = sheetStack.indexOf(api);
      if (idx >= 0) sheetStack.splice(idx, 1);
      sheet.classList.remove('open');
      backdrop.classList.remove('open');
      const remove = () => { backdrop.remove(); sheet.remove(); };
      reducedMotion() ? remove() : setTimeout(remove, 450);
      onClose && onClose(result);
    },
  };

  backdrop.addEventListener('click', () => api.close());
  closeBtn.addEventListener('click', () => api.close());

  // drag-to-dismiss from the grabber/header zone
  const head = sheet.querySelector('.sheet-head');
  let dragY = null;
  const grab = sheet.querySelector('.sheet-grab');
  for (const zone of [head, grab]) {
    zone.addEventListener('pointerdown', (e) => {
      // capturing here would swallow the button's click (browsers retarget
      // clicks to the capture element), leaving the X dead — let it through
      if (e.target.closest && e.target.closest('button')) return;
      dragY = e.clientY;
      sheet.classList.add('dragging');
      zone.setPointerCapture(e.pointerId);
    });
    zone.addEventListener('pointermove', (e) => {
      if (dragY == null) return;
      const dy = Math.max(0, e.clientY - dragY);
      sheet.style.transform = `translateY(${dy}px)`;
    });
    const end = (e) => {
      if (dragY == null) return;
      const dy = e.clientY - dragY;
      dragY = null;
      sheet.classList.remove('dragging');
      sheet.style.transform = '';
      if (dy > 90) api.close();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  host.append(backdrop, sheet);
  build && build(body, api);
  requestAnimationFrame(() => {
    backdrop.classList.add('open');
    sheet.classList.add('open');
  });
  sheetStack.push(api);
  return api;
}

export function closeAllSheets() {
  [...sheetStack].forEach((s) => s.close());
}

export function confirmSheet({ title, message, confirmLabel = 'Confirm', danger = false, accent }) {
  return new Promise((resolve) => {
    let result = false;
    openSheet({
      title,
      accent,
      onClose: () => resolve(result),
      build(body, api) {
        const msg = h('p', { class: 'confirm-msg' });
        if (message instanceof Node) msg.append(message); else msg.innerHTML = message;
        body.append(
          msg,
          h('button', {
            class: `btn ${danger ? 'btn-danger' : 'btn-accent'}`,
            onclick: () => { result = true; haptic(15); api.close(); },
          }, confirmLabel),
          h('button', { class: 'btn btn-ghost', onclick: () => api.close() }, 'Cancel'),
        );
      },
    });
  });
}

// ---- toast ----

export function toast(msg, ms = 2200) {
  const host = document.getElementById('toasts');
  const el = h('div', { class: 'toast' }, msg);
  host.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  }, ms);
}

// ---- number animation ----

export function countUp(el, from, to, fmt = String, ms = 380) {
  if (reducedMotion() || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const t0 = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---- SVG progress ring ----

// `band`, if given, is { start, end } as 0..1 fractions of the ring and
// draws a higher-contrast arc segment (nutrition's satisfied-band, applied
// radially) between the track and the progress arc.
export function ringSVG(size, stroke, progress, band) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(1, Math.max(0, progress)));
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  const mk = (cls) => {
    const el = document.createElementNS(NS, 'circle');
    el.setAttribute('cx', size / 2);
    el.setAttribute('cy', size / 2);
    el.setAttribute('r', r);
    el.setAttribute('stroke-width', stroke);
    el.setAttribute('class', cls);
    return el;
  };
  const track = mk('ring-track');
  svg.append(track);
  if (band) {
    const a = Math.min(1, Math.max(0, band.start));
    const b = Math.min(1, Math.max(a, band.end));
    const bandEl = mk('ring-band');
    const d = (b - a) * c;
    bandEl.setAttribute('stroke-dasharray', `${d} ${c - d}`);
    bandEl.setAttribute('stroke-dashoffset', c * (1 - a));
    svg.append(bandEl);
  }
  const prog = mk('ring-prog');
  prog.setAttribute('stroke-dasharray', c);
  prog.setAttribute('stroke-dashoffset', off);
  svg.append(prog);
  svg._setProgress = (p) => {
    prog.setAttribute('stroke-dashoffset', c * (1 - Math.min(1, Math.max(0, p))));
  };
  return svg;
}
