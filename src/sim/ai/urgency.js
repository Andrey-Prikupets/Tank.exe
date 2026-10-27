import * as C from '../../constants.js';
import { applyAction, gateX } from '../world.js';
import { segmentVsObb, toLocal } from '../geometry.js';
import { isInEnemySlitGunSector } from '../nav.js';
import { isLineOfSightBlockedBySmoke, getPredictedEnemyState, isLineOfFireBlocked } from './perception.js';
import { leadPoint, aimError, maxEngageDist } from './aiming.js';

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
    const inOwnGateLane = Math.abs(fy - C.GATE_CENTER_Y_M) <= C.GATE_WIDTH_M / 2 + 1.0;
    const xOob = owner === 0
      ? (fx < 8 ? (!inOwnGateLane || fx < -C.AI_REARM_PENETRATION_DEPTH_M) : fx > C.FIELD_LENGTH_M - 8)
      : (fx > C.FIELD_LENGTH_M - 8 ? (!inOwnGateLane || fx > C.FIELD_LENGTH_M + C.AI_REARM_PENETRATION_DEPTH_M) : fx < 8);
    if (fy < 8 || fy > C.FIELD_WIDTH_M - 8 || xOob) {
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

  // Shot allocation: only one gun fires at a time, so give it to the tank that can deliver a
  // shot soonest (remaining reload vs. time to pivot the fixed gun onto the lead point).
  if (tank.shells > 0 && enemyField.length > 0) {
    const enemyGate = gateX(1 - owner);
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

      const lead = leadPoint(tank, targetX, targetY, e.speed, e.heading, profile.leadFactor);
      if (lead.dist > maxEngageDist(profile, e.speed)) continue;
      if (isLineOfFireBlocked(world, owner, tank.x, tank.y, lead.x, lead.y, tank.id)) continue;

      const errDeg = C.radToDeg(Math.abs(aimError(tank, lead.x, lead.y)));
      const turnS = errDeg / C.TANK_MAX_PIVOT_TURN_DEG_S;
      const timeToShot = Math.max(tank.reload, turnS);
      let score =
        C.AI_URGENCY_COMBAT_AIMED -
        Math.min(C.AI_URGENCY_SHOT_PENALTY_MAX, timeToShot * C.AI_URGENCY_SHOT_PENALTY_PER_S);
      const emerging =
        Math.abs(e.x - enemyGate) <= C.AI_GATE_EMERGE_X_M && Math.abs(e.y - C.GATE_CENTER_Y_M) <= C.AI_GATE_EMERGE_Y_M;
      if (emerging) score += C.AI_URGENCY_GATE_TARGET_BONUS;
      combatScore = Math.max(combatScore, score);
    }
    // Armed combatant engagement/advance baseline when enemies are on the field
    if (combatScore === 0) {
      let minEnemyDist = Infinity;
      for (const e of enemyField) {
        const d = Math.hypot(e.x - tank.x, e.y - tank.y);
        if (d < minEnemyDist) minEnemyDist = d;
      }
      combatScore = Math.max(45, C.AI_URGENCY_COMBAT_ENGAGING - (minEnemyDist / C.FIELD_LENGTH_M) * 20);
    }
  }

  // 3. Rearm
  if (profile.rearm && tank.shells === 0) {
    rearmScore = C.AI_URGENCY_REARM;
  }

  // 4. Starvation
  const starvationScore = Math.min(C.AI_STARVATION_MAX, timeSinceCommand * C.AI_STARVATION_RATE_PER_S);

  const acuteScore = Math.max(hazardScore, combatScore, rearmScore);
  const urgency = acuteScore + starvationScore * 0.8;

  return { urgency, hazardScore, combatScore, rearmScore, starvationScore };
}

