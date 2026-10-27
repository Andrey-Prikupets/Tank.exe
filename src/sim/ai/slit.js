import * as C from '../../constants.js';
import { applyAction, gateX, inwardDir, baseHeading, windowY } from '../world.js';
import { normalizeAngle } from './math.js';
import { isLineOfSightBlockedBySmoke, getPredictedEnemyState, isLineOfFireBlocked } from './perception.js';
import { evaluateTankUrgency } from './urgency.js';

const ownFieldTanks = (world, owner) => world.tanks.filter((t) => t.owner === owner && t.status === 'field');

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
  const fieldTanks = ownFieldTanks(world, owner);

  // Critical hazard rescue: even if firing from window, save a field unit from lethal pit/mine
  for (const t of fieldTanks) {
    if (!t.number) continue;
    const timeSince = ctl.simTime - (ctl.lastCommandedTime.get(t.id) || 0);
    const evalU = evaluateTankUrgency(world, owner, t, enemyField, profile, timeSince, ctl.enemyTracker, ctl.simTime);
    if (evalU.hazardScore >= C.AI_URGENCY_HAZARD_PIT) {
      ctl.slitTimer = 0;
      ctl.slitCooldownUntil = ctl.simTime + C.AI_SLIT_REENTRY_COOLDOWN_S;
      ctl.note('AVOID', `T${t.number} critical hazard - leaving window to rescue`, {
        key: 'slit-rescue',
        gap: 2,
      });
      applyAction(world, owner, 'SELECT', t.number);
      return;
    }
  }

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
    // Leave the window early when a field tank faces a hazard / ready shot, otherwise after idling.
    let needy = null;
    let needyU = -Infinity;
    for (const t of fieldTanks) {
      if (!t.number) continue;
      const timeSince = ctl.simTime - (ctl.lastCommandedTime.get(t.id) || 0);
      const u = evaluateTankUrgency(world, owner, t, enemyField, profile, timeSince, ctl.enemyTracker, ctl.simTime).urgency;
      if (u > needyU) {
        needyU = u;
        needy = t;
      }
    }
    const urgent = needy && needyU >= C.AI_SLIT_EXIT_URGENCY;
    if (needy && (urgent || ctl.slitTimer > C.AI_SLIT_EXIT_IDLE_S)) {
      ctl.slitTimer = 0;
      ctl.slitCooldownUntil = ctl.simTime + C.AI_SLIT_REENTRY_COOLDOWN_S;
      ctl.note('SLIT', `No targets in window - back to tank ${needy.number}`, {
        key: 'slit-exit',
        gap: 2,
      });
      applyAction(world, owner, 'SELECT', needy.number);
      return;
    }
    if (!needy) {
      const reserves = world.tanks.filter((t) => t.owner === owner && t.status === 'hangar' && t.number != null);
      const armedReserve = reserves.find((t) => t.shells > 0) || reserves[0];
      if (armedReserve && (ctl.slitTimer > C.AI_SLIT_EXIT_IDLE_S || enemyField.length === 0)) {
        ctl.slitTimer = 0;
        ctl.slitCooldownUntil = ctl.simTime + C.AI_SLIT_REENTRY_COOLDOWN_S;
        ctl.note('SLIT', `No field tanks - leaving window to deploy reserve ${armedReserve.number}`, {
          key: 'slit-exit',
          gap: 2,
        });
        applyAction(world, owner, 'SELECT', armedReserve.number);
        applyAction(world, owner, 'FORWARD');
      }
    }
  }
}