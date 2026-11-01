/**
 * @fileoverview Reusable CLI tool to simulate critical moments (or custom time slices)
 * from saved game recordings (.replay files) against the current AI implementation.
 *
 * Usage:
 *   node tools/sim_replay.js                        # Runs benchmark suites on game2 & game1
 *   node tools/sim_replay.js <replay-file>          # Runs preset moments for <replay-file>
 *   node tools/sim_replay.js <replay-file> <startT> <duration> [level]
 */

import { loadReplay, simulateMoment } from './replay_utils.js';

export const GAME1_MOMENTS = [
  {
    name: 'Game1 M1 (t=19.0s..28.5s): Red #3 rushes center at 36km/h',
    startT: 19.0,
    duration: 9.5,
    replayOutcome: 'Blue Shots: 1 | Red Killed: 0 (active) | Blue Lost: 3 (#4 at 21.2s, #1 at 25.3s, #5 at 27.7s)',
  },
  {
    name: 'Game1 M2 (t=55.0s..60.5s): Red #2 drops mine at (99.8,42.0) & kites Blue #4',
    startT: 55.0,
    duration: 5.5,
    replayOutcome: 'Blue Shots: 0 | Red Killed: 0 | Blue Lost: 1 (#4 detonated mine at 59.6s)',
  },
  {
    name: 'Game1 M3 (t=66.0s..72.5s): Red #2 raids Blue base vs Blue #1 & #2',
    startT: 66.0,
    duration: 6.5,
    replayOutcome: 'Blue Shots: 0 | Red Killed: 0 | Blue Lost: 2 (#1 at 69.7s, #2 at 71.8s)',
  },
  {
    name: 'Game1 M4 (t=85.0s..92.5s): Red #4 attacks unselected Blue #4 & #3 in mid-field',
    startT: 85.0,
    duration: 7.5,
    replayOutcome: 'Blue Shots: 0 | Red Killed: 0 | Blue Lost: 2 (#4 at 86.9s, #3 at 91.8s)',
  },
  {
    name: 'Game1 M5 (t=121.5s..128.5s): Red #2 attacks Blue #2 at (60,53) while Blue #1 faces mine at (219,67)',
    startT: 121.5,
    duration: 7.0,
    replayOutcome: 'Blue Shots: 0 | Red Killed: 0 | Blue Lost: 2 (#2 shot at 125.3s, #1 hit mine at 127.6s)',
  },
  {
    name: 'Game1 M6 (t=144.5s..149.5s): Red #3 charges Blue #3 head-on',
    startT: 144.5,
    duration: 5.0,
    replayOutcome: 'Blue Shots: 0 | Red Killed: 0 | Blue Lost: 1 (#3 shot at 148.6s after deselection)',
  },
];

export const GAME2_MOMENTS = [
  {
    name: 'Game2 M1 (t=11.5s..16.5s): Red #4 charges Blue #1 in center-north',
    startT: 11.5,
    duration: 5.0,
    replayOutcome: 'Blue #1 slowed to 6km/h without firing and died at t=15.2s (Blue Lost: 1)',
  },
  {
    name: 'Game2 M2 (t=27.5s..32.5s): Red #3 exits gate & engages Blue #3 at (77,33)',
    startT: 27.5,
    duration: 5.0,
    replayOutcome: 'Blue #3 selected late at t=30.6s and died at t=31.1s (Red Killed: 1, Blue Lost: 1)',
  },
  {
    name: 'Game2 M3 (t=42.0s..49.5s): Blue #4 near Red mine at (84,52) + Red #1 exits gate vs Blue #2',
    startT: 42.0,
    duration: 7.5,
    replayOutcome: 'Blue #4 drove into mine at 45.5s after deselection; Blue #2 died at 48.5s (Red Killed: 0, Blue Lost: 2)',
  },
  {
    name: 'Game2 M4 (t=59.5s..64.5s): Blue #5 approaches Red gate at (34.5,34.9) as Red #2 exits',
    startT: 59.5,
    duration: 5.0,
    replayOutcome: 'Blue #5 arrived sideways (hdg=83°) and was shot by exiting Red #2 at 63.1s (Red Killed: 0, Blue Lost: 1)',
  },
  {
    name: 'Game2 M5 (t=77.5s..88.5s): Red #1 & Red #4 exit gate vs Blue containment (#3 & #4)',
    startT: 77.5,
    duration: 11.0,
    replayOutcome: 'Blue #3 deselected at d=31m & killed at 81.8s; Blue #4 drove into slit sector & died at 87.7s (Blue Lost: 2)',
  },
  {
    name: 'Game2 M6 (t=94.0s..100.5s): Red in hangar firing Slit Gun W1 at Blue #2',
    startT: 94.0,
    duration: 6.5,
    replayOutcome: 'Unselected Blue #2 curved into slit sector (21.3,47.7) and was killed by Slit Gun W1 at 99.1s (Blue Lost: 1)',
  },
  {
    name: 'Game2 M7 (t=109.0s..125.5s): Red in hangar firing Slit Gun W2 at Blue #5, #3, #4',
    startT: 109.0,
    duration: 16.5,
    replayOutcome: 'Blue #5 (114.0s), #3 (117.4s), and #4 (124.5s) all drove into Slit Gun W2 cone and died! (Blue Lost: 3)',
  },
  {
    name: 'Game2 M8 (t=141.0s..159.5s): Red in hangar firing Slit Gun W2 at Blue #1 & #3',
    startT: 141.0,
    duration: 18.5,
    replayOutcome: 'Blue #1 (146.5s) and #3 (158.3s) entered Slit Gun W2 cone and died! (Blue Lost: 2)',
  },
  {
    name: 'Game2 M9 (t=164.5s..172.0s): Red #1 exits gate at 165s, then Red fires Slit Gun W2 at Blue #5',
    startT: 164.5,
    duration: 7.5,
    replayOutcome: 'Blue killed Red #1 at 167.8s, but Blue #5 drove into Slit Gun W2 at 170.8s (Red Killed: 1, Blue Lost: 1)',
  },
];

