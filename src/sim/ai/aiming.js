import * as C from '../../constants.js';
import { normalizeAngle } from './math.js';
import { isLineOfFireBlocked } from './perception.js';

/**
 * Hull aiming. The gun is rigidly fixed to the hull (no turret), so aiming means steering the
 * whole tank until its heading points at the lead point of the target.
 */

/** Point the shell must be aimed at: target position advanced by its motion over the shell flight time. */
export function leadPoint(tank, targetX, targetY, targetSpeed, targetHeading, leadFactor) {
  const dist = Math.hypot(targetX - tank.x, targetY - tank.y);
  const shellSpeed = C.SHELL_RANGE_M / C.SHELL_FLIGHT_TIME_S;
  const tFly = dist / shellSpeed;
  return {
    x: targetX + Math.cos(targetHeading) * targetSpeed * tFly * leadFactor,
    y: targetY + Math.sin(targetHeading) * targetSpeed * tFly * leadFactor,
    dist,
  };
}

/** Signed heading error (rad) from the tank's heading to the aim point; positive = turn right. */
export function aimError(tank, aimX, aimY) {
  return normalizeAngle(Math.atan2(aimY - tank.y, aimX - tank.x) - tank.heading);
}

/** Turn-rate command (deg/s, positive = right) that drives the heading error to zero without hunting. */
export function aimTurnCommandDeg(errRad) {
  const errDeg = C.radToDeg(errRad);
  if (Math.abs(errDeg) <= C.AI_AIM_DEADBAND_DEG) return 0;
  const limit = C.TANK_MAX_PIVOT_TURN_DEG_S; // aiming is done while stopped: pivot limit
  return Math.max(-limit, Math.min(limit, errDeg * C.AI_AIM_GAIN_PER_S));
}

/**
 * Decides whether the tank should stop and aim at the chosen target. Returns the aim solution
 * ({x, y, errRad, turnDeg}) or null when aiming is not appropriate/possible (out of range,
 * blocked line of fire, ...).
 */
export function findAimSolution(world, owner, tank, target, targetPos, profile) {
  if (!target || !targetPos || tank.shells <= 0) return null;
  const maxDist = profile.maxFireDist || C.SHELL_RANGE_M;
  const lead = leadPoint(tank, targetPos.x, targetPos.y, target.speed, target.heading, profile.leadFactor);
  if (lead.dist > maxDist) return null;
  if (isLineOfFireBlocked(world, owner, tank.x, tank.y, lead.x, lead.y, tank.id)) return null;
  const errRad = aimError(tank, lead.x, lead.y);
  return { x: lead.x, y: lead.y, errRad, turnDeg: aimTurnCommandDeg(errRad) };
}
