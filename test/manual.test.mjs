// Headless checks of the crew modes, flown by a simple scripted "pilot":
//   ROD     pilot tilts with the RHC to null drift; computer holds the sink rate
//   MANUAL  pilot flies RHC + throttle lever
//   LPD     redesignating the landing point in AUTO moves the touchdown
import { VEHICLES } from '../src/core/vehicles.js';
import { makeAnalogTerrain } from '../src/core/terrain.js';
import { Simulation, localFrame } from '../src/core/sim.js';
import * as V from '../src/core/vec.js';

const terrain = makeAnalogTerrain();
let failed = 0;
const report = (ok, label, r) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label.padEnd(18)} ${r ? `${r.outcome} vV ${r.vV.toFixed(2)} vH ${r.vH.toFixed(2)} tilt ${r.tilt.toFixed(1)}° range ${r.range.toFixed(1)} m` + (r.faults.length ? ' [' + r.faults.join('; ') + ']' : '') : 'no touchdown'}`);
};

/** Pilot: stick the RHC to tilt against horizontal drift (rate command). */
function pilotRHC(sim) {
  const fr = localFrame(...sim.map);
  const vf = V.dot(sim.vel, fr.fwd), vl = V.dot(sim.vel, fr.left);
  // desired thrust-axis tilt (rad) toward -velocity, limited to 15 deg
  const wantF = Math.max(-0.26, Math.min(0.26, -0.08 * vf)), wantL = Math.max(-0.26, Math.min(0.26, -0.08 * vl));
  const ax = sim.axis;
  const nowF = V.dot(ax, fr.fwd), nowL = V.dot(ax, fr.left);
  // body X roughly downrange after pitch-over: pitch (+) tilts axis toward +X, roll (+) toward -Y
  const bx = sim.bodyX, by = sim.bodyY;
  const errF = wantF - nowF, errL = wantL - nowL;
  const errX = errF * V.dot(fr.fwd, bx) + errL * V.dot(fr.left, bx);
  const errY = errF * V.dot(fr.fwd, by) + errL * V.dot(fr.left, by);
  sim.ctl.rhc = [Math.max(-1, Math.min(1, -errY * 4)), Math.max(-1, Math.min(1, errX * 4)), 0];
}

for (const vid of Object.keys(VEHICLES)) {
  // ROD
  {
    const sim = new Simulation({ vehicle: VEHICLES[vid], terrain, scenario: 'terminal' });
    sim.rodClick(-1);                 // in AUTO, the ROD switch hands over to ROD
    while (!sim.result && sim.t < 600) {
      pilotRHC(sim);
      const want = sim.altitude > 30 ? -2.4 : -0.9;
      if (sim.rodCmd > want + 0.15) sim.rodClick(-1); else if (sim.rodCmd < want - 0.15) sim.rodClick(+1);
      sim.step(0.02);
    }
    report(sim.mode === 'ROD' && sim.result?.outcome === 'LANDED', `${vid} ROD`, sim.result);
  }
  // MANUAL
  {
    const d = new Simulation({ vehicle: VEHICLES[vid], terrain, scenario: 'terminal' });
    d.setMode('MANUAL');
    if (d.v.engines.landing) d.ctl.engine = 'landing';
    while (!d.result && d.t < 600) {
      pilotRHC(d);
      const e = d.v.engines[d.engine];
      const want = d.mass * (1.62 + 0.8 * ((d.altitude > 30 ? -2.4 : -1.0) - d.vVert)) / Math.max(0.5, V.dot(d.axis, d.up));
      d.ctl.throttle = Math.max(0.001, Math.min(1, want / (e.thrustEach * e.count)));
      d.step(0.02);
    }
    report(d.result?.outcome === 'LANDED', `${vid} MANUAL`, d.result);
  }
  // LPD redesignation during the approach
  {
    const s = new Simulation({ vehicle: VEHICLES[vid], terrain, scenario: 'approach' });
    let moved = false;
    while (!s.result && s.t < 900) {
      if (!moved && s.altitude < 1200) { s.redesignate(40, 60); moved = true; }
      s.step(0.02);
    }
    const tgt = s.target;
    const ok = s.result?.outcome === 'LANDED' && Math.hypot(tgt.x - 40, tgt.y - 60) < 1 && s.result.range < 5;
    report(ok, `${vid} LPD 72 m`, s.result);
  }
}
process.exit(failed ? 1 : 0);
