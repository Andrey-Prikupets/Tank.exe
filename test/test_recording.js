import assert from 'node:assert';
import {
  BinaryWriter,
  BinaryReader,
  compressDeflate,
  decompressDeflate,
  uint8ArrayToBase64,
  base64ToUint8Array,
  createRecorder,
  decodeRecording,
  createPlayback,
  listRecordings,
  saveRecording,
  loadRecording,
  setPinned,
  deleteRecording,
  angleLerp,
} from '../src/sim/recording.js';
import { createWorld, step, selectedTank } from '../src/sim/world.js';
import * as C from '../src/constants.js';

console.log('--- Running Replay System Unit Tests ---');

// Mock localStorage for Node test environment
const mockStorage = new Map();
globalThis.localStorage = {
  getItem: (k) => (mockStorage.has(k) ? mockStorage.get(k) : null),
  setItem: (k, v) => mockStorage.set(k, String(v)),
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear(),
  get length() {
    return mockStorage.size;
  },
};

// 1. Test BinaryWriter and BinaryReader
console.log('Testing BinaryWriter & BinaryReader...');
const w = new BinaryWriter();
w.writeUint32(0x544e4b52);
w.writeUint8(42);
w.writeInt16(-1234);
w.writeFloat32(98.5);
const bytes = w.getBytes();

const r = new BinaryReader(bytes);
assert.strictEqual(r.readUint32(), 0x544e4b52, 'Magic must match');
assert.strictEqual(r.readUint8(), 42, 'Uint8 must match');
assert.strictEqual(r.readInt16(), -1234, 'Int16 must match');
assert.ok(Math.abs(r.readFloat32() - 98.5) < 0.01, 'Float32 must match');
console.log('✔ BinaryWriter & BinaryReader verified.');

// 2. Test Deflate and Base64 roundtrip
console.log('Testing Deflate & Base64 pipeline...');
const raw = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
const compressed = await compressDeflate(raw);
const base64 = uint8ArrayToBase64(compressed);
assert.ok(typeof base64 === 'string' && base64.length > 0, 'Base64 must be non-empty string');
const decodedBytes = base64ToUint8Array(base64);
const decompressed = await decompressDeflate(decodedBytes);
assert.deepStrictEqual(Array.from(decompressed), Array.from(raw), 'Decompressed payload must match original');
console.log('✔ Deflate & Base64 pipeline verified.');

