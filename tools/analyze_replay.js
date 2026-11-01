/**
 * @fileoverview Reusable CLI tool to decode, slice, and forensically analyze
 * a saved game replay (.replay file or base64 payload).
 *
 * Usage:
 *   node tools/analyze_replay.js <replay-file> [--from <sec>] [--to <sec>] [--deaths] [--snapshots] [--slice-out <path>]
 */

import * as C from '../src/constants.js';
import { isInEnemySlitGunSector } from '../src/sim/nav.js';
import { loadReplay, sliceReplay, saveReplaySliceJson, classifyTankDeath } from './replay_utils.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node tools/analyze_replay.js <replay-file> [--from <sec>] [--to <sec>] [--deaths] [--snapshots] [--slice-out <path>]');
    process.exit(1);
  }

  const replayPath = args[0];
  let fromT = 0;
  let toT = Infinity;
  let showDeathsForensic = false;
  let showSnapshots = false;
  let sliceOut = null;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) {
      fromT = parseFloat(args[++i]);
    } else if (args[i] === '--to' && args[i + 1]) {
      toT = parseFloat(args[++i]);
    } else if (args[i] === '--deaths') {
      showDeathsForensic = true;
    } else if (args[i] === '--snapshots') {
      showSnapshots = true;
    } else if (args[i] === '--slice-out' && args[i + 1]) {
      sliceOut = args[++i];
    }
  }

  const fullRec = await loadReplay(replayPath);
  const rec = (fromT > 0 || toT < Infinity)
    ? sliceReplay(fullRec, fromT, toT, { rebaseTime: false })
    : fullRec;

  if (sliceOut) {
    saveReplaySliceJson(rec, sliceOut);
    console.log(`Saved sliced replay [${fromT}s .. ${toT}s] to ${sliceOut}`);
  }

  const lastF = rec.frames[rec.frames.length - 1];
  console.log('=== REPLAY METADATA ===');
  console.log({
    duration: Number(rec.duration.toFixed(2)),
    frameCount: rec.frames.length,
    obstaclesCount: rec.obstacles ? rec.obstacles.length : 0,
    pitsCount: rec.pits ? rec.pits.length : 0,
    finalScore: lastF ? `Red Lost ${lastF.p0.lost} - Blue Lost ${lastF.p1.lost}` : 'N/A',
  });

  if (rec.obstacles && rec.obstacles.length > 0) {
    console.log('Obstacles:', rec.obstacles.map(o => `#${o.id}(${o.x.toFixed(1)},${o.y.toFixed(1)} ${o.l.toFixed(1)}x${o.w.toFixed(1)} h=${(o.h * 180 / Math.PI).toFixed(0)}deg)`).join(', '));
  }
  if (rec.pits && rec.pits.length > 0) {
    console.log('Pits:', rec.pits.map(p => `#${p.id}(${p.x.toFixed(1)},${p.y.toFixed(1)} ${p.l.toFixed(1)}x${p.w.toFixed(1)})`).join(', '));
  }

  const deaths = [];
  const timeline = [];
  const slitGunExposureByTank = new Map();
  const tankLastSeen = new Map();

  let prevDeadMask = rec.frames.length > 0 && fromT > 0 ? rec.frames[0].deadTankMask : 0;

  for (let i = 0; i < rec.frames.length; i++) {
    const curr = rec.frames[i];
    const prev = i > 0 ? rec.frames[i - 1] : null;
    const dt = prev ? curr.t - prev.t : 0.1;

    // Track slit-gun exposure time
    for (const ct of curr.fieldTanks) {
      const owner = ct.id < 15 ? 0 : 1;
      const enemyOwner = 1 - owner;
      if (isInEnemySlitGunSector(ct.x, ct.y, enemyOwner, 0)) {
        slitGunExposureByTank.set(ct.id, (slitGunExposureByTank.get(ct.id) || 0) + dt);
      }
    }

    // Detect newly spawned shells
    if (prev) {
      for (const s of curr.shells) {
        const existed = prev.shells.some(
          ps => ps.owner === s.owner && Math.hypot(s.x - (ps.x + ps.vx * dt), s.y - (ps.y + ps.vy * dt)) < 5.5
        );
        if (!existed) {
          const team = s.owner === 0 ? 'RED(Human)' : 'BLUE(AI)';
          const shooterTank = curr.fieldTanks.find(
            t => (s.owner === 0 ? t.id < 15 : t.id >= 15) && Math.hypot(t.x - s.x, t.y - s.y) < 8.0
          );
          const wallX = s.owner === 0 ? 0 : C.FIELD_LENGTH_M;
          let shooterDesc;
          if (!shooterTank && Math.abs(s.x - wallX) < 12.0) {
            const winIdx = Math.abs(s.y - C.WINDOW_0_Y) < Math.abs(s.y - C.WINDOW_1_Y) ? 1 : 2;
            shooterDesc = `Slit Gun W${winIdx} at (${s.x.toFixed(1)},${s.y.toFixed(1)})`;
          } else if (shooterTank) {
            shooterDesc = `Tank #${shooterTank.number}[id=${shooterTank.id}] at (${shooterTank.x.toFixed(1)},${shooterTank.y.toFixed(1)})`;
          } else {
            shooterDesc = `Shell at (${s.x.toFixed(1)},${s.y.toFixed(1)})`;
          }
          const hdgDeg = ((Math.atan2(s.vy, s.vx) * 180) / Math.PI).toFixed(0);
          timeline.push(`[t=${curr.t.toFixed(1)}s] SHOT by ${team}: ${shooterDesc}, dir=${hdgDeg}°`);
        }
      }

      // Detect newly laid mines
      for (const m of curr.mines) {
        const existed = prev.mines.some(pm => Math.hypot(pm.x - m.x, pm.y - m.y) < 0.5);
        if (!existed) {
          timeline.push(`[t=${curr.t.toFixed(1)}s] MINE LAID by ${m.owner === 0 ? 'RED' : 'BLUE'} at (${m.x.toFixed(1)}, ${m.y.toFixed(1)})`);
        }
      }
    }

    // Detect tank deaths
    const newDead = curr.deadTankMask & ~prevDeadMask;
    if (newDead !== 0) {
      for (let tid = 0; tid < 30; tid++) {
        if (newDead & (1 << tid)) {
          const last = tankLastSeen.get(tid);
          const fullIdx = fullRec.frames.findIndex(f => Math.abs(f.t - curr.t) < 1e-4);
          const deathInfo = classifyTankDeath(tid, last, prev, curr, fullRec, fullIdx >= 0 ? fullIdx : i);
          deaths.push(deathInfo);
          const side = deathInfo.owner === 0 ? 'RED(Human)' : 'BLUE(AI)';
          timeline.push(
            `>>> [t=${curr.t.toFixed(1)}s] DEATH: ${side} #${deathInfo.number}[id=${tid}] at (${deathInfo.x.toFixed(1)}, ${deathInfo.y.toFixed(1)}) ` +
            `spd=${deathInfo.speedKmh.toFixed(0)}km/h hdg=${deathInfo.headingDeg.toFixed(0)}° sel=${deathInfo.wasSelected} ` +
            `cause=${deathInfo.cause} (${deathInfo.shooterDesc}) distEnemyGate=${deathInfo.distToEnemyGate.toFixed(1)}m ` +
            `inSlit=${deathInfo.inSlitSector} | Score: ${curr.p0.lost}-${curr.p1.lost}`
          );
        }
      }
      prevDeadMask = curr.deadTankMask;
    }

    for (const t of curr.fieldTanks) {
      tankLastSeen.set(t.id, t);
    }
  }

  console.log('\n=== DEATHS SUMMARY ===');
  const redDeaths = deaths.filter(d => d.owner === 0);
  const blueDeaths = deaths.filter(d => d.owner === 1);
  const blueSlitDeaths = blueDeaths.filter(d => d.cause === 'SLIT_GUN');
  console.log(
    `Red Losses: ${redDeaths.length} | Blue (AI) Losses: ${blueDeaths.length} ` +
    `(Killed by Red Slit Gun: ${blueSlitDeaths.length}, Died inside Slit Sector: ${blueDeaths.filter(d => d.inSlitSector).length})`
  );
  for (const d of deaths) {
    const side = d.owner === 0 ? 'RED ' : 'BLUE';
    console.log(
      `  t=${d.t.toFixed(1).padStart(5)}s | ${side} #${d.number}[id=${String(d.id).padStart(2)}] | (${d.x.toFixed(1).padStart(5)}, ${d.y.toFixed(1).padStart(4)}) | ` +
      `hdg=${d.headingDeg.toFixed(0).padStart(4)}° spd=${d.speedKmh.toFixed(0).padStart(2)}km/h sh=${d.shells} sel=${String(d.wasSelected).padEnd(5)} | ` +
      `${d.cause.padEnd(8)}: ${d.shooterDesc} | distEnemyGate=${d.distToEnemyGate.toFixed(1)}m | inSlit=${d.inSlitSector}(buf=${d.inSlitSectorBuffered})`
    );
  }

  console.log('\n=== SLIT GUN EXPOSURE TIME PER TANK ===');
  for (const [id, secs] of [...slitGunExposureByTank.entries()].sort((a, b) => a[0] - b[0])) {
    const side = id < 15 ? 'RED ' : 'BLUE';
    console.log(`  ${side} Tank id=${id}: ${secs.toFixed(2)}s inside enemy slit-gun sector`);
  }

  if (showDeathsForensic) {
    console.log('\n=== FORENSIC LEAD-UP TO BLUE (AI) DEATHS (5s before each death) ===');
    for (const d of blueDeaths) {
      console.log(`\n--- BLUE Tank #${d.number}[id=${d.id}] Death at t=${d.t.toFixed(1)}s (${d.x.toFixed(1)}, ${d.y.toFixed(1)}) [${d.cause}: ${d.shooterDesc}] ---`);
      for (let t = Math.max(0, d.t - 5.0); t <= d.t + 0.05; t += 0.5) {
        const f = fullRec.frames.find(fr => fr.t >= t - 0.01);
        if (!f) continue;
        const tk = f.fieldTanks.find(x => x.id === d.id);
        if (!tk) continue;
        const isSel = f.p1.view === 'tank' && String(f.p1.selected) === String(tk.number);
        const inSlit = isInEnemySlitGunSector(tk.x, tk.y, 0, 0);
        const inSlitBuf = isInEnemySlitGunSector(tk.x, tk.y, 0, 2.0);
        const reds = f.fieldTanks
          .filter(x => x.id < 15)
          .map(r => `#${r.number}[${r.id}](${r.x.toFixed(0)},${r.y.toFixed(0)},d=${Math.hypot(r.x - tk.x, r.y - tk.y).toFixed(0)}m,${(r.speed * 3.6).toFixed(0)}km/h)`)
          .join(' ');
        const rView = f.p0.view === 'window' ? `WINDOW(W${f.p0.windowIdx + 1},yaw=${(f.p0.windowYaw * 180 / Math.PI).toFixed(0)}°)` : `TANK(#${f.p0.selected})`;
        console.log(
          `  t=${f.t.toFixed(1)}s: pos=(${tk.x.toFixed(1)}, ${tk.y.toFixed(1)}) hdg=${(tk.heading * 180 / Math.PI).toFixed(0)}° ` +
          `spd=${(tk.speed * 3.6).toFixed(0)}km/h sh=${tk.shells} sel=${isSel}(B_sel=#${f.p1.selected},v=${f.p1.view},lock=${f.p1.lockedTargetId}) ` +
          `inSlit=${inSlit}(buf=${inSlitBuf}) | RedPlayer=${rView} | RedField: ${reds || 'NONE (all in hangar/dead)'}`
        );
      }
    }
  }

  if (showSnapshots) {
    console.log('\n=== PERIODIC 10s SNAPSHOTS ===');
    for (let sec = Math.ceil(fromT / 10) * 10; sec <= Math.min(toT, rec.duration); sec += 10) {
      const f = rec.frames.find(fr => fr.t >= sec) || rec.frames[rec.frames.length - 1];
      if (!f) continue;
      const rTanks = f.fieldTanks.filter(t => t.id < 15);
      const bTanks = f.fieldTanks.filter(t => t.id >= 15);
      console.log(
        `[t=${f.t.toFixed(1).padStart(5)}s] Score ${f.p0.lost}-${f.p1.lost} | R(sel=${f.p0.view === 'window' ? 'W' + (f.p0.windowIdx + 1) : '#' + f.p0.selected}): ` +
        rTanks.map(t => `#${t.number}[${t.id}](${t.x.toFixed(0)},${t.y.toFixed(0)} ${(t.speed * 3.6).toFixed(0)}km/h sh${t.shells})`).join(' ') +
        `\n                     | B(sel=${f.p1.view === 'window' ? 'W' + (f.p1.windowIdx + 1) : '#' + f.p1.selected} lock=${f.p1.lockedTargetId}): ` +
        bTanks.map(t => `#${t.number}[${t.id}](${t.x.toFixed(0)},${t.y.toFixed(0)} ${(t.speed * 3.6).toFixed(0)}km/h sh${t.shells}${isInEnemySlitGunSector(t.x, t.y, 0, 0) ? ',SLIT!' : ''})`).join(' ')
      );
    }
  }

  console.log('\n=== KEY COMBAT TIMELINE ===');
  for (const line of timeline) {
    console.log(' ', line);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