/** Pre-switch safe cruising trim: locks zero turn rate and safe forward vector before deselecting unit. */
export function applySafeCruisingTrim(world, owner, tank, targetSpeedKmh = 18) {
  if (!tank || tank.status !== 'field') return;

  // 1. Straighten turn so unselected tank maintains stable straight heading
  for (let i = 0; i < 6 && tank.cmdTurnDeg > 0; i++) applyAction(world, owner, 'TURN_L');
  for (let i = 0; i < 6 && tank.cmdTurnDeg < 0; i++) applyAction(world, owner, 'TURN_R');

  // 2. Project trajectory forward and look for hazards along the heading
  const lookAheadSec = 3.5;
  const speedMs = (Math.max(tank.cmdSpeedKmh, targetSpeedKmh) * 1000) / 3600;
  const lookAheadDist = Math.max(25, speedMs * lookAheadSec);

  const hazardAlong = (heading) => {
    const probe = { x: tank.x, y: tank.y, heading };
    const fx = tank.x + Math.cos(heading) * lookAheadDist;
    const fy = tank.y + Math.sin(heading) * lookAheadDist;

    // Boundary checks (allow passage through own gate doorway)
    const inOwnGateLane = Math.abs(fy - C.GATE_CENTER_Y_M) <= C.GATE_WIDTH_M / 2 + 1.0;
    if (fy < 8 || fy > C.FIELD_WIDTH_M - 8) return true;
    if (owner === 0) {
      if (fx < 6 && (!inOwnGateLane || fx < -C.AI_REARM_PENETRATION_DEPTH_M)) return true;
      if (fx > C.FIELD_LENGTH_M - 6) return true;
    } else {
      if (fx < 6) return true;
      if (fx > C.FIELD_LENGTH_M - 6 && (!inOwnGateLane || fx > C.FIELD_LENGTH_M + C.AI_REARM_PENETRATION_DEPTH_M)) return true;
    }

    // Pits
    if (world.pits) {
      for (const pit of world.pits) {
        const [flx, fly] = toLocal(pit, fx, fy);
        const [tlx, tly] = toLocal(pit, tank.x, tank.y);
        const marginL = pit.l / 2 + C.TANK_WIDTH_M + 1.5;
        const marginW = pit.w / 2 + C.TANK_WIDTH_M + 1.5;
        if (
          (Math.abs(flx) < marginL && Math.abs(fly) < marginW) ||
          (Math.abs(tlx) < marginL + 2 && Math.abs(tly) < marginW + 2)
        ) {
          return true;
        }
      }
    }

    // Obstacles
    if (world.obstacles) {
      for (const ob of world.obstacles) {
        if (segmentVsObb(tank.x, tank.y, fx, fy, ob) != null) return true;
      }
    }

    // Mines
    if (world.mines) {
      const mineSafetyR = C.TANK_WIDTH_M / 2 + C.MINE_TRIGGER_RADIUS_M + 0.8;
      for (const m of world.mines) {
        const [mlx, mly] = toLocal(probe, m.x, m.y);
        if (mlx > -0.5 && mlx < lookAheadDist && Math.abs(mly) < mineSafetyR) return true;
      }
    }

    // Friendly tanks ahead (prevent unselected cruising ramming into teammates)
    for (const f of world.tanks) {
      if (f.owner !== owner || f.id === tank.id || f.status !== 'field') continue;
      const [flx, fly] = toLocal(probe, f.x, f.y);
      if (flx > 0.5 && flx < lookAheadDist && Math.abs(fly) < C.TANK_WIDTH_M + 1.2) return true;
    }

    // Enemy slit gun hit sector ahead (never cruise blindly into enemy gate slit gun crosshairs)
    return isInEnemySlitGunSector(fx, fy, 1 - owner) || isInEnemySlitGunSector(tank.x, tank.y, 1 - owner);
  };

  let hazardAhead = hazardAlong(tank.heading);

  if (hazardAhead) {
    // Instead of freezing in the open (a stationary tank is an easy target), creep away along the
    // first clear heading offset to either side; the hand-off cannot steer afterwards, so use the
    // gentlest turn step and a low speed. Stop only when no side is clear.
    let turnDir = 0;
    for (const off of C.AI_TRIM_ESCAPE_OFFSETS_RAD) {
      if (!hazardAlong(tank.heading + off)) turnDir = 1;
      else if (!hazardAlong(tank.heading - off)) turnDir = -1;
      if (turnDir !== 0) break;
    }
    if (turnDir === 0) {
      applyAction(world, owner, 'STOP');
    } else {
      applyAction(world, owner, turnDir > 0 ? 'TURN_R' : 'TURN_L');
      for (let i = 0; i < 6 && tank.cmdSpeedKmh > C.AI_TRIM_ESCAPE_SPEED_KMH; i++) applyAction(world, owner, 'BACK');
      for (let i = 0; i < 6 && tank.cmdSpeedKmh < C.AI_TRIM_ESCAPE_SPEED_KMH; i++) applyAction(world, owner, 'FORWARD');
      hazardAhead = 'veer';
    }
  } else {
    for (let i = 0; i < 6 && tank.cmdSpeedKmh < targetSpeedKmh; i++) applyAction(world, owner, 'FORWARD');
    for (let i = 0; i < 6 && tank.cmdSpeedKmh > targetSpeedKmh; i++) applyAction(world, owner, 'BACK');
  }
  return hazardAhead;
}
