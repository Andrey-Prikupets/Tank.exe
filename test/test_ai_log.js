import assert from 'node:assert';
import * as C from '../src/constants.js';
import { AiController } from '../src/sim/ai.js';
import { runVcr } from '../tools/vcr.js';

console.log('\n--- Running AI Decision Log Tests ---');

// 1. note() dedupe and rate limiting
const ai = new AiController(0);
const base = ai.decisionLog.length; // doctrine entry
ai.note('PLAN', 'a', { key: 'k', gap: 1 });
ai.note('PLAN', 'a', { key: 'k', gap: 1 }); // same sig inside gap -> skipped
ai.note('PLAN', 'b', { key: 'k', gap: 1 }); // different sig inside gap -> rate limited
assert.strictEqual(ai.decisionLog.length, base + 1, 'dedupe/rate-limit must collapse repeats');
ai.simTime += 1.5;
ai.note('PLAN', 'b', { key: 'k', gap: 1 });
assert.strictEqual(ai.decisionLog.length, base + 2, 'entry allowed after gap');
assert.ok(ai.decisionLog.every((e) => typeof e.t === 'number' && e.tag && e.msg), 'entries have t/tag/msg');

// 2. cap
for (let i = 0; i < C.AI_LOG_MAX_ENTRIES + 50; i++) ai.note('FIRE', `m${i}`);
assert.strictEqual(ai.decisionLog.length, C.AI_LOG_MAX_ENTRIES, 'log is capped');

// 3. reset clears
const v = ai.logVersion;
ai.reset();
assert.ok(ai.logVersion > v && ai.decisionLog.length === 1, 'reset clears log (keeps new doctrine entry)');

// 4. a short battle produces timestamped, ordered decisions for both sides
const res = runVcr({ seconds: 20, level: 'HARD' });
const tags = new Set();
for (const o of [0, 1]) {
  const log = res.ai[o].decisionLog;
  assert.ok(log.length > 3, `AI ${o} must log decisions`);
  for (let i = 1; i < log.length; i++) assert.ok(log[i].t >= log[i - 1].t, 'log is time ordered');
  log.forEach((e) => tags.add(e.tag));
}
assert.ok(tags.has('DOCTRINE') && tags.has('ROLES'), 'doctrine and roles are logged');
assert.ok(res.lines.some((l) => l.includes('SNAP')), 'VCR emits snapshots');

console.log('✔ AI Decision Log tests passed\n');
