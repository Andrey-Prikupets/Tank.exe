/**
 * @fileoverview Reusable utilities for decoding, slicing, inspecting, and simulating
 * saved game recordings (.replay files or raw base64 payloads).
 */

import fs from 'node:fs';
import * as C from '../src/constants.js';
import { createWorld, step, selectedTank } from '../src/sim/world.js';
import { decodeRecording, createPlayback } from '../src/sim/recording.js';
import { AiController } from '../src/sim/ai.js';
import { isInEnemySlitGunSector } from '../src/sim/nav.js';

export function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Loads and decodes a recording from a `.replay` file path or raw base64 string.
 * @param {string} source File path or base64 string.
 * @returns {Promise<Object>} Decoded recording object.
 */
export async function loadReplay(source) {
  let raw = source;
  if (fs.existsSync(source)) {
    raw = fs.readFileSync(source, 'utf8');
  }
  const b64 = raw.replace(/\s+/g, '');
  return decodeRecording(b64);
}

/**
 * Cuts a portion `[fromT, toT]` of a decoded recording, returning a new recording object.
 * Optionally re-bases timestamps to 0 when `rebaseTime = true`.
 * @param {Object} rec Decoded recording.
 * @param {number} fromT Start time in seconds.
 * @param {number} toT End time in seconds.
 * @param {{ rebaseTime?: boolean }} [opts]
 * @returns {Object} Sliced recording object.
 */
export function sliceReplay(rec, fromT, toT, opts = {}) {
  const rebase = !!opts.rebaseTime;
  const frames = rec.frames
    .filter(f => f.t >= fromT - 1e-6 && f.t <= toT + 1e-6)
    .map(f => ({
      ...structuredClone(f),
      t: rebase ? Number((f.t - fromT).toFixed(4)) : f.t,
    }));

  const baseT = rebase ? 0 : fromT;
  const duration = frames.length > 0 ? frames[frames.length - 1].t - baseT : 0;

  return {
    ...structuredClone(rec),
    duration,
    frames,
  };
}

/**
 * Saves a sliced or full decoded recording as JSON so it can be inspected or reloaded.
 * @param {Object} rec Decoded recording object.
 * @param {string} outPath Destination file path.
 */
export function saveReplaySliceJson(rec, outPath) {
  fs.writeFileSync(outPath, JSON.stringify(rec, null, 2), 'utf8');
}

/**
 * Classifies how a tank died at `currFrame` (`frameIdx`) and returns detailed forensic context.
 * @param {number} tid Tank ID (`0..14` for Red, `15..29` for Blue).
 * @param {Object} lastTank Last seen field tank snapshot before death.
 * @param {Object} prevFrame Previous frame.
 * @param {Object} currFrame Current frame.
 * @param {Object} rec Full decoded recording.
 * @param {number} frameIdx Index of `currFrame` in `rec.frames`.
 * @returns {Object} Forensic death record.
 */
