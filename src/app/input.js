// Crew input: on-screen hand controllers (touch or mouse), keyboard, and game
// controllers / flight sticks through the browser Gamepad API.
//
// Everything is merged into one state each frame:
//   rhc [roll, pitch, yaw]   rotational hand controller, -1..1 (right hand)
//   thc [fwd, left, up]      translational hand controller, -1..1 (left hand)
//   throttleRate             -1..1, moves the throttle lever (MANUAL)
//   throttleAbs              0..1 or null, absolute lever from a flight stick
// plus one-shot events: rod(+1|-1), lpd(dx, dy), mode(name), engine, camera, cameraReset, pause.

export const keys = new Set();
const pressed = [];
window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  const k = e.key.toLowerCase();
  if (!keys.has(k)) pressed.push(k);
  keys.add(k);
  if (e.key.startsWith('Arrow') || e.key === ' ' || e.key === 'PageUp' || e.key === 'PageDown') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

/** Spring-centred on-screen stick. */
export class Stick {
  constructor(el, knob) {
    this.el = el; this.knob = knob; this.x = 0; this.y = 0; this.id = null;
    const move = (e) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let dx = (e.clientX - cx) / (r.width / 2), dy = (cy - e.clientY) / (r.height / 2);
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      this.x = dx; this.y = dy;
      const k = (r.width - knob.offsetWidth) / 2;
      knob.style.transform = `translate(${dx * k}px, ${-dy * k}px)`;
    };
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.id = e.pointerId; el.setPointerCapture(e.pointerId); move(e); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === this.id) move(e); });
    const end = (e) => { if (e.pointerId !== this.id) return; this.id = null; this.x = 0; this.y = 0; knob.style.transform = ''; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
}

/** Button that reports whether it is being held. */
export function holdButton(el) {
  const st = { down: false };
  el.addEventListener('pointerdown', (e) => { e.stopPropagation(); st.down = true; el.setPointerCapture?.(e.pointerId); });
  const up = () => { st.down = false; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', up);
  return st;
}

const dz = (v, d = 0.12) => (Math.abs(v) < d ? 0 : Math.sign(v) * (Math.abs(v) - d) / (1 - d));
// gentler response near centre, full authority at the stops
const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.6);

export class CrewInput {
  constructor({ rhcStick, thcStick, yawL, yawR, thcUp, thcDown }) {
    this.rhcStick = rhcStick; this.thcStick = thcStick;
    this.yawL = yawL; this.yawR = yawR; this.thcUp = thcUp; this.thcDown = thcDown;
    this.prevButtons = {};
    this.lpdLatch = { x: 0, y: 0 };
    this.gamepadName = null;
  }

