import assert from 'node:assert';
import * as C from '../src/constants.js';
import { createWorld, step } from '../src/sim/world.js';
import { AiController } from '../src/sim/ai.js';

console.log('\n--- Running AI CvC Integration Test (10s Full Physics Simulation) ---');

const world = createWorld({ obstacles: true, pits: true });
const ai0 = new AiController(0);
const ai1 = new AiController(1);

const dt = 1 / 60; // 60Hz
const simDurationSec = 10.0;
const totalSteps = Math.round(simDurationSec / dt);

let maxRedSpeed = 0;
let maxBlueSpeed = 0;
let pitsEntered = 0;

for (let s = 0; s < totalSteps; s++) {
  // Update AI controllers
  ai0.update(world, dt, 'HARD');
  ai1.update(world, dt, 'HARD');

  const held = {
    windowTurn: [ai0.windowTurn, ai1.windowTurn],
  };

  // Step physics simulation
  step(world, dt, held);

  // Check state integrity
  for (const t of world.tanks) {
    if (t.status === 'field') {
      assert.ok(!Number.isNaN(t.x) && !Number.isNaN(t.y), `Tank ${t.id} coordinates must be numbers`);
      assert.ok(!Number.isNaN(t.speed) && !Number.isNaN(t.heading), `Tank ${t.id} physics must be numbers`);
      assert.ok(t.x >= -15 && t.x <= C.FIELD_LENGTH_M + 15, `Tank ${t.id} must be within bounds`);
      assert.ok(t.y >= 0 && t.y <= C.FIELD_WIDTH_M, `Tank ${t.id} must stay in field Y`);

      if (t.owner === 0 && t.cmdSpeedKmh > maxRedSpeed) maxRedSpeed = t.cmdSpeedKmh;
      if (t.owner === 1 && t.cmdSpeedKmh > maxBlueSpeed) maxBlueSpeed = t.cmdSpeedKmh;
    }
  }

  // Check pit deaths
  for (const ev of world.events) {
    if (ev.type === 'pit_death') {
      pitsEntered++;
    }
  }
}

console.log(`Simulation complete: ${totalSteps} ticks (${simDurationSec}s simulated).`);
console.log(`Max Red commanded speed: ${maxRedSpeed} km/h (HARD tier reached 36 km/h)`);
console.log(`Max Blue commanded speed: ${maxBlueSpeed} km/h (HARD tier reached 36 km/h)`);
console.log(`Pits entered: ${pitsEntered}`);

assert.strictEqual(maxRedSpeed, 36, 'Red AI must achieve top maneuver speed (36 km/h) on HARD');
assert.strictEqual(maxBlueSpeed, 36, 'Blue AI must achieve top maneuver speed (36 km/h) on HARD');
assert.strictEqual(pitsEntered, 0, 'Zero tanks must fall into lethal pits during autonomous navigation');

console.log('✔ AI CvC Integration Test passed with 100% safety and top maneuver speed!\n');