export function classifyTankDeath(tid, lastTank, prevFrame, currFrame, rec, frameIdx) {
  const owner = tid < 15 ? 0 : 1;
  const enemyOwner = 1 - owner;
  const tx = lastTank ? lastTank.x : 0;
  const ty = lastTank ? lastTank.y : 0;

  const splash = (currFrame.explosions || []).some(e => e.splash && Math.hypot(e.x - tx, e.y - ty) < 12.0);
  const big = (currFrame.explosions || []).some(e => e.big && !e.splash && Math.hypot(e.x - tx, e.y - ty) < 12.0);
  let cause = splash ? 'PIT' : big ? 'MINE' : 'SHELL';
  let shooterDesc = cause;

  if (cause === 'PIT') {
    const pit = (rec.pits || []).find(p => Math.hypot(p.x - tx, p.y - ty) < 15.0);
    shooterDesc = pit ? `Pit #${pit.id} at (${pit.x.toFixed(1)}, ${pit.y.toFixed(1)})` : 'Pit';
  } else if (cause === 'MINE') {
    const mine = (prevFrame?.mines || []).find(m => Math.hypot(m.x - tx, m.y - ty) < 8.0);
    shooterDesc = mine
      ? `${mine.owner === 0 ? 'Red' : 'Blue'} Mine at (${mine.x.toFixed(1)}, ${mine.y.toFixed(1)})`
      : 'Mine';
  } else if (cause === 'SHELL' && prevFrame) {
    // Find shell in prevFrame or currFrame heading toward (tx, ty)
    let matchedShell = null;
    let bestD = 18.0;
    for (const s of [...(prevFrame.shells || []), ...(currFrame.shells || [])]) {
      const d = Math.hypot(s.x - tx, s.y - ty);
      if (d < bestD) {
        bestD = d;
        matchedShell = s;
      }
    }

    if (matchedShell) {
      let vx = matchedShell.vx;
      let vy = matchedShell.vy;
      let speed = Math.hypot(vx, vy);
      if (speed < 1.0) {
        speed = C.SHELL_RANGE_M / C.SHELL_FLIGHT_TIME_S;
        // Infer direction from previous frame shell displacement or shooter
        const prevCand = (prevFrame.shells || []).find(
          ps => ps.owner === matchedShell.owner && Math.abs(Math.hypot(matchedShell.x - ps.x, matchedShell.y - ps.y) - 8.0) < 3.5
        );
        if (prevCand && prevCand !== matchedShell) {
          const d = Math.hypot(matchedShell.x - prevCand.x, matchedShell.y - prevCand.y) || 1;
          vx = ((matchedShell.x - prevCand.x) / d) * speed;
          vy = ((matchedShell.y - prevCand.y) / d) * speed;
        }
      }
      const dirX = speed > 0 ? vx / speed : 1;
      const dirY = speed > 0 ? vy / speed : 0;

      let originX = matchedShell.x;
      let originY = matchedShell.y;
      let spawnT = prevFrame.t;

      for (let k = frameIdx - 1; k >= Math.max(0, frameIdx - 20); k--) {
        const fk = rec.frames[k];
        const cand = (fk.shells || []).find(
          sh =>
            sh.owner === matchedShell.owner &&
            Math.abs(Math.hypot(originX - sh.x, originY - sh.y) - 8.0) < 3.8
        );
        if (cand) {
          originX = cand.x;
          originY = cand.y;
          spawnT = fk.t;
        } else {
          break;
        }
      }

      const shooterOwner = matchedShell.owner;
      const shooterSide = shooterOwner === 0 ? 'Red' : 'Blue';
      const wallX = shooterOwner === 0 ? 0 : C.FIELD_LENGTH_M;
      const spawnFrame = rec.frames.find(f => Math.abs(f.t - spawnT) < 0.12) || prevFrame;
      const shooterTank = (spawnFrame.fieldTanks || []).find(
        t => (shooterOwner === 0 ? t.id < 15 : t.id >= 15) && Math.hypot(t.x - originX, t.y - originY) < 8.0
      );

      if (!shooterTank && Math.abs(originX - wallX) < 14.0) {
        cause = 'SLIT_GUN';
        const winIdx = Math.abs(originY - C.WINDOW_0_Y) < Math.abs(originY - C.WINDOW_1_Y) ? 1 : 2;
        shooterDesc = `${shooterSide} Slit Gun W${winIdx} (fired t=${spawnT.toFixed(1)}s)`;
      } else if (shooterTank) {
        shooterDesc = `${shooterSide} Tank #${shooterTank.number}[id=${shooterTank.id}] at (${shooterTank.x.toFixed(1)}, ${shooterTank.y.toFixed(1)})`;
      } else {
        // Also check if opponent was in window view when shell spawned
        const oppP = shooterOwner === 0 ? spawnFrame.p0 : spawnFrame.p1;
        if (oppP && oppP.view === 'window' && Math.abs(originX - wallX) < 20.0) {
          cause = 'SLIT_GUN';
          shooterDesc = `${shooterSide} Slit Gun W${oppP.windowIdx + 1} (fired t=${spawnT.toFixed(1)}s)`;
        } else {
          shooterDesc = `${shooterSide} Shell from (${originX.toFixed(1)}, ${originY.toFixed(1)})`;
        }
      }
    }
  }

  const enemyGateX = enemyOwner === 0 ? 0 : C.FIELD_LENGTH_M;
  const distToEnemyGate = Math.hypot(tx - enemyGateX, ty - C.GATE_Y);
  const inSlitSector = isInEnemySlitGunSector(tx, ty, enemyOwner, 0);
  const inSlitSectorBuffered = isInEnemySlitGunSector(tx, ty, enemyOwner, 2.0);
  const pState = owner === 0 ? prevFrame?.p0 : prevFrame?.p1;
  const wasSelected = pState ? String(pState.selected) === String(lastTank?.number) && pState.view === 'tank' : false;

  return {
    t: currFrame.t,
    frameIdx,
    owner,
    id: tid,
    number: lastTank?.number ?? '?',
    x: tx,
    y: ty,
    headingDeg: ((lastTank?.heading || 0) * 180) / Math.PI,
    speedKmh: (lastTank?.speed || 0) * 3.6,
    shells: lastTank?.shells ?? 0,
    wasSelected,
    cause,
    shooterDesc,
    distToEnemyGate,
    inSlitSector,
    inSlitSectorBuffered,
  };
}

