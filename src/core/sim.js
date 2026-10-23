// Flight simulation: point-mass translational dynamics in a Moon-centred frame,
// rate-limited thrust-axis attitude, throttle lag, propellant depletion,
// multi-phase powered-descent guidance, and touchdown assessment.
//
// Runs identically in the browser and in Node (see test/).

import { MOON, G0 } from './constants.js';
import { maxThrust, minThrust } from './vehicles.js';
import { mapToMCI, mapToDir, dirToMap } from './terrain.js';
import * as V from './vec.js';

const DEG = Math.PI / 180;

export function gravityAt(r) {
  const d = V.len(r);
  return V.scale(r, -MOON.mu / (d * d * d));
}

/** Local frame at map point (x, y): up, along-track (+x), cross-track (+y). */
export function localFrame(x, y) {
  const up = mapToDir(x, y);
  const a = mapToMCI(x - 0.5, y, 0), b = mapToMCI(x + 0.5, y, 0);
  let fwd = V.norm(V.sub(b, a));
  fwd = V.norm(V.sub(fwd, V.scale(up, V.dot(fwd, up))));
  const left = V.cross(up, fwd);
  return { up, fwd, left };
}

// ----------------------------------------------------------------------------

export const SCENARIOS = {
  pdi: { label: 'Powered descent (15 km)', note: 'Full braking burn from a 15 x 100 km orbit' },
  approach: { label: 'Approach (2.5 km)', note: 'Pitch-over, target in sight' },
  terminal: { label: 'Final 150 m', note: 'Hand-flown vertical descent' },
};

export class Simulation {
  /**
   * @param {object} opts
   *   vehicle   one of VEHICLES
   *   terrain   Terrain
   *   scenario  'pdi' | 'approach' | 'terminal'
   *   failures  boolean, random engine-out during braking
   *   seed      number for failure timing
   */
  constructor({ vehicle, terrain, scenario = 'pdi', failures = false, seed = 1 }) {
    this.v = vehicle;
    this.terrain = terrain;
    this.scenario = scenario;
    this.failures = failures;
    this.rng = mulberry(seed);
    this.t = 0;
    this.events = [];
    this.mode = 'AUTO';           // AUTO | ASSIST | DIRECT
    this.result = null;           // set on touchdown
    this.enginesOut = {};         // engineKey -> count
    this.manual = { throttle: 0.5, pitch: 0, yaw: 0, vCmd: null, engine: null };
    this.track = [];
    this.target = { x: 0, y: 0 };
    this.init();
  }

  init() {
    const veh = this.v;
    const mass0 = veh.dryMass + veh.payloadMass + veh.propellant;
    // Every scenario starts at powered descent initiation from a 15 x 100 km
    // orbit; later scenarios fast-forward the nominal autopilot to their start
    // point, so position, velocity, attitude and propellant are all consistent.
    const rp = MOON.radius + 15000, ra = MOON.radius + 100000;
    const vh = Math.sqrt(MOON.mu * (2 / rp - 2 / (rp + ra)));
    // Start uprange so the braking burn averages ~82% of the usable acceleration
    const g = veh.gates[0].to;
    const aAvg = 0.82 * Math.min(veh.accelCap, maxThrust(veh, veh.gates[0].engine) / mass0);
    const tb = (vh - g.vel[0]) / aAvg;
    const x = g.pos[0] - (vh + g.vel[0]) / 2 * tb;
    const fr = localFrame(x, 0);
    this.r = mapToMCI(x, 0, 15000); // heights are relative to the target (h = 0)
    this.vel = V.scale(fr.fwd, vh);
    this.prop = veh.propellant;
    this.mass = mass0;
    this.axis = V.scale(fr.fwd, -1); // retrograde
    this.engine = veh.gates[0].engine;
    this.throttle = 0;           // actual, fraction of the active group's max
    this.thrustCmd = 0;          // N
    this.startPhase(0);

    if (this.scenario !== 'pdi') {
      const stopAt = this.scenario === 'approach' ? 2500 : 150;
      while (this.heightAboveTarget > stopAt && !this.result && this.t < 3000) this.step(0.05);
      this.tgoEnd -= this.t;
      this.t = 0;
      this.events = [];
      this.track = [];
    }
    this.log(`${SCENARIOS[this.scenario].label}: ${veh.name}`);
    if (this.scenario !== 'pdi') this.log(`Phase: ${this.phaseName}`);
    if (this.failures && veh.engines.main.count > 1 && this.scenario === 'pdi') {
      // One main-engine failure at a random time during braking
      this.failAt = 20 + this.rng() * 140;
    }
  }

