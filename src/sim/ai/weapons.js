import * as C from '../../constants.js';
import { applyAction } from '../world.js';
import { segmentVsObb } from '../geometry.js';
import { normalizeAngle } from './math.js';
import { isLineOfSightBlockedBySmoke, getPredictedEnemyState, isLineOfFireBlocked } from './perception.js';
import { leadPoint, maxEngageDist } from './aiming.js';

/** High-frequency firing reflex: handles direct line of sight as well as blind fire through smoke. */
export function tryFireWeapon(world, owner, tank, enemyField, profile, enemyTracker, simTime, levelName) {
  if (tank.shells <= 0 || tank.reload > 0 || enemyField.length === 0) return false;

  const isHard = levelName === 'HARD' || profile.leadFactor >= 0.95;
  const muzzleOffset = C.TANK_LENGTH_M / 2 + C.SHELL_MUZZLE_OFFSET_M;
  const mx = tank.x + Math.cos(tank.heading) * muzzleOffset;
  const my = tank.y + Math.sin(tank.heading) * muzzleOffset;
  const shellRange = world.shellRange || C.SHELL_RANGE_M;
  const rayEndX = mx + Math.cos(tank.heading) * shellRange;
  const rayEndY = my + Math.sin(tank.heading) * shellRange;

  for (const e of enemyField) {
    const smokeBlocked = isLineOfSightBlockedBySmoke(world, tank.x, tank.y, e.x, e.y);

    let targetX = e.x;
    let targetY = e.y;
    let targetSpeed = e.speed;
    let targetHeading = e.heading;
    let targetTurn = e.turn || 0;

    if (smokeBlocked) {
      const pred = getPredictedEnemyState(enemyTracker, e, simTime, levelName);
      if (!pred || !pred.canBlindFire) {
        // Cannot see through smoke cloud and prediction quality too low -> do not fire blindly
        continue;
      }
      // Apply blind-fire dispersion: shooter knows general location in cloud, but not exact hull center
      const dispRadius = Math.min(C.AI_SMOKE_BLIND_FIRE_DISPERSION_M, 1.5 + pred.timeSinceSeen * 1.0);
      const dispAngle = Math.random() * Math.PI * 2;
      targetX = pred.predX + Math.cos(dispAngle) * dispRadius;
      targetY = pred.predY + Math.sin(dispAngle) * dispRadius;
      targetSpeed = pred.speed;
      targetHeading = pred.heading;
      targetTurn = 0;

      // Roll probability of deciding to fire blindly
      if (Math.random() > pred.hitProb) {
        continue;
      }
    }

    const effectiveLead = isHard
      ? profile.leadFactor
      : profile.leadFactor * (0.9 + Math.random() * 0.2);
    const lead = leadPoint(tank, targetX, targetY, targetSpeed, targetHeading, effectiveLead, targetTurn);

    // Account for target hull extents (3m half-length / 2m half-width) so shots that physically
    // intersect the target hull within the 32m shell travel are taken immediately.
    if (lead.muzzleDist > maxEngageDist(profile, targetSpeed) + 2.6) continue;

    const aimAngle = Math.atan2(lead.y - tank.y, lead.x - tank.x);
    const aimErr = Math.abs(normalizeAngle(aimAngle - tank.heading));

    const effDist = Math.max(4.0, lead.leadDist);
    const targetAngularHalfWidth = Math.atan2(C.TANK_WIDTH_M / 2 - 0.1, effDist);
    const allowedTol = isHard
      ? Math.max(0.03, Math.min(targetAngularHalfWidth, profile.fireTolerance))
      : Math.max(targetAngularHalfWidth, Math.min(profile.fireTolerance, 0.16) * (0.92 + Math.random() * 0.16));

    // Exact ballistic ray intersection against predicted target hull OBB at shell arrival
    const tArrival = Math.min(C.SHELL_FLIGHT_TIME_S, lead.muzzleDist / (shellRange / C.SHELL_FLIGHT_TIME_S));
    const predObb = {
      x: lead.x,
      y: lead.y,
      h: targetHeading + targetTurn * tArrival,
      l: C.TANK_LENGTH_M * (isHard ? 0.88 : 0.95),
      w: C.TANK_WIDTH_M * (isHard ? 0.88 : 0.95),
    };
    const rayHitsPredictedHull = !smokeBlocked && segmentVsObb(mx, my, rayEndX, rayEndY, predObb) != null;

    if ((rayHitsPredictedHull || (lead.muzzleDist <= maxEngageDist(profile, targetSpeed) + 1.5 && aimErr <= allowedTol)) && (isHard || Math.random() < 0.96)) {
      if (!isLineOfFireBlocked(world, owner, tank.x, tank.y, lead.x, lead.y, tank.id)) {
        applyAction(world, owner, 'FIRE');
        return e;
      }
    }
  }
  return false;
}
