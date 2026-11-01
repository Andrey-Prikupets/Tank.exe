import * as C from '../../constants.js';
import { normalizeAngle, fuzz } from './math.js';
import { isLineOfSightBlockedBySmoke, isLineOfFireBlocked } from './perception.js';
import { segmentVsObb, toLocal } from '../geometry.js';
import { MINE_LETHAL_RADIUS_M, isSegmentInEnemySlitGunSector } from '../nav.js';

const MUZZLE_OFFSET_M = C.TANK_LENGTH_M / 2 + C.SHELL_MUZZLE_OFFSET_M;

/**
 * Maximum distance (from gun muzzle to target hull) at which the AI engages a target.
 */
export function maxEngageDist(profile, targetSpeed) {
  const max = profile.maxFireDist || C.SHELL_RANGE_M;
  return Math.abs(targetSpeed || 0) > fuzz(C.AI_MOVING_TARGET_SPEED_MS, profile, 0.1, 8.0)
    ? Math.min(max, C.AI_EFFECTIVE_MOVING_RANGE_M)
    : max;
}

/**
 * Hull aiming. The gun is rigidly fixed to the hull (no turret), so aiming means steering the
 * whole tank until its heading points at the lead point of the target.
 */

/** Point the shell must be aimed at: target position advanced by its motion over the shell flight time. */
export function leadPoint(tank, targetX, targetY, targetSpeed, targetHeading, leadFactor, targetTurn = 0) {
  const rawDist = Math.hypot(targetX - tank.x, targetY - tank.y);
  const shellSpeed = C.SHELL_RANGE_M / C.SHELL_FLIGHT_TIME_S;
  const v = (targetSpeed || 0) * leadFactor;
  const omega = (targetTurn || 0) * leadFactor;

  const projectAt = (tFly) => {
    if (Math.abs(omega) > 0.04 && Math.abs(v) > 0.3) {
      const endH = targetHeading + omega * tFly;
      return {
        x: targetX + (v / omega) * (Math.sin(endH) - Math.sin(targetHeading)),
        y: targetY - (v / omega) * (Math.cos(endH) - Math.cos(targetHeading)),
      };
    }
    return {
      x: targetX + Math.cos(targetHeading) * v * tFly,
      y: targetY + Math.sin(targetHeading) * v * tFly,
    };
  };

  // Two-step iterative flight-time refinement from the gun muzzle (capped at max shell flight time)
  let tFly = Math.min(C.SHELL_FLIGHT_TIME_S, Math.max(0, rawDist - MUZZLE_OFFSET_M) / shellSpeed);
  let pt = projectAt(tFly);
  let leadDist = Math.hypot(pt.x - tank.x, pt.y - tank.y);
  tFly = Math.min(C.SHELL_FLIGHT_TIME_S, Math.max(0, leadDist - MUZZLE_OFFSET_M) / shellSpeed);
  pt = projectAt(tFly);
  leadDist = Math.hypot(pt.x - tank.x, pt.y - tank.y);
  const muzzleDist = Math.max(0, leadDist - MUZZLE_OFFSET_M);

  return {
    x: pt.x,
    y: pt.y,
    dist: rawDist,
    leadDist,
    muzzleDist,
  };
}

/** Signed heading error (rad) from the tank's heading to the aim point; positive = turn right. */
export function aimError(tank, aimX, aimY) {
  return normalizeAngle(Math.atan2(aimY - tank.y, aimX - tank.x) - tank.heading);
}

/** Turn-rate command (deg/s, positive = right) that drives the heading error to zero without hunting. */
export function aimTurnCommandDeg(errRad, currentTurnDeg = 0, isMoving = false, profile = null) {
  let errDeg = C.radToDeg(errRad);
  if (Math.abs(errDeg) <= fuzz(C.AI_AIM_DEADBAND_DEG, profile, 0.1, 8.0)) return 0;
  // Hysteresis around the 180-degree blind spot to prevent rapid +/- flipping
  if (Math.abs(errDeg) > fuzz(170, profile, 145, 179) && Math.abs(currentTurnDeg) > 0) {
    errDeg = currentTurnDeg > 0 ? 180 : -180;
  }
  const limit = isMoving ? C.TANK_MAX_TURN_DEG_S : C.TANK_MAX_PIVOT_TURN_DEG_S;
  const gain = isMoving ? Math.max(fuzz(2.2, profile, 1.0, 4.0), C.AI_AIM_GAIN_PER_S) : C.AI_AIM_GAIN_PER_S;
  return Math.max(-limit, Math.min(limit, errDeg * gain));
}

