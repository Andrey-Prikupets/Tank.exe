import assert from 'node:assert';
import * as C from '../src/constants.js';
import { createWorld, applyAction, gateX, inwardDir } from '../src/sim/world.js';
import { AiController } from '../src/sim/ai.js';
import { getRoleWaypoint } from '../src/sim/ai/roles.js';

console.log('--- Running AI Slit Window Defense & Sentry Tests ---');

// 1. SENTRY role coordinates with slit gun and keeps gate corridor clear
{
  const world = createWorld();
  const owner = 0;
  const pl = world.players[owner];
  const tank = { id: 1, x: 10, y: 50 };

  // When in Window 0 (North, y=42), sentry covers South flank
  pl.view = 'window';
  pl.windowIdx = 0;
  const wp0 = getRoleWaypoint(tank, 'SENTRY', 'CHARLIE', owner, gateX(1 - owner), 0, world);
  assert.ok(wp0.y > C.GATE_CENTER_Y_M + 10, 'Sentry covers South flank when Window 0 is North');
  assert.ok(Math.abs(wp0.y - C.GATE_CENTER_Y_M) > 10, 'Sentry leaves gate center corridor unobstructed');

  // When in Window 1 (South, y=58), sentry covers North flank
  pl.windowIdx = 1;
  const wp1 = getRoleWaypoint(tank, 'SENTRY', 'CHARLIE', owner, gateX(1 - owner), 0, world);
  assert.ok(wp1.y < C.GATE_CENTER_Y_M - 10, 'Sentry covers North flank when Window 1 is South');
  assert.ok(Math.abs(wp1.y - C.GATE_CENTER_Y_M) > 10, 'Sentry leaves gate center corridor unobstructed');
}

// 2. Tracking continues while in window view
{
  const world = createWorld();
  const ctl = new AiController(0);
  const pl = world.players[0];
  pl.view = 'window';
  pl.windowIdx = 0;

  // Advance friendly field tanks forward into the field so they do not block the window
  for (const t of world.tanks) {
    if (t.owner === 0 && t.status === 'field') {
      t.x = 80;
    }
  }

  // Place enemy within line of sight of window (wx ~ 0.5, wy = 42)
  const enemy = world.tanks.find((t) => t.owner === 1 && t.status === 'field');
  enemy.x = 25;
  enemy.y = 42;
  enemy.speed = 0;

  ctl.update(world, 0.1, 'MEDIUM');
  assert.ok(ctl.enemyTracker.has(enemy.id), 'Visual intelligence updates enemy tracking from slit window');
  const track = ctl.enemyTracker.get(enemy.id);
  assert.strictEqual(track.x, 25);
  assert.strictEqual(track.y, 42);
}

// 3. Window exit when idle or when field tank needs control
{
  const world = createWorld();
  const ctl = new AiController(0);
  const pl = world.players[0];
  pl.view = 'window';
  pl.windowIdx = 0;

  // Move enemies far away beyond slit range
  for (const t of world.tanks) {
    if (t.owner === 1) {
      t.x = 200;
      t.y = 50;
    }
  }

  // After idling beyond AI_SLIT_EXIT_IDLE_S, AI exits back to a field tank
  for (let tick = 0; tick < 25; tick++) {
    ctl.update(world, 0.1, 'MEDIUM');
  }
  assert.strictEqual(pl.view, 'tank', 'AI leaves slit window when no threats are in coverage');
}

console.log('✔ AI Slit Window Defense & Sentry tests passed\n');