/**
 * Reconstructs world state at `startT` from `rec`, fixing tank number assignments
 * so dead tanks have `number = null` and field/hangar tanks have unique numbers `'1'..'5'`.
 * @param {Object} rec Decoded recording.
 * @param {number} startT Target timestamp in seconds.
 * @returns {Object} Live simulation world at `startT`.
 */
export function createWorldAtTime(rec, startT) {
  const world = createWorld({ obstacles: rec.obstacles || [], pits: rec.pits || [] });
  const pb = createPlayback(rec, world);
  pb.seek(startT);

  for (const owner of [0, 1]) {
    const usedNums = new Set();
    for (const t of world.tanks) {
      if (t.owner !== owner) continue;
      if (t.status === 'dead') {
        t._label = t.number || String((t.id % 5) + 1);
        t.number = null;
      } else if (t.status === 'field') {
        let num = t.number ? String(t.number) : String((t.id % 5) + 1);
        if (usedNums.has(num)) {
          num = ['1', '2', '3', '4', '5'].find(n => !usedNums.has(n)) || num;
        }
        t.number = num;
        t._label = num;
        usedNums.add(num);
        const kmh = Math.round((t.speed * 3.6) / 6) * 6;
        t.cmdSpeedKmh = Math.max(-6, Math.min(36, kmh));
        t.cmdTurnDeg = 0;
        t.turn = 0;
        t.reload = t.reload ? 0.6 : 0;
      } else {
        t.number = null;
      }
    }
    const spares = world.tanks
      .filter(t => t.owner === owner && t.status === 'hangar')
      .sort((a, b) => a.row - b.row || a.i - b.i);
    for (const num of ['1', '2', '3', '4', '5']) {
      if (!usedNums.has(num) && spares.length > 0) {
        const sp = spares.shift();
        sp.number = num;
        sp._label = num;
      }
    }
  }

  world.mines = (world.mines || []).map(m => ({ ...m, armT: 0 }));
  world.smokes = (world.smokes || []).map(s => ({ ...s, t: s.t || 0 }));
  // Clear in-flight shells at snapshot boundary so we only track shells fired during the window
  world.shells = [];
  return world;
}

/**
 * Synchronizes Red (`owner = 0`) from the recording into `world` at `world.time`,
 * including Red field tank trajectories, Red tank shots, Red slit-gun shots, and Red mines.
 * @param {Object} world Live simulation world.
 * @param {Object} rec Decoded recording.
 * @param {{ idx: number }} prevFrameIdxRef Mutable frame index tracker.
 */
