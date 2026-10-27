import assert from 'node:assert';
import * as C from '../src/constants.js';
import { assignBrigadeRoles, updateBrigadeRoles, BRIGADE_DOCTRINES } from '../src/sim/ai/roles.js';
import { runVcr } from '../tools/vcr.js';

console.log('\n--- Running AI Commander Tests (doctrine, sticky roles, plans) ---');

const P = C.AI_STRATEGY_PLANS;
const mk = (ids) => ids.map((id) => ({ id, shells: 5 }));

// 1. Plan-specific role sets
const five = mk([0, 1, 2, 3, 4]);
const alpha = assignBrigadeRoles(five, P.ALPHA, 'PINCER_AMBUSH', 0);
assert.deepStrictEqual([...alpha.values()].sort(), ['NORTH_FLANK_LEAD', 'NORTH_GATE_AMBUSH', 'SOUTH_FLANK_LEAD', 'SOUTH_GATE_AMBUSH', 'VANGUARD']);
const bravo = assignBrigadeRoles(five, P.BRAVO, 'PINCER_AMBUSH', 0);
assert.ok([...bravo.values()].includes('SPEARHEAD_N') && [...bravo.values()].includes('REARGUARD'), 'Bravo uses wedge roles');
const delta = assignBrigadeRoles(five, P.DELTA, 'PINCER_AMBUSH', 0);
assert.ok([...delta.values()].every((r) => r === 'PURSUER'), 'Delta: all pursuers');
for (const d of BRIGADE_DOCTRINES) {
  assert.strictEqual(assignBrigadeRoles(five, P.ALPHA, d, 1).size, 5, `${d} assigns all tanks`);
}

// 2. Sticky roles: a death must not change anyone else's role; a newcomer takes the freed role
const without2 = five.filter((t) => t.id !== 2);
const sticky = updateBrigadeRoles(alpha, without2, P.ALPHA, false, 'PINCER_AMBUSH', 0);
for (const t of without2) assert.strictEqual(sticky.get(t.id), alpha.get(t.id), `tank ${t.id} keeps its role`);
const withNew = [...without2, { id: 9, shells: 5 }];
const refilled = updateBrigadeRoles(sticky, withNew, P.ALPHA, false, 'PINCER_AMBUSH', 0);
assert.strictEqual(refilled.get(9), alpha.get(2), 'new tank takes the freed role');
for (const t of without2) assert.strictEqual(refilled.get(t.id), alpha.get(t.id));

// 3. Plan change forces a full reassignment
const toBravo = updateBrigadeRoles(alpha, five, P.BRAVO, true, 'PINCER_AMBUSH', 0);
assert.ok([...toBravo.values()].includes('SPEARHEAD_S'));

// 4. Battle: doctrine survives (no jump to PINCER_AMBUSH roles) and roles do not flap
const res = runVcr({ seconds: 25, level: 'HARD' });
for (const o of [0, 1]) {
  const ctl = res.ai[o];
  const roleLogs = ctl.decisionLog.filter((e) => e.tag === 'ROLES');
  const planTimes = ctl.decisionLog.filter((e) => e.tag === 'PLAN').map((e) => e.t);
  const parse = (m) => new Map([...m.matchAll(/T(\d+)=(\w+)/g)].map((x) => [x[1], x[2]]));
  for (let i = 1; i < roleLogs.length; i++) {
    const prev = parse(roleLogs[i - 1].msg);
    const cur = parse(roleLogs[i].msg);
    const planChange = planTimes.some((t) => Math.abs(t - roleLogs[i].t) < 0.5);
    if (planChange) continue;
    for (const [id, role] of cur) {
      if (prev.has(id)) assert.strictEqual(role, prev.get(id), `AI ${o} tank ${id} role flapped at ${roleLogs[i].t.toFixed(1)} s`);
    }
  }

  const planLogs = ctl.decisionLog.filter((e) => e.tag === 'PLAN');
  for (let i = 1; i < planLogs.length; i++) {
    assert.ok(planLogs[i].t - planLogs[i - 1].t >= 0.7, 'plan changes are not instantaneous flapping');
  }
}

console.log('✔ AI Commander tests passed\n');
