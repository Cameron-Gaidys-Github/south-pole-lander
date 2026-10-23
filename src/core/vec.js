// Tiny 3-vector helpers on plain arrays (keeps the core free of three.js so it
// can run headless in Node for tests and Monte Carlo runs).
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const addScaled = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const clampLen = (a, max) => { const l = len(a); return l > max ? scale(a, max / l) : a; };
export const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b)))));

/** Rotate unit vector `from` toward unit vector `to` by at most `maxAngle` radians. */
export function slerpLimited(from, to, maxAngle) {
  const ang = angleBetween(from, to);
  if (ang <= maxAngle || ang < 1e-9) return norm(to);
  let axis = cross(from, to);
  if (len(axis) < 1e-9) axis = Math.abs(from[0]) < 0.9 ? cross(from, [1, 0, 0]) : cross(from, [0, 1, 0]);
  axis = norm(axis);
  // Rodrigues rotation
  const c = Math.cos(maxAngle), s = Math.sin(maxAngle);
  const kxv = cross(axis, from), kdv = dot(axis, from);
  return norm([
    from[0] * c + kxv[0] * s + axis[0] * kdv * (1 - c),
    from[1] * c + kxv[1] * s + axis[1] * kdv * (1 - c),
    from[2] * c + kxv[2] * s + axis[2] * kdv * (1 - c),
  ]);
}
