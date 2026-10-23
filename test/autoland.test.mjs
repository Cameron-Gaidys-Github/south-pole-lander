// Headless check: the autopilot should land every vehicle from every scenario.
// Run: node test/autoland.test.mjs   (add --verbose for the event log)
import { VEHICLES } from '../src/core/vehicles.js';
import { makeAnalogTerrain } from '../src/core/terrain.js';
import { Simulation } from '../src/core/sim.js';

const verbose = process.argv.includes('--verbose');
const terrain = makeAnalogTerrain();
let failed = 0;

for (const vid of Object.keys(VEHICLES)) {
  for (const scenario of ['pdi', 'approach', 'terminal']) {
    for (const failures of [false, true]) {
      if (failures && scenario !== 'pdi') continue;
      const sim = new Simulation({ vehicle: VEHICLES[vid], terrain, scenario, failures, seed: 3 });
      const dt = 0.02;
      let maxA = 0;
      while (!sim.result && sim.t < 1500) {
        sim.step(dt);
        if (sim.accel) {
          const g = 1.62;
          maxA = Math.max(maxA, sim.thrust / sim.mass);
        }
      }
      const r = sim.result;
      const ok = r && ((r.outcome === 'LANDED' && r.range < 30) || (failures && r.outcome === 'ABORTED TO ORBIT'));
      if (!ok) failed++;
      console.log(
        `${ok ? 'PASS' : 'FAIL'} ${vid.padEnd(8)} ${scenario.padEnd(8)} fail=${failures ? 'Y' : 'N'} ` +
        (r ? `${r.outcome.padEnd(12)} range ${r.range.toFixed(1)} m  vV ${r.vV.toFixed(2)}  vH ${r.vH.toFixed(2)}  tilt ${r.tilt.toFixed(1)}°  ` +
          `t ${r.time.toFixed(0)} s  prop ${(r.prop / 1000).toFixed(1)} t  ascent margin ${r.ascentMargin.toFixed(0)} m/s  peak accel ${maxA.toFixed(2)}` +
          (r.faults.length ? `  [${r.faults.join('; ')}]` : '')
          : `no touchdown, alt ${sim.altitude.toFixed(0)} m`)
      );
      if (verbose || !ok) for (const e of sim.events) console.log(`    T+${e.t.toFixed(1).padStart(6)}  ${e.msg}`);
    }
  }
}
process.exit(failed ? 1 : 0);