  log(msg) { this.events.push({ t: this.t, msg }); }

  // ---------- state queries ----------
  get map() { return dirToMap(...V.norm(this.r)); }
  get up() { return V.norm(this.r); }
  terrainBelow() { const [x, y] = this.map; return this.terrain.height(x, y); }
  get altitude() { return V.len(this.r) - MOON.radius - this.terrainBelow(); } // radar altitude (AGL)
  get heightAboveTarget() { return V.len(this.r) - MOON.radius; }
  get vVert() { return V.dot(this.vel, this.up); }
  get vHorizVec() { const u = this.up; return V.sub(this.vel, V.scale(u, V.dot(this.vel, u))); }
  get vHoriz() { return V.len(this.vHorizVec); }
  get rangeToTarget() { const [x, y] = this.map; return Math.hypot(x - this.target.x, y - this.target.y); }
  get tiltDeg() { return V.angleBetween(this.axis, this.up) / DEG; }
  get thrust() { return this.throttle * maxThrust(this.v, this.engine, this.enginesOut[this.engine] || 0); }
  get twr() { return maxThrust(this.v, this.engine, this.enginesOut[this.engine] || 0) / (this.mass * V.len(gravityAt(this.r))); }
  get activeEngines() {
    const e = this.v.engines[this.engine];
    const avail = e.count - (this.enginesOut[this.engine] || 0);
    if (this.thrust <= 0) return 0;
    if (e.position === 'mid') return avail; // thruster ring fires together
    return Math.min(avail, Math.max(1, Math.ceil(this.thrust / e.thrustEach - 1e-6)));
  }
  /** Delta-v left on the ascent engine with the propellant on board. */
  get deltaVRemaining() {
    const e = this.v.engines[this.v.ascentEngine];
    return e.isp * G0 * Math.log(this.mass / (this.v.dryMass + this.v.payloadMass));
  }
  get ascentMargin() { return this.deltaVRemaining - this.v.ascentDv; }

  // ---------- guidance ----------
  gateState(i) {
    const g = this.v.gates[i].to;
    const fr = localFrame(g.pos[0], 0);
    const r = mapToMCI(g.pos[0], 0, g.pos[1]);
    const v = V.add(V.scale(fr.fwd, g.vel[0]), V.scale(fr.up, g.vel[1]));
    return { r, v };
  }

  accelLimits(engineKey) {
    const out = this.enginesOut[engineKey] || 0;
    const aMax = Math.min(this.v.accelCap, maxThrust(this.v, engineKey, out) / this.mass);
    const aMin = minThrust(this.v, engineKey) / this.mass;
    return { aMax, aMin };
  }

  /** Energy-optimal (ZEM/ZEV) control acceleration and its end value. */
  zemZev(rf, vf, t) {
    const g = gravityAt(this.r);
    const zem = V.sub(rf, V.add(V.add(this.r, V.scale(this.vel, t)), V.scale(g, 0.5 * t * t)));
    const zev = V.sub(vf, V.add(this.vel, V.scale(g, t)));
    const u0 = V.add(V.scale(zem, 6 / (t * t)), V.scale(zev, -2 / t));
    const uf = V.add(V.scale(zem, -6 / (t * t)), V.scale(zev, 4 / t));
    return { u0, uf };
  }

