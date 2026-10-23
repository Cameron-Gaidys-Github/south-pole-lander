// Camera rig: four views, all controllable by touch, mouse and keyboard.
//
//   CHASE    orbits the lander and follows it exactly (no lag at orbital speed).
//            Drag to orbit, pinch/scroll to zoom, double-tap to reset.
//   CABIN    from the crew windows. Drag to look around, pinch/scroll to zoom.
//   TRACKER  a long lens on the ground near the target, like a launch tracking
//            camera. Pinch/scroll to zoom, drag to nudge the aim.
//   TOP      straight down from above the lander, track-up. Best for the final
//            metres. Pinch/scroll to change height, drag to rotate.
import * as THREE from 'three';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

export const VIEWS = ['chase', 'cabin', 'tracker', 'top'];
export const VIEW_LABEL = { chase: 'CHASE', cabin: 'CABIN', tracker: 'TRACKER', top: 'TOP' };

const DEFAULTS = {
  chase: { yaw: 20, pitch: 12, zoom: 1 },      // yaw 0 = straight behind along track
  cabin: { yaw: 0, pitch: 0, zoom: 1 },        // offsets from the window's boresight
  tracker: { yaw: 0, pitch: 0, zoom: 1 },
  top: { yaw: 0, pitch: 0, zoom: 1 },
};

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.mode = 'chase';
    this.target = {};   // what the input asks for
    this.state = {};    // smoothed values actually used
    for (const m of VIEWS) { this.target[m] = { ...DEFAULTS[m] }; this.state[m] = { ...DEFAULTS[m] }; }
    this.heading = null;          // smoothed horizontal reference direction
    this.pointers = new Map();
    this.lastTap = 0;
    this.bindInput();
  }

  setMode(m) { this.mode = m; }
  next() { this.mode = VIEWS[(VIEWS.indexOf(this.mode) + 1) % VIEWS.length]; return this.mode; }
  reset() { Object.assign(this.target[this.mode], DEFAULTS[this.mode]); }
  resetAll() { for (const m of VIEWS) { Object.assign(this.target[m], DEFAULTS[m]); Object.assign(this.state[m], DEFAULTS[m]); } this.heading = null; }

  // ---------------- input ----------------
  rotate(dx, dy) {
    const t = this.target[this.mode];
    const k = this.mode === 'tracker' ? 0.04 / t.zoom : this.mode === 'cabin' ? 0.18 / t.zoom : 0.3;
    t.yaw -= dx * k;
    t.pitch += dy * k;
    if (this.mode === 'chase') t.pitch = clamp(t.pitch, -25, 88);
    if (this.mode === 'cabin') { t.yaw = clamp(t.yaw, -150, 150); t.pitch = clamp(t.pitch, -60, 55); }
    if (this.mode === 'tracker') { t.yaw = clamp(t.yaw, -8, 8); t.pitch = clamp(t.pitch, -6, 6); }
  }
  zoomBy(f) {
    const t = this.target[this.mode];
    const lim = { chase: [0.35, 120], cabin: [1, 4], tracker: [0.25, 12], top: [0.15, 40] }[this.mode];
    t.zoom = clamp(t.zoom * f, lim[0], lim[1]);
  }

  bindInput() {
    const el = this.dom;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      if (this.pointers.size === 1) {
        this.rotate(e.clientX - p.x, e.clientY - p.y);
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const before = Math.hypot(a.x - b.x, a.y - b.y);
        p.x = e.clientX; p.y = e.clientY;
        const after = Math.hypot(a.x - b.x, a.y - b.y);
        if (before > 10 && after > 10) this.zoomBy(before / after);
        return;
      }
      p.x = e.clientX; p.y = e.clientY;
    });
    const up = (e) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (!p) return;
      const moved = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
      const now = performance.now();
      if (moved < 10 && now - p.t0 < 300) {
        if (now - this.lastTap < 320) { this.reset(); this.lastTap = 0; } else this.lastTap = now;
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    el.addEventListener('dblclick', () => this.reset());
  }

  /** Keyboard: I/J/K/L orbit, U/O zoom (kept away from the flight keys). */
  keys(keys, dt) {
    const s = 160 * dt;
    if (keys.has('j')) this.rotate(-s, 0);
    if (keys.has('l')) this.rotate(s, 0);
    if (keys.has('i')) this.rotate(0, -s);
    if (keys.has('k')) this.rotate(0, s);
    if (keys.has('u')) this.zoomBy(Math.exp(-1.5 * dt));
    if (keys.has('o')) this.zoomBy(Math.exp(1.5 * dt));
  }

  // ---------------- per frame ----------------
  /**
   * ctx: { base (footpad centre, world), up, fwd, left (unit, world), quat (body),
   *        height, cabinR, cabinZ, vel (world), altitude, groundCam (world), groundClear(pos)->pos }
   */
  update(dt, ctx) {
    const cam = this.camera;
    const s = this.state[this.mode], t = this.target[this.mode];
    s.yaw = damp(s.yaw, t.yaw, 12, dt);
    s.pitch = damp(s.pitch, t.pitch, 12, dt);
    s.zoom = Math.exp(damp(Math.log(s.zoom), Math.log(t.zoom), 10, dt));

    const { up, fwd, left, height: H } = ctx;
    const centre = ctx.base.clone().addScaledVector(up, H * 0.45);

    // Horizontal reference: direction of travel while moving, otherwise hold it
    const vh = ctx.vel.clone().addScaledVector(up, -ctx.vel.dot(up));
    const want = vh.length() > 2 ? vh.normalize() : (this.heading ? this.heading.clone() : fwd.clone());
    if (!this.heading) this.heading = want.clone();
    this.heading.lerp(want, 1 - Math.exp(-1.5 * dt)).addScaledVector(up, -this.heading.dot(up)).normalize();
    const head = this.heading;
    const side = new THREE.Vector3().crossVectors(up, head);

    cam.up.copy(up);
    if (this.mode === 'chase') {
      const dist = (H * 2.1 + 8) * s.zoom;
      const yaw = s.yaw * DEG, pitch = s.pitch * DEG;
      const dir = head.clone().multiplyScalar(-Math.cos(yaw)).addScaledVector(side, Math.sin(yaw));
      const off = dir.multiplyScalar(Math.cos(pitch) * dist).addScaledVector(up, Math.sin(pitch) * dist);
      cam.position.copy(centre).add(off);
      cam.fov = 50;
      ctx.groundClear(cam.position, 2);
      cam.lookAt(centre);
    } else if (this.mode === 'cabin') {
      const q = ctx.quat;
      const bodyUp = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      cam.position.set(ctx.cabinR + 0.6, 0, ctx.cabinZ).applyQuaternion(q).add(ctx.base);
      // boresight: out of the window, 30 deg below the body's horizontal
      const yaw = s.yaw * DEG, pitch = (-30 + s.pitch) * DEG;
      const local = new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch));
      const dir = local.applyQuaternion(q);
      cam.up.copy(bodyUp);
      cam.fov = 75 / s.zoom;
      cam.lookAt(cam.position.clone().add(dir));
    } else if (this.mode === 'tracker') {
      cam.position.copy(ctx.groundCam);
      const dist = cam.position.distanceTo(centre);
      // frame the vehicle ~3 body-heights tall, then apply the user's zoom
      cam.fov = clamp((2 * Math.atan((H * 3) / dist) / DEG) / s.zoom, 0.4, 70);
      cam.lookAt(centre);
      cam.rotateY(-s.yaw * DEG); cam.rotateX(s.pitch * DEG);
    } else if (this.mode === 'top') {
      const h = (Math.max(H * 3, 40) + Math.min(ctx.altitude * 0.5, 2000)) * s.zoom;
      cam.position.copy(ctx.base).addScaledVector(up, h + H);
      const rot = s.yaw * DEG;
      cam.up.copy(head).multiplyScalar(Math.cos(rot)).addScaledVector(side, Math.sin(rot));
      cam.fov = 55;
      cam.lookAt(ctx.base);
    }
    cam.updateProjectionMatrix();
  }
}