  /** Poll everything; returns { rhc, thc, throttleRate, throttleAbs, events: [] }. */
  poll(mode) {
    const events = [];
    const rhc = [this.rhcStick.x, this.rhcStick.y, 0];
    const thc = [this.thcStick.y, -this.thcStick.x, 0];
    if (this.yawL.down) rhc[2] -= 1;
    if (this.yawR.down) rhc[2] += 1;
    if (this.thcUp.down) thc[2] += 1;
    if (this.thcDown.down) thc[2] -= 1;
    let throttleRate = 0, throttleAbs = null;

    // ---- keyboard ----
    const k = (c) => keys.has(c);
    rhc[1] += (k('w') ? 1 : 0) - (k('s') ? 1 : 0);     // pitch: W nose forward
    rhc[0] += (k('d') ? 1 : 0) - (k('a') ? 1 : 0);     // roll
    rhc[2] += (k('e') ? 1 : 0) - (k('q') ? 1 : 0);     // yaw
    if (mode === 'AUTO') {
      for (const c of pressed) {
        if (c === 'arrowup') events.push({ type: 'lpd', dx: 10, dy: 0 });
        if (c === 'arrowdown') events.push({ type: 'lpd', dx: -10, dy: 0 });
        if (c === 'arrowleft') events.push({ type: 'lpd', dx: 0, dy: 10 });
        if (c === 'arrowright') events.push({ type: 'lpd', dx: 0, dy: -10 });
      }
    } else {
      thc[0] += (k('arrowup') ? 1 : 0) - (k('arrowdown') ? 1 : 0);
      thc[1] += (k('arrowleft') ? 1 : 0) - (k('arrowright') ? 1 : 0);
    }
    if (mode === 'MANUAL') thc[2] += (k('r') ? 1 : 0) - (k('f') ? 1 : 0);
    throttleRate += (k('shift') ? 1 : 0) - (k('control') ? 1 : 0);
    for (const c of pressed) {
      if ((c === 'r' || c === 'pageup') && mode !== 'MANUAL') events.push({ type: 'rod', dir: +1 });
      if ((c === 'f' || c === 'pagedown') && mode !== 'MANUAL') events.push({ type: 'rod', dir: -1 });
      if (c === 'x') events.push({ type: 'throttleSet', value: 1 });
      if (c === 'z') events.push({ type: 'throttleSet', value: 0 });
      if (c === 't') events.push({ type: 'engine' });
      if (c === '1') events.push({ type: 'mode', mode: 'AUTO' });
      if (c === '2') events.push({ type: 'mode', mode: 'ROD' });
      if (c === '3') events.push({ type: 'mode', mode: 'MANUAL' });
      if (c === 'h') events.push({ type: 'safeSite' });
      if (c === 'c') events.push({ type: 'camera' });
      if (c === 'v') events.push({ type: 'cameraReset' });
      if (c === 'p') events.push({ type: 'pause' });
      if (c === 'g') events.push({ type: 'debug' });
      if (c === ']') events.push({ type: 'warp', dir: +1 });
      if (c === '[') events.push({ type: 'warp', dir: -1 });
    }
    pressed.length = 0;

    // ---- gamepads ----
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    this.gamepadName = pads[0]?.id || null;
    for (const gp of pads) {
      const b = (i) => !!gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5);
      const edge = (i) => { const key = gp.index + ':' + i; const now = b(i); const was = this.prevButtons[key]; this.prevButtons[key] = now; return now && !was; };
      const ax = (i) => (gp.axes[i] ?? 0);
      if (gp.mapping === 'standard') {
        // Right stick = RHC (pitch/roll), bumpers = yaw; left stick = THC
        rhc[0] += curve(dz(ax(2)));
        rhc[1] += curve(dz(-ax(3)));
        rhc[2] += (b(5) ? 1 : 0) - (b(4) ? 1 : 0);
        const lx = dz(ax(0)), ly = dz(-ax(1));
        if (mode === 'AUTO') {
          // stick flicks = landing point redesignation clicks
          const fire = (v, key, dxv, dyv) => {
            const on = Math.abs(v) > 0.7;
            if (on && !this.lpdLatch[key]) events.push({ type: 'lpd', dx: dxv * Math.sign(v), dy: dyv * Math.sign(v) });
            this.lpdLatch[key] = on;
          };
          fire(ly, 'y', 10, 0); fire(lx, 'x', 0, -10);
        } else {
          thc[0] += ly; thc[1] -= lx;
        }
        // triggers move the throttle lever
        const lt = gp.buttons[6]?.value || 0, rt = gp.buttons[7]?.value || 0;
        throttleRate += rt - lt;
        if (mode === 'MANUAL') { thc[2] += (b(12) ? 1 : 0) - (b(13) ? 1 : 0); }
        else { if (edge(12)) events.push({ type: 'rod', dir: +1 }); if (edge(13)) events.push({ type: 'rod', dir: -1 }); }
        if (edge(0)) events.push({ type: 'mode', mode: 'ROD' });
        if (edge(1)) events.push({ type: 'mode', mode: 'AUTO' });
        if (edge(2)) events.push({ type: 'mode', mode: 'MANUAL' });
        if (edge(3)) events.push({ type: 'camera' });
        if (edge(9)) events.push({ type: 'pause' });
        if (edge(8) || edge(11)) events.push({ type: 'cameraReset' });
        if (edge(10)) events.push({ type: 'engine' });
        if (edge(14)) events.push({ type: 'safeSite' });
      } else {
        // Flight stick: X/Y = roll/pitch, twist = yaw, slider = throttle
        rhc[0] += curve(dz(ax(0)));
        rhc[1] += curve(dz(-ax(1)));
        if (gp.axes.length > 3) { rhc[2] += curve(dz(ax(gp.axes.length > 5 ? 5 : 2), 0.18)); throttleAbs = (1 - ax(gp.axes.length > 5 ? 2 : 3)) / 2; }
        if (edge(0)) events.push({ type: 'rod', dir: -1 });
        if (edge(1)) events.push({ type: 'rod', dir: +1 });
        if (edge(2)) events.push({ type: 'mode', mode: 'ROD' });
        if (edge(3)) events.push({ type: 'mode', mode: 'AUTO' });
      }
    }

    const clamp = (v) => Math.max(-1, Math.min(1, v));
    return { rhc: rhc.map(clamp), thc: thc.map(clamp), throttleRate: clamp(throttleRate), throttleAbs, events };
  }
}