  /** Pick the shortest time-to-go whose acceleration profile fits the engines. */
  planTgo(i) {
    const { r, v } = this.gateState(i);
    const eng = this.v.gates[i].engine;
    const { aMax, aMin } = this.accelLimits(eng);
    const tMin = i === 1 ? 28 : 8;
    let best = null, bestViol = Infinity;
    for (let t = tMin; t < 1500; t *= 1.01) {
      const { u0, uf } = this.zemZev(r, v, t);
      const hi = Math.max(V.len(u0), V.len(uf));
      // the profile is linear in time, so check a few interior points for the floor
      let lo = Infinity;
      for (let k = 0; k <= 8; k++) {
        const s = k / 8;
        lo = Math.min(lo, V.len(V.add(V.scale(u0, 1 - s), V.scale(uf, s))));
      }
      const frac = i === 0 ? 0.92 : 0.7;
      const viol = Math.max(0, hi - frac * aMax) + Math.max(0, 1.04 * aMin - lo);
      if (viol === 0) { best = t; bestViol = 0; break; }
      if (viol < bestViol) { bestViol = viol; best = t; }
    }
    this.planViolation = bestViol / aMax; // 0 = the engines can fly this plan
    return best;
  }

  startPhase(i) {
    this.phase = i;
    const gate = this.v.gates[i];
    if (gate.engine !== this.engine) {
      this.engine = gate.engine;
      this.throttle = 0;
      this.log(`${this.v.engines[gate.engine].label} ignition`);
    }
    this.phaseName = gate.name;
    if (gate.name !== 'TERMINAL') {
      this.tgoEnd = this.t + this.planTgo(i);
    }
    this.log(`Phase: ${gate.name}`);
  }

  get tgo() { return this.phaseName === 'TERMINAL' ? null : Math.max(0, this.tgoEnd - this.t); }

  /** Commanded control acceleration (excluding gravity) from the autopilot. */
  autopilotAccel() {
    const up = this.up;
    const g = gravityAt(this.r);
    if (this.aborting) return this.abortAccel();
    if (this.phaseName === 'TERMINAL') return this.terminalAccel();
    let t = this.tgoEnd - this.t;
    if (t < 2.0) {
      this.startPhase(this.phase + 1);
      return this.autopilotAccel();
    }
    const { r, v } = this.gateState(this.phase);
    const { u0 } = this.zemZev(r, v, t);
    // Never command thrust that points below the horizon near the ground
    if (this.altitude < 500 && V.dot(u0, up) < 0.2 * V.len(u0)) return V.add(u0, V.scale(up, 0.3 * V.len(u0)));
    return u0;
  }

  /** Abort: burn prograde, slightly upward, until back in a safe orbit. */
  abortAccel() {
    const up = this.up;
    const fr = localFrame(...this.map);
    const vCirc = Math.sqrt(MOON.mu / V.len(this.r));
    const h = this.heightAboveTarget;
    if (V.dot(this.vel, fr.fwd) > vCirc + 15 && h > 10000) {
      this.result = { outcome: 'ABORTED TO ORBIT', faults: ['engine failure left no landing solution'],
        vV: 0, vH: this.vHoriz, tilt: this.tiltDeg, groundTilt: 0, rock: 0, range: this.rangeToTarget,
        tipAngle: 0, prop: this.prop, ascentMargin: this.ascentMargin, time: this.t };
      this.log(`Safe orbit reached, ${(this.prop / 1000).toFixed(1)} t propellant left`);
      return [0, 0, 0];
    }
    const climb = h < 12000 ? 0.35 : 0.08;
    return V.scale(V.norm(V.add(fr.fwd, V.scale(up, climb))), 100);
  }

  /** Terminal descent: null horizontal drift over the pad, fly a rate profile down. */
  terminalAccel() {
    const up = this.up;
    const g = gravityAt(this.r);
    const [x, y] = this.map;
    const fr = localFrame(x, y);
    const ex = this.target.x - x, ey = this.target.y - y;
    const vh = this.vHorizVec;
    const vCmdH = V.clampLen(V.add(V.scale(fr.fwd, 0.25 * ex), V.scale(fr.left, 0.25 * ey)), 1.2);
    const alt = this.altitude;
    const vCmdZ = -Math.max(0.7, Math.min(3.0, 0.08 * alt + 0.6));
    const aH = V.scale(V.sub(vCmdH, vh), 0.6);
    const aZ = (vCmdZ - this.vVert) * 0.9;
    return V.add(V.add(aH, V.scale(up, aZ)), V.scale(g, -1));
  }

