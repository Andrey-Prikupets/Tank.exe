import assert from 'node:assert';
import * as C from '../src/constants.js';
import { aimError, aimTurnCommandDeg, leadPoint, findAimSolution } from '../src/sim/ai/aiming.js';
import { runVcr } from '../tools/vcr.js';

console.log('\n--- Running AI Hull Aiming Tests (gun fixed to hull) ---');

const tank = { x: 100, y: 50, heading: 0, shells: 5, id: 1 };

// Error sign: target to the right (heading increases) -> positive command
assert.ok(aimTurnCommandDeg(aimError(tank, 100, 80)) > 0, 'turn toward a target at positive angle');
assert.ok(aimTurnCommandDeg(aimError(tank, 100, 20)) < 0, 'turn toward a target at negative angle');
assert.strictEqual(aimTurnCommandDeg(0.005), 0, 'dead band');
assert.strictEqual(aimTurnCommandDeg(Math.PI), C.TANK_MAX_PIVOT_TURN_DEG_S, 'capped at pivot rate');
assert.ok(Math.abs(aimTurnCommandDeg(0.1)) < Math.abs(aimTurnCommandDeg(0.4)), 'proportional to error');

// Lead point: moving target is led along its heading; stationary is not
const still = leadPoint(tank, 140, 50, 0, 0, 1);
assert.strictEqual(still.x, 140);
const moving = leadPoint(tank, 140, 50, 10, Math.PI / 2, 1);
assert.ok(moving.y > 50.5 && Math.abs(moving.x - 140) < 1e-9, 'target led along its heading');

// Aim solution respects range and ammo
const world = { obstacles: [], tanks: [tank] };
const profile = { maxFireDist: 40, leadFactor: 1 };
assert.ok(findAimSolution(world, 0, tank, { speed: 0, heading: 0 }, { x: 130, y: 50 }, profile), 'in range -> aim');
assert.strictEqual(findAimSolution(world, 0, tank, { speed: 0, heading: 0 }, { x: 160, y: 50 }, profile), null, 'out of range');
assert.strictEqual(findAimSolution(world, 0, { ...tank, shells: 0 }, { speed: 0, heading: 0 }, { x: 130, y: 50 }, profile), null, 'no ammo');

// Battle: aiming happens and the AI fires
const res = runVcr({ seconds: 40, level: 'HARD', seed: 3 });
const tags = res.ai.flatMap((a) => a.decisionLog.map((e) => e.tag));
assert.ok(tags.includes('AIM'), 'AI aims with the hull');
assert.ok(res.summary.shots[0] + res.summary.shots[1] > 0, 'AI fires shells');

console.log('✔ AI Hull Aiming tests passed\n');
