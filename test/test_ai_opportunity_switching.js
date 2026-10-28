import assert from 'node:assert';
import * as C from '../src/constants.js';
import { createWorld, applyAction, gateX } from '../src/sim/world.js';
import { AiController } from '../src/sim/ai.js';
import { runDispatcher } from '../src/sim/ai/dispatcher.js';
import { updateSlit } from '../src/sim/ai/slit.js';
import { PROFILES } from '../src/sim/ai/profiles.js';
import { isLineOfSightBlockedBySmoke, getPredictedEnemyState } from '../src/sim/ai/perception.js';

console.log('\n--- Running AI Opportunity Targeting, Hold Times & Vector Tests ---');

// 1. Debug vector length matches shell flight range
{
  assert.strictEqual(
    C.DEBUG_VECTOR_LENGTH_M,
    C.SHELL_RANGE_M,
    'DEBUG_VECTOR_LENGTH_M must match SHELL_RANGE_M (32m) so vector indicator shows exact max flight range',
  );
  assert.strictEqual(C.DEBUG_VECTOR_LENGTH_M, 32);
}

// 2. Minimum 2.0s hold time and 0.5s post-fire hold time in Dispatcher
{
  const world = createWorld();
  const ctl = new AiController(0);
  const myField = world.tanks.filter((t) => t.owner === 0 && t.status === 'field');
  const enemyField = world.tanks.filter((t) => t.owner === 1 && t.status === 'field');
  const activeTank = myField[0];
  const otherTank = myField[1];
  assert.ok(activeTank && otherTank);

  // Set other tank to face acute hazard emergency
  otherTank.speed = 10;
  world.mines = [{ x: otherTank.x + 5, y: otherTank.y }];

  // Case A: sliceTimer < 2.0s -> cannot switch
  ctl.sliceTimer = 1.0;
  ctl.lastFiredTime = 0;
  ctl.simTime = 10.0;
  const res1 = runDispatcher(ctl, world, myField, enemyField, PROFILES.HARD, activeTank);
  assert.strictEqual(res1.tank.id, activeTank.id, 'Dispatcher holds tank when sliceTimer < 2.0s');

  // Case B: sliceTimer >= 2.0s BUT just fired 0.2s ago -> cannot switch
  ctl.sliceTimer = 2.5;
  ctl.simTime = 10.0;
  ctl.lastFiredTime = 9.8; // only 0.2s since fire
  const res2 = runDispatcher(ctl, world, myField, enemyField, PROFILES.HARD, activeTank);
  assert.strictEqual(res2.tank.id, activeTank.id, 'Dispatcher holds tank when post-fire duration < 0.5s');

  // Case C: sliceTimer >= 2.0s AND post-fire time >= 0.5s -> can switch
  ctl.sliceTimer = 2.5;
  ctl.simTime = 10.0;
  ctl.lastFiredTime = 9.4; // 0.6s since fire
  // Ensure otherTank urgency exceeds activeTank by threshold delta
  ctl.lastCommandedTime.set(otherTank.id, 0); // long neglected
  const res3 = runDispatcher(ctl, world, myField, enemyField, PROFILES.HARD, activeTank);
  assert.strictEqual(res3.tank.id, otherTank.id, 'Dispatcher switches when sliceTimer >= 2s and post-fire hold >= 0.5s');
}

// 3. Minimum 2.0s hold time and 0.5s post-fire hold time in Slit window
{
  const world = createWorld();
  const ctl = new AiController(0);
  const pl = world.players[0];
  pl.view = 'window';
  pl.windowIdx = 0;

  // Move enemies far away so window is idle
  for (const t of world.tanks) {
    if (t.owner === 1) {
      t.x = 200;
      t.y = 50;
    }
  }

  // Case A: slitTimer < 2.0s -> cannot exit window
  ctl.slitTimer = 0.5;
  ctl.lastFiredTime = 0;
  ctl.simTime = 5.0;
  updateSlit(ctl, world, 0.1, PROFILES.HARD);
  assert.strictEqual(pl.view, 'window', 'Slit window held when slitTimer < 2.0s');

  // Case B: slitTimer >= 2.0s BUT fired 0.1s ago -> cannot exit window
  ctl.slitTimer = 2.2;
  ctl.simTime = 5.0;
  ctl.lastFiredTime = 4.9; // 0.1s since fire
  updateSlit(ctl, world, 0.1, PROFILES.HARD);
  assert.strictEqual(pl.view, 'window', 'Slit window held when post-fire hold < 0.5s');

  // Case C: slitTimer >= 2.0s AND post-fire hold >= 0.5s -> exits window
  ctl.slitTimer = 2.2;
  ctl.simTime = 5.0;
  ctl.lastFiredTime = 4.2; // 0.8s since fire
  updateSlit(ctl, world, 0.1, PROFILES.HARD);
  assert.strictEqual(pl.view, 'tank', 'Slit window exits to field tank after 2.0s min hold and 0.5s post-fire hold');
}

// 4. Smoke LOS blocking and prediction confidence decay
{
  const world = createWorld();
  world.smokes = [
    { x: 50, y: 50, t: 2.0 },
  ];

  // Ray through smoke is blocked
  const blocked = isLineOfSightBlockedBySmoke(world, 30, 50, 70, 50);
  assert.strictEqual(blocked, true, 'Line of sight through smoke cloud is blocked');

  // Target inside smoke is blocked
  const insideBlocked = isLineOfSightBlockedBySmoke(world, 30, 50, 52, 50);
  assert.strictEqual(insideBlocked, true, 'Target inside smoke is blocked');

  // Tracker prediction confidence decays
  const tracker = new Map();
  tracker.set(99, {
    x: 52,
    y: 50,
    speed: 0,
    heading: 0,
    isStationary: true,
    lastSeenTime: 10.0,
  });

  const predFresh = getPredictedEnemyState(tracker, { id: 99 }, 10.5, 'HARD');
  assert.ok(predFresh, 'Prediction available shortly after entering smoke');
  assert.ok(predFresh.hitProb <= 0.65, 'Initial confidence is capped (not 0.95)');

  const predOld = getPredictedEnemyState(tracker, { id: 99 }, 15.0, 'HARD');
  assert.ok(predOld.hitProb < predFresh.hitProb, 'Confidence decays over time');
}

console.log('✔ AI Opportunity Targeting, Hold Times & Vector Tests passed\n');
