// Bench: aggregates several seeded AI-vs-AI matches to compare AI versions (kills, accuracy, game end).
// Usage: node tools/bench.js [seeds=6] [seconds=120] [level=HARD]
// Compare versions by running it before/after a change (e.g. with git stash).
import { runVcr } from './vcr.js';

const seeds = Number(process.argv[2] || 6);
const seconds = Number(process.argv[3] || 120);
const level = (process.argv[4] || 'HARD').toUpperCase();

const agg = { matches: 0, decided: 0, lostTotal: 0, shots: 0, hits: 0, pitDeaths: 0, mineBoom: 0, firstKillS: 0, firstKills: 0 };
const rows = [];
for (let s = 1; s <= seeds; s++) {
  const r = runVcr({ seconds, level, seed: s });
  const { lost, shots, hits, winner, over, pitDeaths, events } = r.summary;
  agg.matches++;
  if (over) agg.decided++;
  agg.lostTotal += lost[0] + lost[1];
  agg.shots += shots[0] + shots[1];
  agg.hits += hits[0] + hits[1];
  agg.pitDeaths += pitDeaths;
  agg.mineBoom += events.mineBoom || 0;
  const firstLoss = r.lines.find((l) => l.includes(' LOSS '));
  if (firstLoss) {
    agg.firstKills++;
    agg.firstKillS += parseFloat(firstLoss.slice(1));
  }
  rows.push(`seed ${s}: lost ${lost.join('/')} shots ${shots.join('/')} hits ${hits.join('/')} over=${over} winner=${winner}`);
}
console.log(rows.join('\n'));
console.log(
  JSON.stringify(
    {
      level,
      seconds,
      matches: agg.matches,
      decided: agg.decided,
      avgTanksLostPerMatch: +(agg.lostTotal / agg.matches).toFixed(2),
      hitRatePct: agg.shots ? +((agg.hits / agg.shots) * 100).toFixed(1) : 0,
      shotsPerMatch: +(agg.shots / agg.matches).toFixed(1),
      avgFirstLossS: agg.firstKills ? +(agg.firstKillS / agg.firstKills).toFixed(1) : null,
      pitDeaths: agg.pitDeaths,
      mineExplosions: agg.mineBoom,
    },
    null,
    2,
  ),
);
