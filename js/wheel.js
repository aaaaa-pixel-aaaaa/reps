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
