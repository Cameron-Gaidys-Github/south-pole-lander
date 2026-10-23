// Plume-surface interaction. With no air, ejected regolith flies on straight,
// shallow ballistic arcs at tens to hundreds of m/s and falls back far away
// (Apollo crews lost sight of the surface below ~30 m). Particle speed and
// onset height scale with engine thrust and nozzle height above the ground.
import * as THREE from 'three';
import { mciToWorld } from './world.js';
import { localFrame } from '../core/sim.js';
import { G_MOON } from '../core/constants.js';

const N = 1400;

export class Dust {
  constructor(scene) {
    this.pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.life = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xb9b3a7, size: 0.9, sizeAttenuation: true, transparent: true, opacity: 0.55, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.next = 0;
    this.reset();
  }
  reset() { this.life.fill(0); for (let i = 0; i < N; i++) this.pos[i * 3 + 2] = -1e7; this.points.geometry.attributes.position.needsUpdate = true; }

  update(sim, dt, model) {
    if (!dt) return;
    const thrust = sim.thrust;
    const e = sim.v.engines[sim.engine];
    const nozzleH = e.position === 'mid' ? (e.mountHeight ?? sim.v.height * 0.7) : 0;
    const alt = sim.altitude + nozzleH;
    // onset height grows with the square root of thrust (plume pressure ~ T / h^2)
    const onset = 0.25 * Math.sqrt(thrust) * (e.position === 'mid' ? 0.45 : 1);
    const strength = thrust > 0 ? Math.max(0, 1 - alt / Math.max(onset, 1)) : 0;
    const [x, y] = sim.map;
    const fr = localFrame(x, y);
    const up = new THREE.Vector3(...fr.up), fwd = new THREE.Vector3(...fr.fwd), left = new THREE.Vector3(...fr.left);
    const groundH = sim.terrain.height(x, y);
    const base = mciToWorld(sim.r).addScaledVector(up, -sim.altitude);
    const spawn = Math.floor(strength * 900 * dt);
    for (let k = 0; k < spawn; k++) {
      const i = this.next; this.next = (this.next + 1) % N;
      const a = Math.random() * Math.PI * 2, r0 = (e.position === 'mid' ? sim.v.diameter * 0.9 : 2) + Math.random() * 6;
      const dir = fwd.clone().multiplyScalar(Math.cos(a)).addScaledVector(left, Math.sin(a));
      const p = base.clone().addScaledVector(dir, r0).addScaledVector(up, 0.3);
      const speed = (30 + Math.random() * 120) * strength;
      const elev = (1 + Math.random() * 4) * Math.PI / 180;
      const v = dir.multiplyScalar(speed * Math.cos(elev)).addScaledVector(up, speed * Math.sin(elev));
      this.pos.set([p.x, p.y, p.z], i * 3);
      this.vel.set([v.x, v.y, v.z], i * 3);
      this.life[i] = 2 + Math.random() * 3;
    }
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vel[i * 3] -= up.x * G_MOON * dt; this.vel[i * 3 + 1] -= up.y * G_MOON * dt; this.vel[i * 3 + 2] -= up.z * G_MOON * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.life[i] <= 0) { this.pos[i * 3] = this.pos[i * 3 + 1] = 0; this.pos[i * 3 + 2] = -1e7; }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.strength = strength;
  }
}
