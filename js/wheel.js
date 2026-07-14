// Spin-wheel input. Pure angle math lives up top (unit-testable in Node);
// the DOM component is created via createWheel().

// Shortest signed angular difference (deg), wrap-safe across the ±180 seam.
export function wrapDelta(prev, next) {
  let d = next - prev;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

// Accumulated degrees -> whole steps of stepVal, never negative.
export function stepsFor(accumDeg, stepDeg) {
  return Math.max(0, Math.floor(accumDeg / stepDeg));
}

// Pointer position -> angle in degrees, 0 at 12 o'clock, clockwise positive.
export function angleAt(cx, cy, x, y) {
  return (Math.atan2(x - cx, cy - y) * 180) / Math.PI;
}

// ---- DOM component ----
// Drag a finger around the dial; the pending count climbs stepVal per
// stepDeg of rotation. Backspin reduces it (never below zero). Each full
// revolution flashes + fires onRev for a haptic tick.

const NS = 'http://www.w3.org/2000/svg';
const SIZE = 258;
const R = 104; // dial radius (stroke centreline)
const STROKE = 30;

function svgEl(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

export function createWheel({ stepDeg, stepVal, round, onChange, onRev }) {
  const c = SIZE / 2;
  const circ = 2 * Math.PI * R;

  const svg = svgEl('svg', { viewBox: `0 0 ${SIZE} ${SIZE}` });
  // subtle tick marks every 30deg
  for (let i = 0; i < 12; i++) {
    const a = (i * 30 * Math.PI) / 180;
    const r1 = R - STROKE / 2 - 7;
    const r2 = R - STROKE / 2 - 2;
    svg.append(svgEl('line', {
      x1: c + r1 * Math.sin(a), y1: c - r1 * Math.cos(a),
      x2: c + r2 * Math.sin(a), y2: c - r2 * Math.cos(a),
      class: 'wheel-tick', 'stroke-width': 2,
    }));
  }
  const track = svgEl('circle', { cx: c, cy: c, r: R, class: 'wheel-track', 'stroke-width': STROKE });
  const arc = svgEl('circle', {
    cx: c, cy: c, r: R, class: 'wheel-arc', 'stroke-width': STROKE,
    'stroke-dasharray': circ, 'stroke-dashoffset': circ,
    transform: `rotate(-90 ${c} ${c})`,
  });
  const knob = svgEl('circle', { cx: c, cy: c - R, r: 14.5, class: 'wheel-knob', 'stroke-width': 4 });
  svg.append(track, arc, knob);

  const pendingEl = document.createElement('div');
  pendingEl.className = 'wheel-pending num';
  pendingEl.textContent = '0';
  const hintEl = document.createElement('div');
  hintEl.className = 'wheel-hint';
  hintEl.textContent = 'spin to count';
  const center = document.createElement('div');
  center.className = 'wheel-center';
  center.append(pendingEl, hintEl);

  const flash = document.createElement('div');
  flash.className = 'wheel-flashring';

  const el = document.createElement('div');
  el.className = 'wheelbox';
  el.append(svg, center, flash);

  let accum = 0;      // continuous degrees, clamped >= 0
  let revs = 0;       // completed revolutions already celebrated
  let pending = 0;
  let prevAngle = null;
  let pointerId = null;

  function paint() {
    const frac = (accum % 360) / 360;
    // at an exact full turn show a full ring rather than an empty one
    const shown = accum > 0 && frac === 0 ? 1 : frac;
    arc.setAttribute('stroke-dashoffset', circ * (1 - shown));
    const a = ((accum % 360) * Math.PI) / 180;
    knob.setAttribute('cx', c + R * Math.sin(a));
    knob.setAttribute('cy', c - R * Math.cos(a));
    pendingEl.textContent = api.format(pending);
  }

  function setAccum(deg) {
    accum = Math.max(0, deg);
    const steps = stepsFor(accum, stepDeg);
    const next = round(steps * stepVal);
    if (next !== pending) {
      pending = next;
      onChange && onChange(pending);
    }
    const fullRevs = Math.floor(accum / 360);
    if (fullRevs > revs) {
      revs = fullRevs;
      flash.classList.remove('go');
      void flash.offsetWidth; // restart the animation
      flash.classList.add('go');
      onRev && onRev(revs);
    } else if (fullRevs < revs) {
      revs = fullRevs; // spun back past a boundary
    }
    paint();
  }

  function localAngle(e) {
    const rect = el.getBoundingClientRect();
    return angleAt(rect.left + rect.width / 2, rect.top + rect.height / 2, e.clientX, e.clientY);
  }

  el.addEventListener('pointerdown', (e) => {
    pointerId = e.pointerId;
    prevAngle = localAngle(e);
    el.setPointerCapture(pointerId);
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId || prevAngle == null) return;
    const a = localAngle(e);
    setAccum(accum + wrapDelta(prevAngle, a));
    prevAngle = a;
  });
  const release = (e) => {
    if (e.pointerId === pointerId) {
      pointerId = null;
      prevAngle = null;
    }
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);

  const api = {
    el,
    format: (v) => String(v),
    get pending() { return pending; },
    reset() {
      accum = 0; revs = 0; pending = 0; prevAngle = null;
      onChange && onChange(0);
      paint();
    },
  };
  paint();
  return api;
}
