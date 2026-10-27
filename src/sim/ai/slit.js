import * as C from '../../constants.js';
import { applyAction, gateX, inwardDir, baseHeading, windowY } from '../world.js';
import { normalizeAngle } from './math.js';
import { isLineOfSightBlockedBySmoke, getPredictedEnemyState, isLineOfFireBlocked } from './perception.js';

/** Tactical slit window defense: locks onto enemy targets in field of view, aims, and fires unlimited shells. */
export function updateSlit(ctl, world, dt, profile) {
  const owner = ctl.owner;
  const pl = world.players[owner];
  const wx = gateX(owner) + inwardDir(owner) * C.WINDOW_CAMERA_INSET_M;
  const wy = windowY(owner, pl.windowIdx);
  const baseHead = baseHeading(owner);
  const currentHead = baseHead + pl.windowYaw;
  const maxYaw = C.degToRad(C.WINDOW_MAX_YAW_DEG);

  const enemyField = world.tanks.filter((t) => t.owner !== owner && t.status === 'field');
  let bestEnemy = null;
  let bestEnemyPos = null;
  let bestScore = Infinity;

  for (const e of enemyField) {
    const smokeBlocked = isLineOfSightBlockedBySmoke(world, wx, wy, e.x, e.y);

    let targetX = e.x;
    let targetY = e.y;
    let smokeScorePenalty = 0;

    if (smokeBlocked) {
      const pred = getPredictedEnemyState(ctl.enemyTracker, e, ctl.simTime, profile);
      if (!pred || !pred.canBlindFire || Math.random() > pred.hitProb) {
        // Cannot see through smoke cloud and cannot blind fire
        continue;
      }
      targetX = pred.predX;
      targetY = pred.predY;
      smokeScorePenalty = (1 - pred.hitProb) * 20;
    }

    const dx = targetX - wx;
    const dy = targetY - wy;
    const dist = Math.hypot(dx, dy);
    if (dist > C.AI_SLIT_MAX_FIRE_DIST_M) continue;

    const angle = Math.atan2(dy, dx);
    const relYaw = normalizeAngle(angle - baseHead);
    if (Math.abs(relYaw) > maxYaw + 0.15) continue;

    if (isLineOfFireBlocked(world, owner, wx, wy, targetX, targetY, null)) continue;

    const yawDiff = Math.abs(normalizeAngle(angle - currentHead));
    const isLocked = e.id === ctl.lockedTargetId;
    const score =
      dist + yawDiff * 25 - (isLocked ? C.AI_TARGET_STICKINESS_BONUS : 0) + smokeScorePenalty;
    if (score < bestScore) {
      bestScore = score;
      bestEnemy = e;
      bestEnemyPos = { x: targetX, y: targetY };
    }
  }

  if (bestEnemy && bestEnemyPos) {
    ctl.lockedTargetId = bestEnemy.id;
    ctl.note('SLIT', `Window ${pl.windowIdx + 1} locks enemy #${bestEnemy.id}`, {
      key: 'slit-lock',
      sig: bestEnemy.id,
      gap: 1,
    });
    world.players[owner].lockedTarget = {
      id: bestEnemy.id,
      x: bestEnemyPos.x,
      y: bestEnemyPos.y,
      isWindow: true,
      windowIdx: pl.windowIdx,
    };

    const targetAngle = Math.atan2(bestEnemyPos.y - wy, bestEnemyPos.x - wx);
    const yawErr = normalizeAngle(targetAngle - currentHead);

    if (Math.abs(yawErr) <= C.AI_SLIT_AIM_TOLERANCE_RAD) {
      ctl.windowTurn = 0;
    } else if (yawErr > 0) {
      ctl.windowTurn = Math.abs(yawErr) > 0.25 ? 1 : 0.4;
    } else {
      ctl.windowTurn = Math.abs(yawErr) > 0.25 ? -1 : -0.4;
    }

    if (Math.abs(yawErr) <= C.AI_SLIT_FIRE_TOLERANCE_RAD && pl.windowReload <= 0) {
      applyAction(world, owner, 'FIRE');
      ctl.note('SLIT', `Slit gun fires at enemy #${bestEnemy.id}`, { key: 'slit-fire', gap: 1.5 });
    }
  } else {
    ctl.windowTurn = 0;
    ctl.lockedTargetId = null;
    world.players[owner].lockedTarget = null;

    const otherIdx = pl.windowIdx === 0 ? 1 : 0;
    const otherWy = windowY(owner, otherIdx);
    const canSeeInOther = enemyField.some((e) => {
      if (isLineOfSightBlockedBySmoke(world, wx, otherWy, e.x, e.y)) return false;
      const dx = e.x - wx;
      const dy = e.y - otherWy;
      const dist = Math.hypot(dx, dy);
      if (dist > C.AI_SLIT_MAX_FIRE_DIST_M) return false;
      const relYaw = normalizeAngle(Math.atan2(dy, dx) - baseHead);
      return (
        Math.abs(relYaw) <= maxYaw &&
        !isLineOfFireBlocked(world, owner, wx, otherWy, e.x, e.y, null)
      );
    });

    if (canSeeInOther) {
      ctl.note('SLIT', `Switching to window ${otherIdx + 1} (enemy crossed gate axis)`, {
        key: 'slit-switch',
        gap: 2,
      });
      applyAction(world, owner, otherIdx === 0 ? 'WIN_R' : 'WIN_L');
      return;
    }

    ctl.slitTimer += dt;
    if (ctl.slitTimer > 2.5) {
      const fieldTank = world.tanks.find((t) => t.owner === owner && t.status === 'field');
      if (fieldTank && fieldTank.number) {
        ctl.slitTimer = 0;
        ctl.note('SLIT', `No targets in window - back to tank ${fieldTank.number}`, {
          key: 'slit-exit',
          gap: 2,
        });
        applyAction(world, owner, 'SELECT', fieldTank.number);
      }
    }
  }
}