  /** Assisted manual (like Apollo P66): pilot steers a velocity target, computer flies it. */
  assistAccel() {
    const g = gravityAt(this.r);
    if (!this.manual.vCmd) this.manual.vCmd = [...this.vel];
    const err = V.sub(this.manual.vCmd, this.vel);
    return V.add(V.scale(err, 0.5), V.scale(g, -1));
  }

  setMode(m) {
    if (m === this.mode || this.result) return;
    this.mode = m;
    if (m === 'ASSIST') this.manual.vCmd = [...this.vel];
    if (m === 'DIRECT') {
      this.manual.throttle = this.throttle;
      this.manual.engine = this.engine;
    }
    if (m === 'AUTO') {
      // Re-plan from where we are: pick the earliest gate still ahead
      let i = this.phase;
      const alt = this.heightAboveTarget;
      if (alt < 200 && this.rangeToTarget < 400) i = this.v.gates.length - 1;
      else if (alt < 3000) i = Math.max(i, 1);
      this.startPhase(i);
    }
    this.log(`Mode: ${m}`);
  }

  // ---------- integration ----------
  step(dt) {
    if (this.result) return;
    this.t += dt;
    const veh = this.v;

    // Scheduled failure
    if (this.failAt && this.t >= this.failAt && this.engine === 'main') {
      this.enginesOut.main = (this.enginesOut.main || 0) + 1;
      this.failAt = null;
      this.log(`ENGINE OUT: ${veh.engines.main.label} ${this.enginesOut.main} of ${veh.engines.main.count} lost`);
      if (this.mode === 'AUTO' && this.phaseName !== 'TERMINAL') {
        this.tgoEnd = this.t + this.planTgo(this.phase);
        if (this.planViolation > 0.12) {
          this.aborting = true;
          this.log('No landing solution with remaining thrust: ABORT TO ORBIT');
        }
      }
    }

    // Desired control acceleration -> thrust axis + thrust magnitude
    let aCmd, thrustCmd, axisCmd;
    if (this.mode === 'DIRECT') {
      if (this.manual.engine && this.manual.engine !== this.engine && veh.engines[this.manual.engine]) {
        this.engine = this.manual.engine; this.throttle = 0;
        this.log(`${veh.engines[this.engine].label} selected`);
      }
      const fr = localFrame(...this.map);
      const p = this.manual.pitch * DEG, yw = this.manual.yaw * DEG;
      // pitch tilts the axis toward -fwd (retrograde) when positive; yaw toward +left
      axisCmd = V.norm(V.add(V.add(V.scale(fr.up, Math.cos(p) * Math.cos(yw)), V.scale(fr.fwd, -Math.sin(p))), V.scale(fr.left, Math.sin(yw))));
      thrustCmd = this.manual.throttle * maxThrust(veh, this.engine, this.enginesOut[this.engine] || 0);
    } else {
      aCmd = this.mode === 'AUTO' ? this.autopilotAccel() : this.assistAccel();
      const { aMax } = this.accelLimits(this.engine);
      const aMag = Math.min(V.len(aCmd), aMax);
      axisCmd = V.len(aCmd) > 1e-6 ? V.norm(aCmd) : this.up;
      // never point the engines more than 100 deg away from straight down
      const tilt = V.angleBetween(axisCmd, this.up);
      if (tilt > 100 * DEG) axisCmd = V.slerpLimited(this.up, axisCmd, 100 * DEG);
      thrustCmd = aMag * this.mass;
      // Engines can't throttle below their floor: coast (engines off) instead
      const floorN = veh.engines[this.engine].thrustEach * veh.engines[this.engine].minThrottle;
      if (this.phaseName !== 'TERMINAL' && !this.aborting) {
        if (!this.coasting && thrustCmd < 0.6 * floorN) { this.coasting = true; this.log('Throttle floor: engines off, coasting'); }
        else if (this.coasting && thrustCmd > 0.95 * floorN) { this.coasting = false; this.log(`${veh.engines[this.engine].label} relight`); }
      } else this.coasting = false;
      if (this.coasting) thrustCmd = 0;
    }
    this.axisCmd = axisCmd;

    // Attitude: slew-rate limited
    this.axis = V.slerpLimited(this.axis, axisCmd, veh.slewRateDeg * DEG * dt);
    const pointErr = V.angleBetween(this.axis, axisCmd);
    if (pointErr > 45 * DEG && this.mode !== 'DIRECT') thrustCmd *= 0.3; // wait for the turn

    // Throttle allocation: whole engines, each between its floor and 100%
    const e = veh.engines[this.engine];
    const avail = e.count - (this.enginesOut[this.engine] || 0);
    const tMax = e.thrustEach * avail;
    let target = 0;
    if (this.prop > 0 && avail > 0 && thrustCmd > 0) {
      const floor = e.thrustEach * e.minThrottle;
      target = Math.min(Math.max(thrustCmd, floor), tMax) / tMax;
      if (this.mode === 'DIRECT' && this.manual.throttle <= 0.001) target = 0;
    }
    this.throttle += (target - this.throttle) * Math.min(1, dt / e.lag);
    this.thrustCmd = thrustCmd;

    // Translational dynamics (semi-implicit, small dt)
    const T = this.prop > 0 ? this.throttle * tMax : 0;
    const accel = V.add(gravityAt(this.r), V.scale(this.axis, T / this.mass));
    this.accel = accel;
    this.vel = V.addScaled(this.vel, accel, dt);
    this.r = V.addScaled(this.r, this.vel, dt);
    const mdot = T / (e.isp * G0);
    const burned = Math.min(this.prop, mdot * dt);
    this.prop -= burned;
    this.mass -= burned;
    if (this.prop <= 0 && !this.outOfProp) { this.outOfProp = true; this.log('PROPELLANT DEPLETED'); }

    if ((this.trackTimer = (this.trackTimer || 0) + dt) > 0.5) {
      this.trackTimer = 0;
      const [x, y] = this.map;
      this.track.push([x, y, this.heightAboveTarget]);
    }

    // Contact
    if (this.altitude <= 0) this.touchdown();
  }

