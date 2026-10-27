import * as C from '../../constants.js';
import { applyAction } from '../world.js';
import { segmentVsObb, toLocal } from '../geometry.js';
import { isInEnemySlitGunSector } from '../nav.js';
import { normalizeAngle } from './math.js';
import { isLineOfSightBlockedBySmoke, getPredictedEnemyState, isLineOfFireBlocked } from './perception.js';

/** Human-readable reason why a tank scored high urgency (for the AI decision log). */
export function urgencyReason(info) {
  if (info.hazardScore > 0 && info.hazardScore >= info.combatScore && info.hazardScore >= info.rearmScore) {
    const h = info.hazardScore;
    const text =
      h >= C.AI_URGENCY_HAZARD_PIT
        ? 'pit ahead'
        : h >= 92
          ? 'enemy slit-gun sector ahead'
          : h >= C.AI_URGENCY_HAZARD_MINE
            ? 'mine ahead'
            : 'obstacle/boundary ahead';
    return { tag: 'AVOID', text };
  }
  if (info.combatScore > 0 && info.combatScore >= info.rearmScore) {
    const c = info.combatScore;
    const text =
      c >= C.AI_URGENCY_COMBAT_AIMED
        ? 'aimed shot ready'
        : c >= C.AI_URGENCY_COMBAT_SHELL_INCOMING
          ? 'incoming shell'
          : 'engaging target';
    return { tag: 'ATTACK', text };
  }
  if (info.rearmScore > 0) return { tag: 'REARM', text: 'out of shells' };
  return { tag: 'SELECT', text: 'neglected unit' };
}

