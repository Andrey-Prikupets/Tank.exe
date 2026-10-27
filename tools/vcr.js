// VCR: deterministic headless AI-vs-AI replay that records AI decisions and tank state.
// Usage: node tools/vcr.js [seconds=90] [level=HARD] [seed=1] [--print]
// Output: vcr.log (merged decision log + 5 s snapshots) and a summary on stdout.
import fs from 'node:fs';
import * as C from '../src/constants.js';
import { createWorld, step } from '../src/sim/world.js';
import { AiController } from '../src/sim/ai.js';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const printAll = process.argv.includes('--print');
const seconds = Number(args[0] || 90);
const level = (args[1] || 'HARD').toUpperCase();
let seed = Number(args[2] || 1) >>> 0;

// mulberry32 so runs are reproducible
Math.random = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export function runVcr({ seconds, level, obstacles = true, pits = true }) {
  const world = createWorld({ obstacles, pits });
  const ai = [new AiController(0), new AiController(1)];
  const dt = 1 / C.SIM_TICK_HZ;
  const lines = [];
  const cursor = [0, 0];
  const stats = { pitDeaths: 0, shots: [0, 0], events: {} };
  let nextSnap = 0;

  const total = Math.round(seconds / dt);
  for (let s = 0; s < total && !world.over; s++) {
    const t = s * dt;
    ai[0].update(world, dt, level);
    ai[1].update(world, dt, level);
    step(world, dt, { windowTurn: [ai[0].windowTurn, ai[1].windowTurn] });

    for (let o = 0; o < 2; o++) {
      const log = ai[o].decisionLog;
      // decisionLog is capped; read new entries by absolute counter
      const start = Math.max(0, cursor[o] - (ai[o].logVersion - log.length));
      for (let i = start; i < log.length; i++) {
        const e = log[i];
        lines.push({ t: e.t, text: `[${e.t.toFixed(1).padStart(6)}] ${o === 0 ? 'R' : 'B'} ${e.tag.padEnd(8)} ${e.msg}` });
      }
      cursor[o] = ai[o].logVersion;
    }

    for (const ev of world.events) {
      stats.events[ev.type] = (stats.events[ev.type] || 0) + 1;
      if (ev.type === 'pit_death') stats.pitDeaths++;
    }
    world.events.length = 0;

    if (t >= nextSnap) {
      nextSnap += 5;
      const parts = [0, 1].map((o) => {
        const f = world.tanks.filter((x) => x.owner === o && x.status === 'field');
        return `${o === 0 ? 'R' : 'B'}: ` + f.map((x) => `#${x.number}(${x.x.toFixed(0)},${x.y.toFixed(0)} ${(x.speed * 3.6).toFixed(0)}km/h sh${x.shells})`).join(' ');
      });
      lines.push({ t, text: `[${t.toFixed(1).padStart(6)}] -- SNAP ${parts.join(' | ')}` });
    }
  }

  const [a, b] = world.players;
  const summary = {
    simSeconds: Math.min(seconds, lines.length ? lines[lines.length - 1].t : 0),
    over: world.over,
    winner: world.winner,
    lost: [a.lost, b.lost],
    shots: [a.shots, b.shots],
    hits: [a.hits, b.hits],
    pitDeaths: stats.pitDeaths,
    events: stats.events,
  };
  return { world, ai, lines: lines.map((l) => l.text), summary };
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/vcr.js');
if (isMain) {
  const res = runVcr({ seconds, level });
  fs.writeFileSync('vcr.log', res.lines.join('\n') + '\n');
  if (printAll) console.log(res.lines.join('\n'));
  console.log(`VCR ${level} seed run, ${seconds}s requested. Log: vcr.log (${res.lines.length} lines)`);
  console.log(JSON.stringify(res.summary, null, 2));
}
