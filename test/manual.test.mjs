// Headless check of the pilot modes: ASSIST holding a slow sink, DIRECT holding attitude.
import { VEHICLES } from '../src/core/vehicles.js';
import { makeAnalogTerrain } from '../src/core/terrain.js';
import { Simulation, localFrame } from '../src/core/sim.js';
import * as V from '../src/core/vec.js';

const terrain = makeAnalogTerrain();
let failed = 0;
for (const vid of Object.keys(VEHICLES)) {
  const sim = new Simulation({ vehicle: VEHICLES[vid], terrain, scenario: 'terminal' });
  sim.setMode('ASSIST');
  // pilot: null the drift, sink at 1 m/s
  sim.manual.vCmd = V.scale(sim.up, -1.0);
  while (!sim.result && sim.t < 600) sim.step(0.02);
  const r = sim.result;
  const ok = r && r.outcome === 'LANDED';
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${vid} ASSIST  ${r ? r.outcome + ' vV ' + r.vV.toFixed(2) + ' vH ' + r.vH.toFixed(2) + ' range ' + r.range.toFixed(1) + ' m' : 'no touchdown'}`);

  const d = new Simulation({ vehicle: VEHICLES[vid], terrain, scenario: 'terminal' });
  d.setMode('DIRECT');
  d.manual.pitch = 0; d.manual.yaw = 0; d.manual.throttle = 0;
  if (d.v.engines.landing) d.manual.engine = 'landing';
  // simple pilot: hold vertical, throttle for -1.5 m/s
  while (!d.result && d.t < 600) {
    const e = d.v.engines[d.engine];
    const tMax = e.thrustEach * e.count;
    const want = d.mass * (1.62 + 0.8 * (-1.5 - d.vVert));
    d.manual.throttle = Math.max(0.001, Math.min(1, want / tMax));
    // lean against the drift (pitch + tilts the thrust axis retrograde)
    const fr = localFrame(...d.map);
    d.manual.pitch = Math.max(-15, Math.min(15, V.dot(d.vel, fr.fwd) * 3));
    d.manual.yaw = Math.max(-15, Math.min(15, -V.dot(d.vel, fr.left) * 3));
    d.step(0.02);
  }
  const q = d.result;
  const ok2 = q && q.outcome === 'LANDED';
  if (!ok2) failed++;
  console.log(`${ok2 ? 'PASS' : 'FAIL'} ${vid} DIRECT  ${q ? q.outcome + ' vV ' + q.vV.toFixed(2) + ' vH ' + q.vH.toFixed(2) + ' tilt ' + q.tilt.toFixed(1) + (q.faults.length ? ' [' + q.faults.join('; ') + ']' : '') : 'no touchdown'}`);
}
process.exit(failed ? 1 : 0);