/** Evaluates Urgency Score (U_i) for a brigade unit. */
export function evaluateTankUrgency(world, owner, tank, enemyField, profile, timeSinceCommand, enemyTracker, simTime) {
  let hazardScore = 0;
  let combatScore = 0;
  let rearmScore = 0;

  // 1. Hazards: Course projection
  const lookAhead = Math.max(C.AI_MINE_LOOKAHEAD_MIN_M, Math.abs(tank.speed) * 2.5);
  const fx = tank.x + Math.cos(tank.heading) * lookAhead;
  const fy = tank.y + Math.sin(tank.heading) * lookAhead;

  // Pits
  if (world.pits && world.pits.length > 0) {
    for (const pit of world.pits) {
      const dPit = Math.hypot(pit.x - tank.x, pit.y - tank.y);
      const pitR = Math.hypot(pit.l, pit.w) / 2;
      if (dPit > pitR + lookAhead + 4) continue;
      const [flx, fly] = toLocal(pit, fx, fy);
      const [tlx, tly] = toLocal(pit, tank.x, tank.y);
      const marginL = pit.l / 2 + C.TANK_WIDTH_M + 1.5;
      const marginW = pit.w / 2 + C.TANK_WIDTH_M + 1.5;
      if (
        (Math.abs(flx) < marginL && Math.abs(fly) < marginW) ||
        (Math.abs(tlx) < marginL + 2 && Math.abs(tly) < marginW + 2)
      ) {
        hazardScore = Math.max(hazardScore, C.AI_URGENCY_HAZARD_PIT);
        break;
      }
    }
  }

  // Mines: check forward path for active maneuvering requirement
  if (world.mines && world.mines.length > 0) {
    const mineSafetyR = C.TANK_WIDTH_M / 2 + C.MINE_TRIGGER_RADIUS_M + 1.2;
    for (const m of world.mines) {
      const [mlx, mly] = toLocal(tank, m.x, m.y);
      if (mlx > -1.0 && mlx < lookAhead + 4 && Math.abs(mly) < mineSafetyR + 1.2) {
        hazardScore = Math.max(hazardScore, C.AI_URGENCY_HAZARD_MINE);
        break;
      }
    }
  }

  // Obstacles & Boundaries
  if (hazardScore < C.AI_URGENCY_HAZARD_OBSTACLE) {
    if (fy < 8 || fy > C.FIELD_WIDTH_M - 8 || fx < 8 || fx > C.FIELD_LENGTH_M - 8) {
      if (Math.abs(tank.speed) > 1.5) {
        hazardScore = Math.max(hazardScore, C.AI_URGENCY_HAZARD_OBSTACLE);
      }
    }
    if (world.obstacles) {
      for (const ob of world.obstacles) {
        const hit = segmentVsObb(tank.x, tank.y, fx, fy, ob);
        if (hit != null) {
          hazardScore = Math.max(hazardScore, C.AI_URGENCY_HAZARD_OBSTACLE);
          break;
        }
      }
    }
  }

  // Slit gun sector hazard (acute priority: steer away or stop before entering enemy crosshairs)
  const slitLookAhead = Math.max(18.0, Math.abs(tank.speed) * 3.0);
  const sfx = tank.x + Math.cos(tank.heading) * slitLookAhead;
  const sfy = tank.y + Math.sin(tank.heading) * slitLookAhead;
  if (
    isInEnemySlitGunSector(tank.x, tank.y, 1 - owner) ||
    isInEnemySlitGunSector(sfx, sfy, 1 - owner)
  ) {
    hazardScore = Math.max(hazardScore, 92);
  }

  // 2. Combat
  for (const s of world.shells) {
    if (s.owner !== owner) {
      const sDist = Math.hypot(s.x - tank.x, s.y - tank.y);
      if (sDist < C.AI_SMOKE_INCOMING_SHELL_DIST_M) {
        const toMeX = tank.x - s.x;
        const toMeY = tank.y - s.y;
        const dot = (s.dx * toMeX + s.dy * toMeY) / sDist;
        if (dot > C.AI_SMOKE_SHELL_DOT_THRESHOLD) {
          combatScore = Math.max(combatScore, C.AI_URGENCY_COMBAT_SHELL_INCOMING);
          break;
        }
      }
    }
  }

  if (tank.shells > 0 && tank.reload <= 0 && enemyField.length > 0) {
    const maxDist = profile.maxFireDist || C.SHELL_RANGE_M;
    for (const e of enemyField) {
      const smokeBlocked = isLineOfSightBlockedBySmoke(world, tank.x, tank.y, e.x, e.y);
      let targetX = e.x;
      let targetY = e.y;

      if (smokeBlocked) {
        const pred = getPredictedEnemyState(enemyTracker, e, simTime);
        if (!pred || !pred.canBlindFire) continue;
        targetX = pred.predX;
        targetY = pred.predY;
      }

      const dist = Math.hypot(targetX - tank.x, targetY - tank.y);
      if (dist <= maxDist) {
        if (!isLineOfFireBlocked(world, owner, tank.x, tank.y, targetX, targetY, tank.id)) {
          const aimAngle = Math.atan2(targetY - tank.y, targetX - tank.x);
          const aimErr = Math.abs(normalizeAngle(aimAngle - tank.heading));
          if (aimErr <= 0.16) {
            combatScore = Math.max(combatScore, C.AI_URGENCY_COMBAT_AIMED);
          } else {
            combatScore = Math.max(combatScore, C.AI_URGENCY_COMBAT_ENGAGING);
          }
        }
      }
    }
  }

  // 3. Rearm
  if (profile.rearm && tank.shells === 0) {
    rearmScore = C.AI_URGENCY_REARM;
  }

  // 4. Starvation
  const starvationScore = Math.min(C.AI_STARVATION_MAX, timeSinceCommand * C.AI_STARVATION_RATE_PER_S);

  const acuteScore = Math.max(hazardScore, combatScore, rearmScore);
  const urgency = acuteScore + starvationScore * 0.4;

  return { urgency, hazardScore, combatScore, rearmScore, starvationScore };
}