export const GAME3_MOMENTS = [
  {
    name: 'Game3 M1 (t=22.0s..28.0s): Blue #1[15] vs Red #4[3] & #5[4] near (37,60)',
    startT: 22.0,
    duration: 6.0,
    replayOutcome: 'Blue #1[15] killed at t=26.6s without returning fire (Red Killed: 0, Blue Lost: 1)',
  },
  {
    name: 'Game3 M2 (t=35.0s..41.0s): Unselected Blue #5[19] targeted by Red #4[3] at (102,39)',
    startT: 35.0,
    duration: 6.0,
    replayOutcome: 'Unselected Blue #5[19] drove straight at 20km/h into shell at t=39.6s (Red Killed: 0, Blue Lost: 1)',
  },
  {
    name: 'Game3 M3 (t=52.0s..58.0s): Unselected Blue #2[16] approaches Red mine at (107.9,40.3)',
    startT: 52.0,
    duration: 6.0,
    replayOutcome: 'Unselected Blue #2[16] accelerated into Red mine at t=56.3s (Red Killed: 0, Blue Lost: 1)',
  },
  {
    name: 'Game3 M4 (t=64.0s..71.5s): Blue #4[18] near Red Slit Gun W2 at (13.8,64.1)',
    startT: 64.0,
    duration: 7.5,
    replayOutcome: 'Blue #4[18] killed Red #4[6] at 66.2s, then entered slit-gun cone and died at 69.6s (Red Killed: 1, Blue Lost: 1)',
  },
  {
    name: 'Game3 M5 (t=108.0s..114.5s): Blue #1[20] vs Red #4[9] at (47.1,18.3)',
    startT: 108.0,
    duration: 6.5,
    replayOutcome: 'Blue #1[20] killed at t=112.9s without returning fire (Red Killed: 0, Blue Lost: 1)',
  },
  {
    name: 'Game3 M6 (t=126.5s..133.0s): Blue #5[21] vs Red #1[8] at (69,19)',
    startT: 126.5,
    duration: 6.5,
    replayOutcome: 'Blue #5[21] killed at t=131.5s without returning fire (Red Killed: 0, Blue Lost: 1)',
  },
  {
    name: 'Game3 M7 (t=138.0s..176.0s): Red in hangar firing Slit Guns at Blue #4[25], #2[22], #3[17]',
    startT: 138.0,
    duration: 38.0,
    replayOutcome: 'Blue #4[25] (143.2s), #2[22] (162.3s), and #3[17] (174.0s) all entered slit-gun sector and died! (Blue Lost: 3)',
  },
  {
    name: 'Game3 M8 (t=194.5s..210.0s): Blue #3[24] & #4[23] near Pits #1/#2 vs Red #1[13] at (154..158, 59..67)',
    startT: 194.5,
    duration: 15.5,
    replayOutcome: 'Blue #3[24] (199.7s) and #4[23] (208.2s) froze at spd=0 near Pit #2 and were killed by Red #1[13] (Blue Lost: 2)',
  },
  {
    name: 'Game3 M9 (t=275.0s..282.0s): Blue #5[27] at (136.3,61.7) near Red Mine (136.4,65.5) vs Red #5[7]',
    startT: 275.0,
    duration: 7.0,
    replayOutcome: 'Blue #5[27] pivoted in place at spd=0 next to mine and swung hull corner into mine at 280.3s (Blue Lost: 1)',
  },
  {
    name: 'Game3 M10 (t=293.5s..311.5s): Blue #3[29], #2[28], #1[26] vs Red #5[7] & #5[12] in center-east',
    startT: 293.5,
    duration: 18.0,
    replayOutcome: 'Blue #3[29] killed at 299.1s, Red #5[7] killed at 302.1s, Blue #1[26] killed at 309.7s (Red Killed: 1, Blue Lost: 2)',
  },
  {
    name: 'Game3 M11 (t=497.0s..503.0s): Blue #2[28] at (159.6,56.0) near Pit #2 vs Red #4[14]',
    startT: 497.0,
    duration: 6.0,
    replayOutcome: 'Blue #2[28] froze at spd=0 for 200s near Pit #2 and was killed at 503.0s (Red Killed: 0, Blue Lost: 1)',
  },
];