export function syncRedFromRecording(world, rec, prevFrameIdxRef) {
  let idx = Math.floor(world.time / C.REPLAY_SAMPLE_DT_S);
  if (idx < 0) idx = 0;
  if (idx >= rec.frames.length - 1) idx = rec.frames.length - 1;
  const nextIdx = Math.min(rec.frames.length - 1, idx + 1);
  const f1 = rec.frames[idx];
  const f2 = rec.frames[nextIdx];
  const dtF = f2.t - f1.t;
  const alpha = dtF > 0.0001 ? Math.max(0, Math.min(1, (world.time - f1.t) / dtF)) : 0;

  for (const rt of world.tanks) {
    if (rt.owner !== 0 || rt.status !== 'field') continue;
    const t1 = f1.fieldTanks.find(t => t.id === rt.id);
    const t2 = f2.fieldTanks.find(t => t.id === rt.id);
    if (t1 && t2) {
      rt.x = t1.x + (t2.x - t1.x) * alpha;
      rt.y = t1.y + (t2.y - t1.y) * alpha;
      rt.heading = wrapAngle(t1.heading + wrapAngle(t2.heading - t1.heading) * alpha);
      rt.speed = t1.speed + (t2.speed - t1.speed) * alpha;
      rt.turn = dtF > 0.001 ? wrapAngle(t2.heading - t1.heading) / dtF : 0;
      rt.cmdSpeedKmh = Math.round((rt.speed * 3.6) / 6) * 6;
    } else if (t1 && !t2) {
      rt.x = t1.x;
      rt.y = t1.y;
      rt.heading = t1.heading;
      rt.speed = t1.speed;
    }
  }

  // Also handle Red tank exiting hangar during the slice if it wasn't on the field at startT
  for (const t1 of f1.fieldTanks) {
    if (t1.id >= 15) continue;
    const wt = world.tanks.find(t => t.id === t1.id);
    if (wt && wt.status === 'hangar') {
      wt.status = 'field';
      wt.number = String(t1.number || (t1.id % 5) + 1);
      wt._label = wt.number;
      wt.x = t1.x;
      wt.y = t1.y;
      wt.heading = t1.heading;
      wt.speed = t1.speed;
      wt.shells = t1.shells;
      wt.mines = t1.mines;
      wt.smokes = t1.smokes;
    }
  }

  if (idx > prevFrameIdxRef.idx) {
    const prevF = rec.frames[prevFrameIdxRef.idx];
    prevFrameIdxRef.idx = idx;

    // 1. Red field tank shots
    for (const t1 of (f1.fieldTanks || [])) {
      if (t1.id >= 15) continue;
      const prevT = (prevF.fieldTanks || []).find(pt => pt.id === t1.id);
      if (prevT && !prevT.reload && t1.reload) {
        const shooter = world.tanks.find(t => t.id === t1.id && t.status === 'field');
        if (shooter) {
          const d = C.TANK_LENGTH_M / 2 + C.SHELL_MUZZLE_OFFSET_M;
          world.shells.push({
            owner: 0,
            x: shooter.x + Math.cos(shooter.heading) * d,
            y: shooter.y + Math.sin(shooter.heading) * d,
            dx: Math.cos(shooter.heading),
            dy: Math.sin(shooter.heading),
            dist: 0,
            win: false,
          });
        }
      }
    }

    // 2. Red window / slit-gun shots
    for (const s of (f1.shells || [])) {
      if (s.owner !== 0) continue;
      // Note: recording.js serializes s.vx/s.vy which are 0 because world shells use dx/dy + 80 m/s.
      // Across a 0.1s replay frame, an existing shell travels ~8.0m.
      const existed = (prevF.shells || []).some(
        ps => ps.owner === 0 && Math.abs(Math.hypot(s.x - ps.x, s.y - ps.y) - 8.0) < 3.6
      );
      if (!existed) {
        const isTankShot = (f1.fieldTanks || []).some(
          t => t.id < 15 && Math.hypot(t.x - s.x, t.y - s.y) < 8.5
        );
        if (!isTankShot && s.x < 12.0) {
          let dx = 0;
          let dy = 0;
          const spd = Math.hypot(s.vx, s.vy);
          if (spd > 1.0) {
            dx = s.vx / spd;
            dy = s.vy / spd;
          } else {
            // Reconstruct slit gun shell heading from f1.p0.windowYaw or next frame shell position
            const nextShell = (f2.shells || []).find(
              ns => ns.owner === 0 && Math.abs(Math.hypot(ns.x - s.x, ns.y - s.y) - 8.0) < 3.6 && ns.x > s.x
            );
            if (nextShell) {
              const distNext = Math.hypot(nextShell.x - s.x, nextShell.y - s.y) || 1;
              dx = (nextShell.x - s.x) / distNext;
              dy = (nextShell.y - s.y) / distNext;
            } else {
              const winY = f1.p0?.windowIdx === 0 ? 42.0 : 58.0;
              const yaw = f1.p0?.view === 'window'
                ? f1.p0.windowYaw
                : Math.atan2(s.y - winY, Math.max(1.0, s.x));
              dx = Math.cos(yaw);
              dy = Math.sin(yaw);
            }
          }
          const winY = Math.abs(s.y - 42.0) <= Math.abs(s.y - 58.0) ? 42.0 : 58.0;
          const alreadyTraveled = Math.hypot(Math.max(0.4, s.x) - 0.4, s.y - winY);
          world.shells.push({
            owner: 0,
            x: Math.max(0.4, s.x),
            y: s.y,
            dx,
            dy,
            dist: alreadyTraveled,
            win: true,
          });
        }
      }
    }

    // 3. Red mines
    for (const m of (f1.mines || [])) {
      if (m.owner !== 0) continue;
      const existedMine = world.mines.some(wm => Math.hypot(wm.x - m.x, wm.y - m.y) < 1.0);
      if (!existedMine) {
        world.mines.push({ owner: 0, x: m.x, y: m.y, armT: C.MINE_ARM_DELAY_S });
      }
    }
  }
}