/** Pre-switch safe cruising trim: locks zero turn rate and safe forward vector before deselecting unit. */
export function applySafeCruisingTrim(world, owner, tank, targetSpeedKmh = 18) {
  if (!tank || tank.status !== 'field') return;

  // 1. Straighten turn so unselected tank maintains stable straight heading
  for (let i = 0; i < 6 && tank.cmdTurnDeg > 0; i++) applyAction(world, owner, 'TURN_L');
  for (let i = 0; i < 6 && tank.cmdTurnDeg < 0; i++) applyAction(world, owner, 'TURN_R');

  // 2. Project trajectory forward
  const lookAheadSec = 3.5;
  const speedMs = (Math.max(tank.cmdSpeedKmh, targetSpeedKmh) * 1000) / 3600;
  const lookAheadDist = Math.max(25, speedMs * lookAheadSec);

  const fx = tank.x + Math.cos(tank.heading) * lookAheadDist;
  const fy = tank.y + Math.sin(tank.heading) * lookAheadDist;

  let hazardAhead = false;

  // Boundary checks
  if (fy < 8 || fy > C.FIELD_WIDTH_M - 8) hazardAhead = true;
  if (fx < 6 || fx > C.FIELD_LENGTH_M - 6) hazardAhead = true;

  // Pits
  if (!hazardAhead && world.pits) {
    for (const pit of world.pits) {
      const [flx, fly] = toLocal(pit, fx, fy);
      const [tlx, tly] = toLocal(pit, tank.x, tank.y);
      const marginL = pit.l / 2 + C.TANK_WIDTH_M + 1.5;
      const marginW = pit.w / 2 + C.TANK_WIDTH_M + 1.5;
      if (
        (Math.abs(flx) < marginL && Math.abs(fly) < marginW) ||
        (Math.abs(tlx) < marginL + 2 && Math.abs(tly) < marginW + 2)
      ) {
        hazardAhead = true;
        break;
      }
    }
  }

  // Obstacles
  if (!hazardAhead && world.obstacles) {
    for (const ob of world.obstacles) {
      const hit = segmentVsObb(tank.x, tank.y, fx, fy, ob);
      if (hit != null) {
        hazardAhead = true;
        break;
      }
    }
  }

  // Mines
  if (!hazardAhead && world.mines) {
    const mineSafetyR = C.TANK_WIDTH_M / 2 + C.MINE_TRIGGER_RADIUS_M + 0.8;
    for (const m of world.mines) {
      const [mlx, mly] = toLocal(tank, m.x, m.y);
      if (mlx > -0.5 && mlx < lookAheadDist && Math.abs(mly) < mineSafetyR) {
        hazardAhead = true;
        break;
      }
    }
  }

  // Friendly tanks ahead (prevent unselected cruising ramming into teammates)
  if (!hazardAhead) {
    const friendlies = world.tanks.filter(
      (o) => o.owner === owner && o.id !== tank.id && o.status === 'field',
    );
    for (const f of friendlies) {
      const [flx, fly] = toLocal(tank, f.x, f.y);
      if (flx > 0.5 && flx < lookAheadDist && Math.abs(fly) < C.TANK_WIDTH_M + 1.2) {
        hazardAhead = true;
        break;
      }
    }
  }

  // Enemy slit gun hit sector ahead (never cruise blindly into enemy gate slit gun crosshairs)
  if (!hazardAhead && (isInEnemySlitGunSector(fx, fy, 1 - owner) || isInEnemySlitGunSector(tank.x, tank.y, 1 - owner))) {
    hazardAhead = true;
  }

  if (hazardAhead) {
    applyAction(world, owner, 'STOP');
  } else {
    for (let i = 0; i < 6 && tank.cmdSpeedKmh < targetSpeedKmh; i++) applyAction(world, owner, 'FORWARD');
    for (let i = 0; i < 6 && tank.cmdSpeedKmh > targetSpeedKmh; i++) applyAction(world, owner, 'BACK');
  }
  return hazardAhead;
}