function isForwardArcHazardous(world, tank, checkDist = 11.0) {
  const fx = tank.x + Math.cos(tank.heading) * checkDist;
  const fy = tank.y + Math.sin(tank.heading) * checkDist;
  if (fx < 6 || fx > C.FIELD_LENGTH_M - 6 || fy < 6 || fy > C.FIELD_WIDTH_M - 6) return 'forward_hazard';
  if (world.mines) {
    for (const m of world.mines) {
      if (Math.hypot(tank.x - m.x, tank.y - m.y) < MINE_LETHAL_RADIUS_M + 0.5) return 'mine_proximity';
      const [mlx, mly] = toLocal(tank, m.x, m.y);
      if (mlx > -1.0 && mlx < checkDist && Math.abs(mly) < MINE_LETHAL_RADIUS_M) return 'forward_hazard';
    }
  }
  if (world.pits) {
    for (const pit of world.pits) {
      const [tlx, tly] = toLocal(pit, tank.x, tank.y);
      const startInOuter = Math.abs(tlx) < pit.l / 2 + 3.8 && Math.abs(tly) < pit.w / 2 + 3.8;
      if (startInOuter) {
        const corePit = { x: pit.x, y: pit.y, h: pit.h, l: pit.l + 2.4, w: pit.w + 2.4 };
        if (segmentVsObb(tank.x, tank.y, fx, fy, corePit) != null) return 'forward_hazard';
        if (Math.hypot(fx - pit.x, fy - pit.y) < Math.hypot(tank.x - pit.x, tank.y - pit.y) + 1.0) {
          return 'forward_hazard';
        }
      } else {
        const expPit = { x: pit.x, y: pit.y, h: pit.h, l: pit.l + 7.0, w: pit.w + 7.0 };
        if (segmentVsObb(tank.x, tank.y, fx, fy, expPit) != null) return 'forward_hazard';
      }
    }
  }
  if (isSegmentInEnemySlitGunSector(tank.x, tank.y, fx, fy, 1 - tank.owner, 1.0)) {
    return 'slit_ahead';
  }
  return null;
}

/**
 * Decides whether the tank should aim at the chosen target. Returns the aim solution
 * ({x, y, errRad, turnDeg, cmdSpeedKmh}) or null when aiming is not appropriate/possible.
 */
export function findAimSolution(world, owner, tank, target, targetPos, profile) {
  if (!target || !targetPos || tank.shells <= 0) return null;
  const fuzzedLead = profile.leadFactor > 0 ? fuzz(profile.leadFactor, profile, 0, 1.2) : 0;
  const lead = leadPoint(
    tank,
    targetPos.x,
    targetPos.y,
    target.speed,
    target.heading,
    fuzzedLead,
    target.turn || 0,
  );
  // Pre-align hull gun early (up to +16m before max shell reach) while closing at full speed
  // so the barrel is already dead-on the lead point the instant the enemy crosses max range!
  const maxMuzzleDist = maxEngageDist(profile, target.speed) + fuzz(16.0, profile, 4.0, 26.0);
  if (lead.muzzleDist > maxMuzzleDist) return null;
  if (isLineOfFireBlocked(world, owner, tank.x, tank.y, lead.x, lead.y, tank.id)) return null;

  const errRad = aimError(tank, lead.x, lead.y);
  const absErr = Math.abs(errRad);

  // If a mine or pit is right in front of the hull, let full trajectory planner avoid it first.
  // Use a compact probe when already within firing range or nearly aligned so tanks near a pit
  // can still aim and fire at enemies in open ground instead of freezing.
  const probeDist =
    lead.muzzleDist <= fuzz(30.0, profile, 18.0, 38.0) || absErr < fuzz(0.35, profile, 0.1, 0.8)
      ? fuzz(6.5, profile, 4.5, 8.0)
      : fuzz(11.0, profile, 7.5, 15.0);
  const hazardAhead = isForwardArcHazardous(world, tank, probeDist);
  if (hazardAhead === 'mine_proximity' || hazardAhead === 'forward_hazard') return null;

  // Moving tanks turn at 45 deg/s vs 30 deg/s when stopped!
  // Stay mobile while turning or closing range, and only slow down when nearly aligned inside range.
  let cmdSpeedKmh = 0;
  if (hazardAhead === 'slit_ahead') {
    const shortClear = !isSegmentInEnemySlitGunSector(
      tank.x,
      tank.y,
      tank.x + Math.cos(tank.heading) * 4.5,
      tank.y + Math.sin(tank.heading) * 4.5,
      1 - tank.owner,
      0,
    );
    cmdSpeedKmh = absErr > fuzz(0.20, profile, 0.05, 0.6) && shortClear ? 6 : 0;
  } else if (
    lead.muzzleDist > maxEngageDist(profile, target.speed) - fuzz(1.0, profile, 0.1, 4.0) &&
    absErr < fuzz(1.65, profile, 0.5, Math.PI)
  ) {
    cmdSpeedKmh = Math.min(profile.maxSpeedKmh || 36, 36);
  } else if (absErr > fuzz(0.16, profile, 0.03, 0.6)) {
    cmdSpeedKmh = Math.min(profile.maxSpeedKmh || 18, 18);
  } else if (absErr > fuzz(0.04, profile, 0.01, 0.25) || Math.abs(target.speed || 0) > fuzz(2.0, profile, 0.2, 8.0)) {
    cmdSpeedKmh = 6;
  }

  const isMoving = cmdSpeedKmh !== 0;
  return {
    x: lead.x,
    y: lead.y,
    errRad,
    turnDeg: aimTurnCommandDeg(errRad, tank.cmdTurnDeg || 0, isMoving, profile),
    cmdSpeedKmh,
  };
}
