import assert from 'assert';
import { createWorld, applyAction, step } from '../src/sim/world.js';
import { createInitPayload, serializeWorldSnapshot, applyWorldSnapshot } from '../src/net/sync.js';

console.log('Testing network synchronization engine...');

// 1. Create Host World
const options = { obstacles: true, pits: true, shootDist: 32 };
const hostWorld = createWorld(options);

// Verify initial world creation
assert(hostWorld.tanks.length === 30, 'Host world must have 30 tanks');

// 2. Create Init Payload
const initMsg = createInitPayload(hostWorld, 0, 1, options);
assert.strictEqual(initMsg.type, 'INIT');
assert.strictEqual(initMsg.hostPlayer, 0);
assert.strictEqual(initMsg.joinerPlayer, 1);
assert.strictEqual(initMsg.obstacles.length, hostWorld.obstacles.length);
assert.strictEqual(initMsg.pits.length, hostWorld.pits.length);

// 3. Client World adopts Init Payload
const clientWorld = createWorld(initMsg.options);
clientWorld.obstacles = initMsg.obstacles;
clientWorld.pits = initMsg.pits;
clientWorld.shellRange = initMsg.shellRange;

assert.deepStrictEqual(clientWorld.obstacles, hostWorld.obstacles, 'Obstacles must be identical');
assert.deepStrictEqual(clientWorld.pits, hostWorld.pits, 'Pits must be identical');

// 4. Host simulates steps & player actions
applyAction(hostWorld, 0, 'FORWARD');
applyAction(hostWorld, 1, 'FORWARD');
applyAction(hostWorld, 0, 'FIRE');
assert(hostWorld.shells.length > 0, 'Host should have spawned a shell');

step(hostWorld, 0.05, { windowTurn: [0, 0] });

// 5. Serialize Snapshot from Host and apply to Client
const snapshot = serializeWorldSnapshot(hostWorld);
assert.strictEqual(snapshot.type, 'STATE');
assert.strictEqual(snapshot.shells.length, hostWorld.shells.length);

applyWorldSnapshot(clientWorld, snapshot);

// Verify client replica matches host exactly
assert.strictEqual(clientWorld.shells.length, hostWorld.shells.length, 'Client shells must match host');
assert.strictEqual(clientWorld.shells[0].dx, hostWorld.shells[0].dx, 'Shell dx must match');
assert.strictEqual(clientWorld.tanks[0].x, hostWorld.tanks[0].x, 'Client tank X must match host');
assert.strictEqual(clientWorld.tanks[0].speed, hostWorld.tanks[0].speed, 'Client tank speed must match host');
assert.strictEqual(clientWorld.tanks[0].shells, hostWorld.tanks[0].shells, 'Client tank shells must match host');
assert.strictEqual(clientWorld.gates[0].open, hostWorld.gates[0].open, 'Client gate status must match host');
assert.strictEqual(clientWorld.players[0].view, hostWorld.players[0].view, 'Client player view must match host');
assert.strictEqual(clientWorld.players[0].windowIdx, hostWorld.players[0].windowIdx, 'Client windowIdx must match host');

console.log('✓ Network synchronization engine tests passed!');