/**
 * Simulates a moment `[startT, startT + duration]` with live AI controlling Blue (`owner = 1`).
 * @param {Object} rec Decoded recording.
 * @param {{ startT: number, duration: number, level?: string }} opts
 * @returns {Object} Simulation results.
 */
export function simulateMoment(rec, { startT, duration, level = 'HARD' }) {
  const world = createWorldAtTime(rec, startT);
  const ai = new AiController(1);
  ai.sliceTimer = 1.2;

  const dt = 1 / C.SIM_TICK_HZ;
  const steps = Math.round(duration / dt);
  const prevFrameIdxRef = { idx: Math.floor(startT / C.REPLAY_SAMPLE_DT_S) };
  let blueShots = 0;
  let redKilled = 0;
  let blueKilled = 0;
  let blueSlitExposureTicks = 0;
  const deadSeen = new Set(world.tanks.filter(t => t.status === 'dead').map(t => t.id));

  const events = [];
  for (let s = 0; s < steps; s++) {
    const shellsBefore = world.shells.filter(sh => sh.owner === 1).length;
    syncRedFromRecording(world, rec, prevFrameIdxRef);
    ai.update(world, dt, level);
    step(world, dt, { windowTurn: [0, ai.windowTurn] });

    for (const t of world.tanks) {
      if (t.owner === 1 && t.status === 'field') {
        if (isInEnemySlitGunSector(t.x, t.y, 0, 0)) {
          blueSlitExposureTicks++;
        }
      }
    }

    const shellsAfter = world.shells.filter(sh => sh.owner === 1).length;
    if (shellsAfter > shellsBefore) {
      blueShots++;
      const newest = world.shells.filter(sh => sh.owner === 1).pop();
      const sel = selectedTank(world, 1);
      if (newest && newest.win) {
        events.push(`t=${world.time.toFixed(1)}s: Blue Slit Gun FIRED shell from (${newest.x.toFixed(1)}, ${newest.y.toFixed(1)})`);
      } else {
        events.push(`t=${world.time.toFixed(1)}s: Blue #${sel?._label ?? '?'} FIRED shell from (${sel?.x.toFixed(1)}, ${sel?.y.toFixed(1)})`);
      }
    }

    for (const t of world.tanks) {
      if (t.status === 'dead' && !deadSeen.has(t.id)) {
        deadSeen.add(t.id);
        const inSlit = isInEnemySlitGunSector(t.x, t.y, 0, 0);
        if (t.owner === 0) {
          redKilled++;
          events.push(`t=${world.time.toFixed(1)}s: RED #${t._label} (id=${t.id}) DESTROYED at (${t.x.toFixed(1)}, ${t.y.toFixed(1)})`);
        } else {
          blueKilled++;
          events.push(
            `t=${world.time.toFixed(1)}s: BLUE #${t._label} (id=${t.id}) LOST at (${t.x.toFixed(1)}, ${t.y.toFixed(1)})${inSlit ? ' [IN SLIT SECTOR]' : ''}`
          );
        }
      }
    }
  }

  return {
    blueShots,
    redKilled,
    blueKilled,
    blueSlitExposureSeconds: Number((blueSlitExposureTicks * dt).toFixed(2)),
    events,
    decisionLog: ai.decisionLog,
  };
}
