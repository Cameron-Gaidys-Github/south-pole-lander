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

// ---------- quaternions [w, x, y, z], body -> inertial ----------
export const qmul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
export const qconj = (q) => [q[0], -q[1], -q[2], -q[3]];
export const qnorm = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
/** Rotate vector v by quaternion q. */
export function qrot(q, v) {
  const p = qmul(qmul(q, [0, v[0], v[1], v[2]]), qconj(q));
  return [p[1], p[2], p[3]];
}
export const qrotInv = (q, v) => qrot(qconj(q), v);
/** Quaternion whose body axes X, Y, Z map to the given orthonormal inertial vectors. */
export function qFromBasis(x, y, z) {
  const m00 = x[0], m01 = y[0], m02 = z[0], m10 = x[1], m11 = y[1], m12 = z[1], m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [(m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s]; }
  return qnorm(q);
}
/** Integrate body angular rate w (rad/s) over dt. */
export function qIntegrate(q, w, dt) {
  const dq = qmul(q, [0, w[0], w[1], w[2]]);
  return qnorm([q[0] + 0.5 * dq[0] * dt, q[1] + 0.5 * dq[1] * dt, q[2] + 0.5 * dq[2] * dt, q[3] + 0.5 * dq[3] * dt]);
}
/** Rotation vector (body frame) that takes q to qRef. */
export function qErrorBody(q, qRef) {
  let e = qmul(qconj(q), qRef);
  if (e[0] < 0) e = [-e[0], -e[1], -e[2], -e[3]];
  const s = Math.hypot(e[1], e[2], e[3]);
  if (s < 1e-9) return [0, 0, 0];
  const ang = 2 * Math.atan2(s, e[0]);
  return [e[1] / s * ang, e[2] / s * ang, e[3] / s * ang];
}
