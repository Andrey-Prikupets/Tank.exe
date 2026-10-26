import assert from 'node:assert';
import * as C from '../src/constants.js';
import { createWorld, step } from '../src/sim/world.js';
import { AiController } from '../src/sim/ai.js';

console.log('\n--- Running AI CvC Long-Run Integration Test (45s Simulation, 2700 ticks) ---');

const world = createWorld({ obstacles: true, pits: true });
const ai0 = new AiController(0);
const ai1 = new AiController(1);

const dt = 1 / 60; // 60Hz
const simDurationSec = 45.0; // 45 seconds to verify no freeze after 30+ seconds
const totalSteps = Math.round(simDurationSec / dt);

let maxRedSpeed = 0;
let maxBlueSpeed = 0;
let pitsEntered = 0;
let asymmetricTicks = 0;

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

  // Check symmetry breaking across active field tanks of both brigades
  const redField = world.tanks.filter((t) => t.owner === 0 && t.status === 'field');
  const blueField = world.tanks.filter((t) => t.owner === 1 && t.status === 'field');
  if (redField.length > 0 && blueField.length > 0) {
    const redAvgY = redField.reduce((sum, t) => sum + t.y, 0) / redField.length;
    const blueAvgY = blueField.reduce((sum, t) => sum + t.y, 0) / blueField.length;
    const redAvgX = redField.reduce((sum, t) => sum + t.x, 0) / redField.length;
    const blueMirroredX = C.FIELD_LENGTH_M - (blueField.reduce((sum, t) => sum + t.x, 0) / blueField.length);
    if (Math.abs(redAvgY - blueAvgY) > 0.8 || Math.abs(redAvgX - blueMirroredX) > 1.5) {
      asymmetricTicks++;
    }
  }

  // Check pit deaths
  for (const ev of world.events) {
    if (ev.type === 'pit_death') {
      pitsEntered++;
    }
  }

  // Verify that armed tanks near enemy base avoid the lethal direct frontal slit corridor
  for (const t of world.tanks) {
    if (t.status === 'field' && t.shells > 0) {
      const enemyGate = t.owner === 0 ? C.FIELD_LENGTH_M : 0;
      const distToEnemy = Math.abs(t.x - enemyGate);
      if (distToEnemy <= 30.0) {
        assert.ok(
          t.y < 41.0 || t.y > 59.0,
          `Tank ${t.id} must not charge into direct frontal enemy slit sector (x=${t.x.toFixed(1)}, y=${t.y.toFixed(1)})`,
        );
      }
    }
  }
}

console.log(`Simulation complete: ${totalSteps} ticks (${simDurationSec}s simulated).`);
console.log(`Max Red commanded speed: ${maxRedSpeed} km/h (HARD tier reached 36 km/h)`);
console.log(`Max Blue commanded speed: ${maxBlueSpeed} km/h (HARD tier reached 36 km/h)`);
console.log(`Pits entered: ${pitsEntered}`);
console.log(`Asymmetric ticks: ${asymmetricTicks} / ${totalSteps} (${((asymmetricTicks / totalSteps) * 100).toFixed(1)}%)`);

assert.strictEqual(maxRedSpeed, 36, 'Red AI must achieve top maneuver speed (36 km/h) on HARD');
assert.strictEqual(maxBlueSpeed, 36, 'Blue AI must achieve top maneuver speed (36 km/h) on HARD');
assert.strictEqual(pitsEntered, 0, 'Zero tanks must fall into lethal pits during autonomous navigation');
assert.ok(asymmetricTicks > totalSteps * 0.5, 'Tanks must exhibit significant organic asymmetry (>50% of battle)');

console.log('✔ AI CvC Long-Run Integration Test passed with 0 freezes and verified organic asymmetry!\n');