  touchdown() {
    const veh = this.v, L = veh.limits;
    const [x, y] = this.map;
    const fr = localFrame(x, y);
    const vV = -this.vVert, vH = this.vHoriz, tilt = this.tiltDeg;
    // Footpad heights and rocks
    const pads = [];
    for (let k = 0; k < veh.legCount; k++) {
      const a = (k / veh.legCount) * Math.PI * 2;
      const px = x + Math.cos(a) * veh.legRadius, py = y + Math.sin(a) * veh.legRadius;
      pads.push({ h: this.terrain.height(px, py), rock: this.terrain.rockHeightAt(px, py) });
    }
    const hs = pads.map(p => p.h + p.rock);
    const groundTilt = Math.atan((Math.max(...hs) - Math.min(...hs)) / (2 * veh.legRadius)) / DEG;
    const rock = Math.max(...pads.map(p => p.rock));
    const restTilt = groundTilt + tilt * 0.5;
    const tipAngle = Math.atan(veh.legRadius / veh.cgHeight) / DEG;
    const range = this.rangeToTarget;
    const faults = [];
    if (vV > L.vVert) faults.push(`descent rate ${vV.toFixed(1)} m/s > ${L.vVert}`);
    if (vH > L.vHoriz) faults.push(`drift ${vH.toFixed(1)} m/s > ${L.vHoriz}`);
    if (tilt > L.tiltDeg) faults.push(`attitude ${tilt.toFixed(1)}° > ${L.tiltDeg}°`);
    if (groundTilt > L.slopeDeg) faults.push(`ground slope ${groundTilt.toFixed(1)}° > ${L.slopeDeg}°`);
    if (rock > L.rockHeight) faults.push(`footpad on a ${rock.toFixed(1)} m boulder`);
    let outcome;
    if (vV > L.vVert * 3 || vH > L.vHoriz * 5 || restTilt > tipAngle) outcome = restTilt > tipAngle ? 'TIPPED OVER' : 'CRASH';
    else if (faults.length) outcome = 'HARD LANDING';
    else outcome = 'LANDED';
    this.result = {
      outcome, faults, vV, vH, tilt, groundTilt, rock, range, tipAngle,
      prop: this.prop, ascentMargin: this.ascentMargin, time: this.t,
    };
    this.vel = [0, 0, 0];
    this.throttle = 0;
    this.log(`${outcome} — ${range.toFixed(1)} m from target`);
  }
}

function mulberry(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
