import * as C from '../../constants.js';
import { applyAction } from '../world.js';
import { normalizeAngle } from './math.js';
import { isLineOfSightBlockedBySmoke, getPredictedEnemyState, isLineOfFireBlocked } from './perception.js';

/** High-frequency firing reflex: handles direct line of sight as well as blind fire through smoke. */
export function tryFireWeapon(world, owner, tank, enemyField, profile, enemyTracker, simTime, levelName) {
  if (tank.shells <= 0 || tank.reload > 0 || enemyField.length === 0) return false;

  const maxDist = profile.maxFireDist || C.SHELL_RANGE_M;

  for (const e of enemyField) {
    const smokeBlocked = isLineOfSightBlockedBySmoke(world, tank.x, tank.y, e.x, e.y);

    let targetX = e.x;
    let targetY = e.y;
    let targetSpeed = e.speed;
    let targetHeading = e.heading;

    if (smokeBlocked) {
      const pred = getPredictedEnemyState(enemyTracker, e, simTime, levelName);
      if (!pred || !pred.canBlindFire) {
        // Cannot see through smoke cloud and prediction quality too low -> do not fire blindly
        continue;
      }
      targetX = pred.predX;
      targetY = pred.predY;
      targetSpeed = pred.speed;
      targetHeading = pred.heading;

      // Roll probability of deciding to fire blindly
      if (Math.random() > pred.hitProb) {
        continue;
      }
    }

    const dx = targetX - tank.x;
    const dy = targetY - tank.y;
    const dist = Math.hypot(dx, dy);
    if (dist > maxDist) continue;

    const shellSpeed = C.SHELL_RANGE_M / C.SHELL_FLIGHT_TIME_S;
    const tFly = dist / shellSpeed;
    const effectiveLead = profile.leadFactor * (0.9 + Math.random() * 0.2);
    const aimX = targetX + Math.cos(targetHeading) * targetSpeed * tFly * effectiveLead;
    const aimY = targetY + Math.sin(targetHeading) * targetSpeed * tFly * effectiveLead;

    const aimAngle = Math.atan2(aimY - tank.y, aimX - tank.x);
    const aimErr = Math.abs(normalizeAngle(aimAngle - tank.heading));

    const targetAngularHalfWidth = Math.atan2(C.TANK_WIDTH_M / 2 + 0.3, dist);
    const jitteredTol = Math.min(profile.fireTolerance, 0.16) * (0.92 + Math.random() * 0.16);
    const allowedTol = Math.max(targetAngularHalfWidth, jitteredTol);

    if (aimErr <= allowedTol && Math.random() < 0.96) {
      if (!isLineOfFireBlocked(world, owner, tank.x, tank.y, aimX, aimY, tank.id)) {
        applyAction(world, owner, 'FIRE');
        return e;
      }
    }
  }
  return false;
}