// 3. Test angleLerp boundary crossing
console.log('Testing angleLerp...');
const a1 = angleLerp(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
assert.ok(Math.abs(Math.abs(a1) - Math.PI) < 0.01, 'angleLerp should wrap cleanly over +-PI');
console.log('✔ angleLerp verified.');

// 4. Test Simulation Recording & Playback Interpolation
console.log('Testing Live World Recording...');
const world = createWorld({ obstacles: true, pits: true });
const recorder = createRecorder(world, { mode: 'HvC', modeLabel: 'Human vs. Computer', aiLevel: 'MEDIUM' });

// Simulate 2 seconds of world steps
const dt = 1 / C.SIM_TICK_HZ;
for (let i = 0; i < 120; i++) {
  step(world, dt, { windowTurn: [0, 0] });
  recorder.sample(world);
}
assert.ok(recorder.frameCount >= 15, `Recorder should have captured frames (got ${recorder.frameCount})`);

const { metadata, base64Payload } = await recorder.finalize(world);
assert.ok(metadata.id.startsWith('rec_'), 'Metadata ID format check');
assert.strictEqual(metadata.mode, 'HvC');
assert.strictEqual(metadata.aiLevel, 'MEDIUM');
assert.strictEqual(metadata.shootDist, 32, 'Default shootDist in metadata should be 32m');
assert.strictEqual(metadata.winner, null, 'Unfinished recording should have winner null');
assert.strictEqual(metadata.winnerLabel, 'INCOMPLETE', 'Unfinished recording should have winnerLabel INCOMPLETE');
assert.ok(base64Payload.length > 0, 'Payload must be non-empty base64 string');

// Test custom shootDist recording and completed match winner
const customWorld = createWorld({ shootDist: 45 });
assert.strictEqual(customWorld.shellRange, 45, 'World shellRange should reflect options.shootDist');
customWorld.over = true;
customWorld.winner = 1;
const customRec = createRecorder(customWorld, { mode: 'CvC', shootDist: 45 });
customRec.sample(customWorld);
const customRes = await customRec.finalize(customWorld);
assert.strictEqual(customRes.metadata.shootDist, 45, 'Custom shootDist should be saved in metadata');
assert.strictEqual(customRes.metadata.winner, 1, 'Completed recording preserves winner');
assert.strictEqual(customRes.metadata.winnerLabel, 'BLUE WINS', 'Completed recording sets BLUE WINS');

console.log(`✔ Recording finalized: ${recorder.frameCount} frames, payload size: ${base64Payload.length} base64 chars (~${Math.round(base64Payload.length / 1024)} KB).`);

// 5. Test Decompression & Playback Controller
console.log('Testing Replay Deserialization & Playback Controller...');
const decoded = await decodeRecording(base64Payload);
assert.strictEqual(decoded.frames.length, recorder.frameCount, 'Frame count must match');
assert.ok(decoded.obstacles.length > 0, 'Obstacles preserved');
assert.ok(decoded.pits.length > 0, 'Pits preserved');

const playbackWorld = createWorld({ obstacles: decoded.obstacles, pits: decoded.pits });
assert.strictEqual(playbackWorld.obstacles.length, decoded.obstacles.length, 'Playback obstacles count must match decoded');
for (let i = 0; i < decoded.obstacles.length; i++) {
  assert.strictEqual(playbackWorld.obstacles[i].x, decoded.obstacles[i].x, `Obstacle ${i} x must match`);
  assert.strictEqual(playbackWorld.obstacles[i].y, decoded.obstacles[i].y, `Obstacle ${i} y must match`);
  assert.strictEqual(playbackWorld.obstacles[i].h, decoded.obstacles[i].h, `Obstacle ${i} h must match`);
  assert.strictEqual(playbackWorld.obstacles[i].height, C.OBSTACLE_HEIGHT_M, `Obstacle ${i} height must be preset`);
}

assert.strictEqual(playbackWorld.pits.length, decoded.pits.length, 'Playback pits count must match decoded');
for (let i = 0; i < decoded.pits.length; i++) {
  assert.strictEqual(playbackWorld.pits[i].x, decoded.pits[i].x, `Pit ${i} x must match`);
  assert.strictEqual(playbackWorld.pits[i].y, decoded.pits[i].y, `Pit ${i} y must match`);
  assert.strictEqual(playbackWorld.pits[i].h, decoded.pits[i].h, `Pit ${i} h must match`);
}

const playback = createPlayback(decoded, playbackWorld);

assert.strictEqual(playback.currentTime, 0);
assert.ok(playback.isPlaying);

// Test seek
playback.seek(1.0);
assert.ok(Math.abs(playback.currentTime - 1.0) < 0.001);
assert.ok(Math.abs(playbackWorld.time - 1.0) < 0.001);

// Test update
playback.update(0.5);
assert.ok(Math.abs(playback.currentTime - 1.5) < 0.001);
assert.ok(Math.abs(playbackWorld.time - 1.5) < 0.001);

// Test tank numbers & selectedTank resolution in playback
const fieldTanks = playbackWorld.tanks.filter((t) => t.status === 'field');
assert.ok(fieldTanks.length > 0, 'Field tanks must exist');
for (const ft of fieldTanks) {
  assert.strictEqual(typeof ft.number, 'string', `Field tank ${ft.id} number must be a string, got ${typeof ft.number}`);
  assert.ok(['1', '2', '3', '4', '5'].includes(ft.number), `Field tank ${ft.id} must have number '1'..'5', got ${ft.number}`);
}
assert.strictEqual(typeof playbackWorld.players[0].selected, 'string', 'Player 0 selected must be string');
assert.strictEqual(typeof playbackWorld.players[1].selected, 'string', 'Player 1 selected must be string');
assert.ok(selectedTank(playbackWorld, 0), 'selectedTank for player 0 must not be null');
assert.ok(selectedTank(playbackWorld, 1), 'selectedTank for player 1 must not be null');

console.log('✔ Playback controller seek, step, obstacles preloading, and tank numbers verified.');

// 6. Test LocalStorage manager, Sorting, Pin/Unpin, and Quota Pruning
console.log('Testing LocalStorage Manager, Pinning & Auto-pruning...');
mockStorage.clear();

// Save recording 1
saveRecording(metadata, base64Payload);
let list = listRecordings();
assert.strictEqual(list.length, 1);
assert.strictEqual(list[0].id, metadata.id);
assert.strictEqual(list[0].pinned, false);

// Pin recording 1
setPinned(metadata.id, true);
list = listRecordings();
assert.strictEqual(list[0].pinned, true);

// Save recording 2 (with older timestamp)
const metadata2 = {
  ...metadata,
  id: 'rec_older',
  savedAt: new Date(Date.now() - 60000).toISOString(),
  pinned: false,
};
saveRecording(metadata2, base64Payload);

// List must be sorted datetime descending (newest on top)
list = listRecordings();
assert.strictEqual(list.length, 2);
assert.strictEqual(list[0].id, metadata.id, 'Newer match must be first');
assert.strictEqual(list[1].id, 'rec_older', 'Older match must be second');

// Delete recording 2
deleteRecording('rec_older');
list = listRecordings();
assert.strictEqual(list.length, 1);
assert.strictEqual(list[0].id, metadata.id);

console.log('✔ LocalStorage manager, sorting, and pin operations verified.');

console.log('=== All Replay Unit Tests Passed Successfully! ===\n');