async function runSuite(label, replayPath, moments) {
  console.log(`\n################################################################################`);
  console.log(`### ${label} (${replayPath})`);
  console.log(`################################################################################`);
  const rec = await loadReplay(replayPath);

  let totalBlueShots = 0;
  let totalRedKilled = 0;
  let totalBlueLost = 0;
  let totalSlitExposure = 0;

  for (const m of moments) {
    console.log(`\n================================================================================`);
    console.log(m.name);
    console.log(`  [RECORDED GAME] -> ${m.replayOutcome}`);
    const res = simulateMoment(rec, { startT: m.startT, duration: m.duration, level: 'HARD' });
    totalBlueShots += res.blueShots;
    totalRedKilled += res.redKilled;
    totalBlueLost += res.blueKilled;
    totalSlitExposure += res.blueSlitExposureSeconds;
    console.log(
      `  [SIMULATED AI]  -> Blue Shots: ${res.blueShots} | Red Killed: ${res.redKilled} | Blue Lost: ${res.blueKilled} | Slit Exposure: ${res.blueSlitExposureSeconds.toFixed(1)}s`
    );
    for (const ev of res.events) {
      console.log(`    - ${ev}`);
    }
  }

  console.log(`\n--------------------------------------------------------------------------------`);
  console.log(
    `SUITE TOTAL (${label}): Blue Shots=${totalBlueShots} | Red Killed=${totalRedKilled} | Blue Lost=${totalBlueLost} | Total Slit Exposure=${totalSlitExposure.toFixed(1)}s`
  );
  console.log(`--------------------------------------------------------------------------------`);
  return { totalBlueShots, totalRedKilled, totalBlueLost, totalSlitExposure };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length >= 3) {
    const replayPath = args[0];
    const startT = parseFloat(args[1]);
    const duration = parseFloat(args[2]);
    const level = (args[3] || 'HARD').toUpperCase();
    const rec = await loadReplay(replayPath);
    const f0 = rec.frames[Math.floor(startT * 10)];
    console.log(`  Snapshot at ${startT}s: fieldTanks=${JSON.stringify(f0?.fieldTanks)} mines=${JSON.stringify(f0?.mines)}`);
    const res = simulateMoment(rec, { startT, duration, level });
    console.log(`Simulated [${startT}s .. ${(startT + duration).toFixed(1)}s] (${level}):`);
    console.log(
      `  Blue Shots: ${res.blueShots} | Red Killed: ${res.redKilled} | Blue Lost: ${res.blueKilled} | Slit Exposure: ${res.blueSlitExposureSeconds.toFixed(1)}s`
    );
    for (const ev of res.events) console.log(`    - ${ev}`);
    if (res.decisionLog) {
      console.log(`  AI Decision Log (${res.decisionLog.length} entries):`);
      for (const d of res.decisionLog) {
        console.log(`    [${d.t.toFixed(2)}s] [${d.tag}] ${d.msg}`);
      }
    }
    return;
  }

  if (args.length === 1) {
    const replayPath = args[0];
    const moments = replayPath.includes('game1')
      ? GAME1_MOMENTS
      : replayPath.includes('game3')
        ? GAME3_MOMENTS
        : GAME2_MOMENTS;
    await runSuite(replayPath, replayPath, moments);
    return;
  }

  await runSuite('GAME 3 (LATEST SAVED GAME)', 'tools/replays/game3_hvc_hard.replay', GAME3_MOMENTS);
  await runSuite('GAME 2 (PREVIOUS SAVED GAME)', 'tools/replays/game2_hvc_hard.replay', GAME2_MOMENTS);
  await runSuite('GAME 1 (INITIAL SAVED GAME - REGRESSION)', 'tools/replays/game1_hvc_hard.replay', GAME1_MOMENTS);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
