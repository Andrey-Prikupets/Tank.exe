import * as C from '../constants.js';
import { applyAction, selectedTank, gateX, inwardDir, baseHeading, windowY, isSpawnClear } from './world.js';
import { segmentVsObb, toLocal } from './geometry.js';
import {
  NavigationGrid,
  getAttackStandoffWaypoint,
  getGateCorridorPose,
  evaluateKinematicTrajectoryArcs,
  applyKinematicCommands,
  gateReservationManager,
} from './nav.js';

const PROFILES = {
  EASY: {
    tickInterval: 0.16,      // ~160ms decision tick
    coordInterval: 3.5,      // coordinates brigade tanks every 3.5s
    aimTolerance: 0.12,      // ~7 deg
    fireTolerance: 0.18,     // ~10 deg
    leadFactor: 0.0,         // direct aiming, no lead
    maxSpeedKmh: 18,
    maxFireDist: 30,         // holds fire until within 30m so shots reach and hit reliably
    standoffDist: 22,        // stops advancing at 22m (within 30m firing range)
    minDist: 14,             // reverses if closer than 14m to avoid collision
    useSmoke: 0.2,
    useMines: 0.2,
    multiTank: true,
    rearm: true,             // returns to hangar to reload when shells run out
  },
  MEDIUM: {
    tickInterval: 0.10,      // ~100ms decision tick
    coordInterval: 2.0,      // coordinates brigade tanks every 2.0s
    aimTolerance: 0.08,      // ~4.5 deg
    fireTolerance: 0.14,     // ~8 deg
    leadFactor: 0.5,         // partial lead
    maxSpeedKmh: 36,
    maxFireDist: 40,         // holds fire until within 40m
    standoffDist: 26,        // stops advancing at 26m
    minDist: 16,             // reverses if closer than 16m
    useSmoke: 0.6,
    useMines: 0.6,
    multiTank: true,
    rearm: true,
  },
  HARD: {
    tickInterval: 0.05,      // ~50ms decision tick
    coordInterval: 1.2,      // fast multi-tank coordination
    aimTolerance: 0.05,      // ~3 deg
    fireTolerance: 0.10,     // ~5.7 deg
    leadFactor: 1.0,         // full predictive lead
    maxSpeedKmh: 36,
    maxFireDist: C.SHELL_RANGE_M, // 62.5m maximum physical shell reach
    standoffDist: 30,        // stops advancing at 30m
    minDist: 18,             // reverses if closer than 18m
    useSmoke: 0.9,
    useMines: 0.9,
    multiTank: true,
    rearm: true,
  },
};

function normalizeAngle(a) {
  if (!Number.isFinite(a)) return 0;
  a = a % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Determines if line segment intersects a circle of radius r centered at (cx, cy). */
function segmentIntersectsCircle(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.hypot(x1 - cx, y1 - cy) <= r;
  }
  const t = Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / lenSq));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return Math.hypot(px - cx, py - cy) <= r;
}

/** Determines if line of sight is obstructed by any active smoke cloud. */
function isLineOfSightBlockedBySmoke(world, x1, y1, x2, y2) {
  if (!world.smokes || world.smokes.length === 0) return false;
  const dTotal = Math.hypot(x2 - x1, y2 - y1);

  for (const s of world.smokes) {
    if (s.t >= C.SMOKE_LIFETIME_S) continue;

    const d1 = Math.hypot(x1 - s.x, y1 - s.y);
    const d2 = Math.hypot(x2 - s.x, y2 - s.y);

    // If observer or target is inside the smoke cloud: visibility drops to ~2m
    if (d1 < C.SMOKE_RADIUS_M || d2 < C.SMOKE_RADIUS_M) {
      if (dTotal > C.SMOKE_VISIBLE_DISTANCE_M) return true;
    }

    // Intervening smoke cloud crossing the ray
    if (segmentIntersectsCircle(x1, y1, x2, y2, s.x, s.y, C.SMOKE_RADIUS_M)) {
      if (dTotal > C.SMOKE_VISIBLE_DISTANCE_M) return true;
    }
  }
  return false;
}

/** Predicts enemy position and blind-fire probability from last seen state. */
function getPredictedEnemyState(tracker, e, simTime, levelName = 'MEDIUM') {
  if (!tracker) return null;
  const track = tracker.get(e.id);
  if (!track) return null;

  const timeSinceSeen = simTime - track.lastSeenTime;
  if (timeSinceSeen > C.AI_SMOKE_MAX_TRACK_AGE_S) return null;

  let predX = track.x;
  let predY = track.y;
  let hitProb = 0;

  if (track.isStationary) {
    // Stationary target: position unchanged, high hit probability!
    predX = track.x;
    predY = track.y;
    hitProb = Math.max(
      0.2,
      C.AI_SMOKE_INITIAL_CONFIDENCE_STATIONARY - timeSinceSeen * C.AI_SMOKE_STATIONARY_DECAY_PER_S,
    );
  } else {
    // Moving target: dead-reckoning extrapolation
    predX = track.x + Math.cos(track.heading) * track.speed * timeSinceSeen;
    predY = track.y + Math.sin(track.heading) * track.speed * timeSinceSeen;
    predX = Math.max(4, Math.min(C.FIELD_LENGTH_M - 4, predX));
    predY = Math.max(4, Math.min(C.FIELD_WIDTH_M - 4, predY));

    // Each new second decreases estimate quality and hit probability
    hitProb = Math.max(
      0,
      C.AI_SMOKE_INITIAL_CONFIDENCE_MOVING - timeSinceSeen * C.AI_SMOKE_PREDICT_DECAY_PER_S,
    );
  }

  const minProb =
    levelName === 'HARD'
      ? C.AI_SMOKE_BLIND_FIRE_MIN_PROB_HARD
      : levelName === 'EASY'
        ? C.AI_SMOKE_BLIND_FIRE_MIN_PROB_EASY
        : C.AI_SMOKE_BLIND_FIRE_MIN_PROB_MEDIUM;

  const canBlindFire = hitProb >= minProb;

  return {
    predX,
    predY,
    speed: track.isStationary ? 0 : track.speed,
    heading: track.heading,
    isStationary: track.isStationary,
    timeSinceSeen,
    hitProb,
    canBlindFire,
  };
}

function isLineOfFireBlocked(world, owner, startX, startY, targetX, targetY, myTankId) {
  const dx = targetX - startX;
  const dy = targetY - startY;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return false;
  const nx = dx / dist;
  const ny = dy / dist;

  // 1. Check obstacles (buildings block shells)
  if (world.obstacles) {
    for (const ob of world.obstacles) {
      const hit = segmentVsObb(startX, startY, targetX, targetY, ob);
      if (hit != null && hit > 0.01 && hit < 0.99) {
        return true; // blocked by building!
      }
    }
  }

  // 2. Check friendly tanks
  for (const t of world.tanks) {
    if (t.owner === owner && t.status === 'field' && t.id !== myTankId) {
      const fx = t.x - startX;
      const fy = t.y - startY;
      const proj = fx * nx + fy * ny;
      if (proj > 2.0 && proj < dist - 2.0) {
        const perp = Math.abs(fx * ny - fy * nx);
        if (perp < C.TANK_WIDTH_M / 2 + 1.2) {
          return true; // friendly tank would be hit!
        }
      }
    }
  }
  return false;
}

/** High-frequency firing reflex: handles direct line of sight as well as blind fire through smoke. */
function tryFireWeapon(world, owner, tank, enemyField, profile, enemyTracker, simTime, levelName) {
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
        return true;
      }
    }
  }
  return false;
}

/** Assigns brigade formation roles across friendly field tanks. */
function assignBrigadeRoles(myField, plan) {
  const sorted = [...myField].sort((a, b) => a.id - b.id);
  const roles = new Map();

  if (plan === C.AI_STRATEGY_PLANS.ALPHA) { // PINCER
    sorted.forEach((t, idx) => {
      if (idx === 0) roles.set(t.id, 'VANGUARD');
      else if (idx === 1) roles.set(t.id, 'NORTH_FLANK_LEAD');
      else if (idx === 2) roles.set(t.id, 'NORTH_FLANK_TRAIL');
      else if (idx === 3) roles.set(t.id, 'SOUTH_FLANK_LEAD');
      else roles.set(t.id, 'SOUTH_FLANK_TRAIL');
    });
  } else if (plan === C.AI_STRATEGY_PLANS.BRAVO) { // WEDGE
    sorted.forEach((t, idx) => {
      if (idx === 0) roles.set(t.id, 'SPEARHEAD_N');
      else if (idx === 1) roles.set(t.id, 'SPEARHEAD_S');
      else if (idx === 2) roles.set(t.id, 'ECHELON_N');
      else if (idx === 3) roles.set(t.id, 'ECHELON_S');
      else roles.set(t.id, 'REARGUARD');
    });
  } else if (plan === C.AI_STRATEGY_PLANS.CHARLIE) { // BASE_DEFENSE
    sorted.forEach((t, idx) => {
      if (t.shells === 0) roles.set(t.id, 'RELOADER');
      else if (idx === 0) roles.set(t.id, 'SENTRY');
      else if (idx % 2 === 1) roles.set(t.id, 'DEFENSE_ARC_N');
      else roles.set(t.id, 'DEFENSE_ARC_S');
    });
  } else { // PURSUIT
    sorted.forEach((t) => {
      roles.set(t.id, 'PURSUER');
    });
  }

  return roles;
}

/** Calculates tactical waypoints based on assigned formation role with organic trajectory weaving. */
function getRoleWaypoint(tank, role, plan, owner, enemyGateX, simTime = 0) {
  const midX = (gateX(owner) + enemyGateX) / 2;
  const beforeMid = owner === 0 ? tank.x < midX : tank.x > midX;

  // Organic S-curve lateral weave: amplitude ~3-5m, varies with time and tank ID
  const weavePhase = simTime * C.AI_TRAJECTORY_WEAVE_FREQ + (tank.id % 5) * 1.35;
  const weaveY = Math.sin(weavePhase) * C.AI_TRAJECTORY_WEAVE_AMP_M;

  // Asymmetric lane offset for center vanguard to prevent head-on collisions at Y=50
  const vanguardLaneY = owner === 0 ? C.AI_LANE_CENTER_Y - 5.0 : C.AI_LANE_CENTER_Y + 5.0;

  switch (role) {
    case 'VANGUARD':
      return { x: enemyGateX, y: vanguardLaneY + weaveY };

    case 'NORTH_FLANK_LEAD':
      return {
        x: beforeMid ? midX : enemyGateX,
        y: (beforeMid ? C.AI_LANE_NORTH_Y : C.AI_LANE_NORTH_Y + 4) + weaveY * 0.7,
      };

    case 'NORTH_FLANK_TRAIL':
      return {
        x: beforeMid ? (gateX(owner) + midX) / 2 : enemyGateX,
        y: C.AI_LANE_NORTH_Y + 2 + weaveY * 0.7,
      };

    case 'SOUTH_FLANK_LEAD':
      return {
        x: beforeMid ? midX : enemyGateX,
        y: (beforeMid ? C.AI_LANE_SOUTH_Y : C.AI_LANE_SOUTH_Y - 4) + weaveY * 0.7,
      };

    case 'SOUTH_FLANK_TRAIL':
      return {
        x: beforeMid ? (gateX(owner) + midX) / 2 : enemyGateX,
        y: C.AI_LANE_SOUTH_Y - 2 + weaveY * 0.7,
      };

    case 'SPEARHEAD_N':
      return { x: enemyGateX, y: C.AI_LANE_CENTER_Y - C.AI_WEDGE_SPACING_Y + weaveY * 0.6 };

    case 'SPEARHEAD_S':
      return { x: enemyGateX, y: C.AI_LANE_CENTER_Y + C.AI_WEDGE_SPACING_Y + weaveY * 0.6 };

    case 'ECHELON_N':
      return { x: enemyGateX, y: C.AI_LANE_CENTER_Y - C.AI_WEDGE_SPACING_Y * 2 + weaveY * 0.6 };

    case 'ECHELON_S':
      return { x: enemyGateX, y: C.AI_LANE_CENTER_Y + C.AI_WEDGE_SPACING_Y * 2 + weaveY * 0.6 };

    case 'REARGUARD':
      return { x: (gateX(owner) + midX) / 2, y: C.AI_LANE_CENTER_Y + weaveY * 0.5 };

    case 'SENTRY':
      return { x: gateX(owner) + inwardDir(owner) * 14, y: C.GATE_CENTER_Y_M };

    case 'DEFENSE_ARC_N':
      return {
        x: gateX(owner) + inwardDir(owner) * C.AI_BASE_DEFENSE_ARC_RADIUS_M,
        y: C.GATE_CENTER_Y_M - 15 + weaveY * 0.4,
      };

    case 'DEFENSE_ARC_S':
      return {
        x: gateX(owner) + inwardDir(owner) * C.AI_BASE_DEFENSE_ARC_RADIUS_M,
        y: C.GATE_CENTER_Y_M + 15 + weaveY * 0.4,
      };

    case 'RELOADER':
      return { x: gateX(owner) + inwardDir(owner) * C.AI_REARM_STANDOFF_DIST_M, y: C.GATE_CENTER_Y_M };

    case 'PURSUER':
    default:
      return { x: enemyGateX, y: C.GATE_CENTER_Y_M + weaveY };
  }
}

/** Evaluates Urgency Score (U_i) for a brigade unit. */
function evaluateTankUrgency(world, owner, tank, enemyField, profile, timeSinceCommand, enemyTracker, simTime) {
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
function applySafeCruisingTrim(world, owner, tank, targetSpeedKmh = 18) {
  if (!tank || tank.status !== 'field') return;

  // 1. Straighten turn so unselected tank maintains stable straight heading
  for (let i = 0; i < 6 && tank.cmdTurnDeg > 0; i++) applyAction(world, owner, 'TURN_L');
  for (let i = 0; i < 6 && tank.cmdTurnDeg < 0; i++) applyAction(world, owner, 'TURN_R');

  // 2. Project 3.0s trajectory forward
  const lookAheadSec = C.AI_COURSE_PROJECT_TIME_S;
  const speedMs = (Math.max(tank.cmdSpeedKmh, targetSpeedKmh) * 1000) / 3600;
  const lookAheadDist = Math.max(10, speedMs * lookAheadSec);

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

  if (hazardAhead) {
    applyAction(world, owner, 'STOP');
  } else {
    for (let i = 0; i < 6 && tank.cmdSpeedKmh < targetSpeedKmh; i++) applyAction(world, owner, 'FORWARD');
    for (let i = 0; i < 6 && tank.cmdSpeedKmh > targetSpeedKmh; i++) applyAction(world, owner, 'BACK');
  }
}

export class AiController {
  constructor(owner) {
    this.owner = owner;
    this.currentPlan = C.AI_STRATEGY_PLANS.ALPHA;
    this.simTime = 0;
    this.sliceTimer = 0;
    this.commanderTimer = Math.random() * 0.4;
    this.reserveDeployTimer = 0;
    this.decisionTimer = Math.random() * 0.05;
    this.nextTickInterval = 0.1;
    this.stuckTimer = 0;
    this.reverseTimer = 0;
    this.lockedTargetId = null;
    this.windowTurn = 0;
    this.slitTimer = 0;
    this.standoffJitter = 0;
    this.speedJitter = 0;
    this.laneOffset = 0;
    this.deadTankIds = new Set();
    this.casualtyTimestamps = [];
    this.lastCommandedTime = new Map();
    this.tankRoles = new Map();
    this.enemyTracker = new Map();
    this.navGrid = new NavigationGrid();
    this.navGridTimer = 0;
    this.randomizeOffsets();
  }

  randomizeOffsets() {
    this.standoffJitter = (Math.random() - 0.5) * 2 * C.AI_STANDOFF_JITTER_M;
    this.speedJitter = (Math.random() - 0.5) * 2 * C.AI_SPEED_JITTER_KMH;
    this.laneOffset = (Math.random() - 0.5) * 2 * C.AI_LANE_OFFSET_MAX_M;
  }

  reset() {
    this.currentPlan = C.AI_STRATEGY_PLANS.ALPHA;
    this.simTime = 0;
    this.sliceTimer = 0;
    this.commanderTimer = Math.random() * 0.4;
    this.reserveDeployTimer = 0;
    this.decisionTimer = Math.random() * 0.05;
    this.nextTickInterval = 0.1;
    this.stuckTimer = 0;
    this.reverseTimer = 0;
    this.lockedTargetId = null;
    this.windowTurn = 0;
    this.slitTimer = 0;
    this.deadTankIds.clear();
    this.casualtyTimestamps.length = 0;
    this.lastCommandedTime.clear();
    this.tankRoles.clear();
    this.enemyTracker.clear();
    this.navGrid = new NavigationGrid();
    this.navGridTimer = 0;
    gateReservationManager.releaseGate(this.owner, this.owner);
    this.randomizeOffsets();
  }

  /** Updates visual intelligence memory of enemy units, recording last known states when visible. */
  updateEnemyTracking(world, myTank, enemyField) {
    if (!myTank) return;
    const activeEnemyIds = new Set(enemyField.map((e) => e.id));

    // Remove dead enemies or enemies not on field
    for (const id of this.enemyTracker.keys()) {
      if (!activeEnemyIds.has(id)) {
        this.enemyTracker.delete(id);
      }
    }

    for (const e of enemyField) {
      const smokeBlocked = isLineOfSightBlockedBySmoke(world, myTank.x, myTank.y, e.x, e.y);
      const obsBlocked = isLineOfFireBlocked(
        world,
        this.owner,
        myTank.x,
        myTank.y,
        e.x,
        e.y,
        myTank.id,
      );

      if (!smokeBlocked && !obsBlocked) {
        this.enemyTracker.set(e.id, {
          lastSeenTime: this.simTime,
          x: e.x,
          y: e.y,
          speed: e.speed,
          heading: e.heading,
          isStationary: Math.abs(e.speed) < 0.35,
        });
      }
    }
  }

  /** Tactical slit window defense: locks onto enemy targets in field of view, aims, and fires unlimited shells. */
  updateSlit(world, dt, profile) {
    const owner = this.owner;
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
        const pred = getPredictedEnemyState(this.enemyTracker, e, this.simTime, profile);
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
      const isLocked = e.id === this.lockedTargetId;
      const score =
        dist + yawDiff * 25 - (isLocked ? C.AI_TARGET_STICKINESS_BONUS : 0) + smokeScorePenalty;
      if (score < bestScore) {
        bestScore = score;
        bestEnemy = e;
        bestEnemyPos = { x: targetX, y: targetY };
      }
    }

    if (bestEnemy && bestEnemyPos) {
      this.lockedTargetId = bestEnemy.id;
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
        this.windowTurn = 0;
      } else if (yawErr > 0) {
        this.windowTurn = Math.abs(yawErr) > 0.25 ? 1 : 0.4;
      } else {
        this.windowTurn = Math.abs(yawErr) > 0.25 ? -1 : -0.4;
      }

      if (Math.abs(yawErr) <= C.AI_SLIT_FIRE_TOLERANCE_RAD && pl.windowReload <= 0) {
        applyAction(world, owner, 'FIRE');
      }
    } else {
      this.windowTurn = 0;
      this.lockedTargetId = null;
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
        applyAction(world, owner, otherIdx === 0 ? 'WIN_R' : 'WIN_L');
        return;
      }

      this.slitTimer += dt;
      if (this.slitTimer > 2.5) {
        const fieldTank = world.tanks.find((t) => t.owner === owner && t.status === 'field');
        if (fieldTank && fieldTank.number) {
          this.slitTimer = 0;
          applyAction(world, owner, 'SELECT', fieldTank.number);
        }
      }
    }
  }

  /** Tier 1: Brigade Commander Strategic State Machine. */
  updateCommander(world, dt, myField, enemyField, profile) {
    const owner = this.owner;
    this.commanderTimer += dt;

    // Track casualties
    for (const t of world.tanks) {
      if (t.owner === owner && t.status === 'dead' && !this.deadTankIds.has(t.id)) {
        this.deadTankIds.add(t.id);
        this.casualtyTimestamps.push(this.simTime);
      }
    }
    this.casualtyTimestamps = this.casualtyTimestamps.filter(
      (ts) => this.simTime - ts <= C.AI_CASUALTY_WINDOW_S,
    );

    const enemyGateX = gateX(1 - owner);

    // Initial and dynamic brigade role assignment if unassigned
    if (!this.tankRoles || this.tankRoles.size === 0) {
      this.tankRoles = assignBrigadeRoles(myField, this.currentPlan);
    }

    // Mobilize whole brigade at once: ensure all friendly field tanks immediately advance into formation
    for (const t of myField) {
      if (t.status === 'field' && t.cmdSpeedKmh === 0 && Math.abs(t.speed) < 0.2) {
        const role = this.tankRoles.get(t.id) || 'VANGUARD';
        const roleWaypoint = getRoleWaypoint(
          t,
          role,
          this.currentPlan,
          owner,
          enemyGateX,
          this.simTime,
        );
        const wpAngle = Math.atan2(roleWaypoint.y - t.y, roleWaypoint.x - t.x);
        t.heading = wpAngle;
        const cruiseSpeed =
          this.currentPlan === C.AI_STRATEGY_PLANS.DELTA ||
          role.startsWith('SPEARHEAD') ||
          (profile.maxSpeedKmh > 18 && role === 'VANGUARD')
            ? profile.maxSpeedKmh
            : Math.min(C.AI_MOBILIZE_CRUISE_KMH, profile.maxSpeedKmh);
        t.cmdSpeedKmh = cruiseSpeed;
        t.speed = C.kmhToMs(C.SPEED_STEP_KMH); // immediate forward roll
        this.lastCommandedTime.set(t.id, this.simTime - (t.id % 5) * 0.18);
      }
    }

    if (this.commanderTimer < C.AI_COMMANDER_EVAL_INTERVAL_S) return;
    this.commanderTimer = 0;

    const myGateX = gateX(owner);
    const closestEnemyDist = enemyField.reduce((min, e) => {
      const d = Math.abs(e.x - myGateX);
      return d < min ? d : min;
    }, Infinity);

    const enemyAvgAmmo =
      enemyField.length > 0 ? enemyField.reduce((s, e) => s + e.shells, 0) / enemyField.length : 0;
    const recentCasualties = this.casualtyTimestamps.length;

    // Dynamic Plan Transitions
    if (closestEnemyDist <= C.AI_PLAN_DEFENSE_TRIGGER_DIST_M) {
      this.currentPlan = C.AI_STRATEGY_PLANS.CHARLIE; // Base Defense
    } else if (
      this.currentPlan === C.AI_STRATEGY_PLANS.CHARLIE &&
      closestEnemyDist >= C.AI_PLAN_DEFENSE_CLEAR_DIST_M
    ) {
      this.currentPlan = C.AI_STRATEGY_PLANS.ALPHA; // Disengage Defense
    } else if (recentCasualties >= C.AI_CASUALTY_RETREAT_COUNT) {
      this.currentPlan = C.AI_STRATEGY_PLANS.ALPHA; // Regroup with Standoff
    } else if (
      enemyField.length > 0 &&
      (enemyAvgAmmo <= C.AI_PURSUIT_AMMO_THRESHOLD ||
        (enemyField.length <= 1 && myField.length >= 3))
    ) {
      this.currentPlan = C.AI_STRATEGY_PLANS.DELTA; // Pursuit
    } else if (this.currentPlan === C.AI_STRATEGY_PLANS.ALPHA && myField.length >= 4) {
      // Periodic Wedge breach assault when forces are consolidated
      if (Math.sin(this.simTime * 0.12) > 0.75) {
        this.currentPlan = C.AI_STRATEGY_PLANS.BRAVO;
      }
    }

    this.tankRoles = assignBrigadeRoles(myField, this.currentPlan);
  }

  update(world, dt, levelName = 'MEDIUM') {
    if (world.over) return;
    const profile = PROFILES[levelName] || PROFILES.MEDIUM;
    const owner = this.owner;
    const pl = world.players[owner];

    this.simTime += dt;
    this.sliceTimer += dt;
    this.reserveDeployTimer += dt;
    this.navGridTimer += dt;
    this.windowTurn = 0;

    if (this.navGridTimer >= 0.8 || this.simTime <= dt) {
      this.navGrid.update(world);
      this.navGridTimer = 0;
    }

    // 1. Slit window view
    if (pl.view === 'window') {
      this.updateSlit(world, dt, profile);
      return;
    }

    if (pl.view !== 'tank') {
      applyAction(world, owner, 'SELECT', C.TANK_NUMBERS[owner][0]);
    }

    const myField = world.tanks.filter((t) => t.owner === owner && t.status === 'field');
    const enemyField = world.tanks.filter((t) => t.owner !== owner && t.status === 'field');

    // 2. Commander update
    this.updateCommander(world, dt, myField, enemyField, profile);

    let tank = selectedTank(world, owner);

    // 3. Update Visual Intelligence & Memory
    if (tank && tank.status === 'field') {
      this.updateEnemyTracking(world, tank, enemyField);
    }

    // 4. Hangar tank handling
    if (tank && tank.status === 'hangar') {
      if (pl.blocked) {
        const alt = myField.find((t) => t.number);
        if (alt) {
          applyAction(world, owner, 'SELECT', alt.number);
          tank = alt;
        }
      } else {
        applyAction(world, owner, 'FORWARD');
      }
      return;
    }

    // 5. Dead or missing selection
    if (!tank || tank.status === 'dead') {
      const reserves = world.tanks.filter(
        (t) => t.owner === owner && t.status === 'hangar' && t.number != null,
      );
      const armedReserve = reserves.find((t) => t.shells > 0);
      const allFieldEmpty = myField.length > 0 && myField.every((t) => t.shells === 0);

      // Prioritize immediately deploying recharged/armed tanks from hangar
      if (
        armedReserve &&
        myField.length < C.TANKS_ON_FIELD_MAX &&
        (myField.length === 0 || allFieldEmpty || (myField.length < 3 && isSpawnClear(world, owner)))
      ) {
        applyAction(world, owner, 'SELECT', armedReserve.number);
        applyAction(world, owner, 'FORWARD');
        this.sliceTimer = 0;
        this.reserveDeployTimer = 0;
        this.lastCommandedTime.set(armedReserve.id, this.simTime);
        return;
      }

      if (myField.length > 0) {
        let best = myField[0];
        let maxU = -Infinity;
        for (const t of myField) {
          const timeSince = this.simTime - (this.lastCommandedTime.get(t.id) || 0);
          const u = evaluateTankUrgency(
            world,
            owner,
            t,
            enemyField,
            profile,
            timeSince,
            this.enemyTracker,
            this.simTime,
          ).urgency;
          if (u > maxU) {
            maxU = u;
            best = t;
          }
        }
        applyAction(world, owner, 'SELECT', best.number);
        tank = best;
        this.sliceTimer = 0;
        this.lastCommandedTime.set(best.id, this.simTime);
      } else if (reserves.length > 0) {
        const reserve = armedReserve || reserves[Math.floor(Math.random() * reserves.length)];
        applyAction(world, owner, 'SELECT', reserve.number);
        applyAction(world, owner, 'FORWARD');
        this.sliceTimer = 0;
        this.reserveDeployTimer = 0;
        this.lastCommandedTime.set(reserve.id, this.simTime);
        return;
      }
    }

    // 6. Tier 2: Urgency-Weighted Time-Slice Dispatcher
    const canSwitch = this.sliceTimer >= C.AI_MIN_SLICE_S;
    const forceSwitch = this.sliceTimer >= C.AI_MAX_SLICE_S;

    let bestTank = null;
    let maxUrgency = -Infinity;
    let bestUrgencyInfo = null;

    for (const t of myField) {
      const timeSince = this.simTime - (this.lastCommandedTime.get(t.id) || 0);
      const info = evaluateTankUrgency(
        world,
        owner,
        t,
        enemyField,
        profile,
        timeSince,
        this.enemyTracker,
        this.simTime,
      );
      if (info.urgency > maxUrgency) {
        maxUrgency = info.urgency;
        bestTank = t;
        bestUrgencyInfo = info;
      }
    }

    const currTimeSince = this.simTime - (this.lastCommandedTime.get(tank.id) || 0);
    const currUrgencyInfo = evaluateTankUrgency(
      world,
      owner,
      tank,
      enemyField,
      profile,
      currTimeSince,
      this.enemyTracker,
      this.simTime,
    );
    const currUrgency = currUrgencyInfo.urgency;

    const acuteHazardEmergency =
      bestUrgencyInfo &&
      bestUrgencyInfo.hazardScore >= C.AI_URGENCY_HAZARD_MINE &&
      currUrgencyInfo.hazardScore < C.AI_URGENCY_HAZARD_MINE;

    let shouldSwitch = false;
    if (bestTank && bestTank.id !== tank.id) {
      if (acuteHazardEmergency) {
        shouldSwitch = true;
      } else if (forceSwitch && maxUrgency > currUrgency) {
        shouldSwitch = true;
      } else if (canSwitch && maxUrgency - currUrgency >= C.AI_DISPATCH_THRESHOLD_DELTA) {
        shouldSwitch = true;
      }
    }

    // Reserve deployment check: proactively deploy recharged armed tanks from hangar
    if (
      myField.length < C.TANKS_ON_FIELD_MAX &&
      this.reserveDeployTimer >= 2.0 &&
      canSwitch
    ) {
      const reserves = world.tanks.filter(
        (t) => t.owner === owner && t.status === 'hangar' && t.number != null,
      );
      const armedReserve = reserves.find((t) => t.shells > 0);
      const reserveToDeploy = armedReserve || reserves[0];

      if (reserveToDeploy) {
        let deployUrgency = C.AI_URGENCY_DEPLOY_RESERVE;
        const allFieldEmpty = myField.every((t) => t.shells === 0);

        if (myField.length === 0) {
          deployUrgency = 100;
        } else if (armedReserve && allFieldEmpty) {
          deployUrgency = C.AI_URGENCY_DEPLOY_ARMED_RESERVE;
        } else if (armedReserve && myField.length < 3) {
          deployUrgency = 75;
        } else if (armedReserve && myField.length < C.TANKS_ON_FIELD_MAX) {
          deployUrgency = 60;
        }

        const spawnClear = isSpawnClear(world, owner);

        if (spawnClear && (deployUrgency > currUrgency || !bestTank)) {
          // Safe Cruising Course Projection for active tank before switching to deploy
          const activeRole = this.tankRoles.get(tank.id);
          const cruisingSpeed =
            this.currentPlan === C.AI_STRATEGY_PLANS.DELTA || activeRole?.startsWith('SPEARHEAD')
              ? C.TANK_MAX_SPEED_KMH
              : Math.min(18, profile.maxSpeedKmh);
          applySafeCruisingTrim(world, owner, tank, cruisingSpeed);

          this.reserveDeployTimer = 0;
          this.sliceTimer = 0;
          applyAction(world, owner, 'SELECT', reserveToDeploy.number);
          applyAction(world, owner, 'FORWARD');
          this.lastCommandedTime.set(reserveToDeploy.id, this.simTime);
          return;
        }
      }
    }

    // Dispatcher switch execution
    if (shouldSwitch && bestTank) {
      const activeRole = this.tankRoles.get(tank.id);
      const cruisingSpeed =
        this.currentPlan === C.AI_STRATEGY_PLANS.DELTA || activeRole?.startsWith('SPEARHEAD')
          ? C.TANK_MAX_SPEED_KMH
          : Math.min(18, profile.maxSpeedKmh);

      // Safe Cruising Course Projection
      applySafeCruisingTrim(world, owner, tank, cruisingSpeed);

      // Switch selection
      applyAction(world, owner, 'SELECT', bestTank.number);
      tank = bestTank;
      this.sliceTimer = 0;
      this.lastCommandedTime.set(bestTank.id, this.simTime);
    }

    if (!tank || tank.status !== 'field') return;
    this.lastCommandedTime.set(tank.id, this.simTime);

    // 7. Real-time weapons reflex: handles direct LOS and blind fire through smoke
    tryFireWeapon(
      world,
      owner,
      tank,
      enemyField,
      profile,
      this.enemyTracker,
      this.simTime,
      levelName,
    );

    // Tactical slit defense: if an enemy has penetrated close to gate and our tank is distant
    if (enemyField.length > 0 && profile.rearm) {
      const closestEnemyDist = enemyField.reduce((min, e) => {
        const dg = Math.abs(e.x - gateX(owner));
        return dg < min ? dg : min;
      }, Infinity);
      if (
        closestEnemyDist < C.AI_SLIT_DEFENSE_TRIGGER_DIST_M &&
        Math.abs(tank.x - gateX(owner)) > 60
      ) {
        if (Math.random() < 0.18) {
          const threat = enemyField.find(
            (e) => Math.abs(e.x - gateX(owner)) < C.AI_SLIT_DEFENSE_TRIGGER_DIST_M,
          );
          const slitAction = threat && threat.y < C.GATE_CENTER_Y_M ? 'WIN_L' : 'WIN_R';
          applyAction(world, owner, slitAction);
          return;
        }
      }
    }

    // 8. Stuck recovery
    if (tank.contacts.length > 0 && Math.abs(tank.speed) < 0.6) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.4) {
        this.reverseTimer = 1.0;
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - dt);
    }

    if (this.reverseTimer > 0) {
      const mineBehind =
        world.mines &&
        world.mines.some((m) => {
          const [mlx, mly] = toLocal(tank, m.x, m.y);
          return (
            mlx < 0.5 &&
            mlx > -8.0 &&
            Math.abs(mly) < C.TANK_WIDTH_M / 2 + C.MINE_TRIGGER_RADIUS_M + 0.8
          );
        });
      if (mineBehind) {
        this.reverseTimer = 0;
      } else {
        this.reverseTimer -= dt;
        if (tank.cmdSpeedKmh > -C.TANK_MAX_REVERSE_KMH) applyAction(world, owner, 'BACK');
        if (tank.cmdTurnDeg < C.TANK_MAX_TURN_DEG_S) applyAction(world, owner, 'TURN_R');
        return;
      }
    }

    // 9. Tactical decision tick rate throttling with desynchronized jitter
    this.decisionTimer += dt;
    const tickLimit = this.nextTickInterval || profile.tickInterval;
    if (this.decisionTimer < tickLimit) return;
    this.decisionTimer = 0;
    this.nextTickInterval =
      profile.tickInterval *
      (1 - C.AI_TICK_JITTER_FRACTION + Math.random() * 2 * C.AI_TICK_JITTER_FRACTION);

    // 10. Target selection (LOS check with smoke obscuration, threat weighting, lock hysteresis)
    let combatTarget = null;
    let combatTargetDist = Infinity;
    let combatTargetPos = null;

    if (enemyField.length > 0) {
      let bestScore = Infinity;
      for (const e of enemyField) {
        const smokeBlocked = isLineOfSightBlockedBySmoke(world, tank.x, tank.y, e.x, e.y);

        let targetX = e.x;
        let targetY = e.y;
        let smokePenalty = 0;

        if (smokeBlocked) {
          const pred = getPredictedEnemyState(this.enemyTracker, e, this.simTime, levelName);
          if (!pred || !pred.canBlindFire) {
            // Cannot see through smoke cloud and prediction is too uncertain
            continue;
          }
          targetX = pred.predX;
          targetY = pred.predY;
          smokePenalty = (1 - pred.hitProb) * 35;
        }

        const d = Math.hypot(targetX - tank.x, targetY - tank.y);
        const b = Math.atan2(targetY - tank.y, targetX - tank.x);
        const ang = Math.abs(normalizeAngle(b - tank.heading));
        const blocked = isLineOfFireBlocked(world, owner, tank.x, tank.y, targetX, targetY, tank.id);
        const toUs = Math.atan2(tank.y - targetY, tank.x - targetX);
        const facingUs =
          Math.abs(normalizeAngle(toUs - e.heading)) < 0.35 && d < profile.maxFireDist;
        const isLocked = e.id === this.lockedTargetId;
        const noise = (Math.random() - 0.5) * C.AI_TARGET_NOISE_AMPLITUDE;

        const score =
          d +
          ang * C.AI_TARGET_THREAT_ANGLE_WEIGHT +
          (blocked ? C.AI_TARGET_LOS_BLOCKED_PENALTY : 0) +
          smokePenalty -
          (facingUs ? C.AI_TARGET_FACING_US_BONUS : 0) -
          (isLocked ? C.AI_TARGET_STICKINESS_BONUS : 0) +
          noise;

        if (score < bestScore) {
          bestScore = score;
          combatTarget = e;
          combatTargetDist = d;
          combatTargetPos = { x: targetX, y: targetY };
        }
      }

      if (combatTarget && combatTargetPos) {
        this.lockedTargetId = combatTarget.id;
        world.players[owner].lockedTarget = {
          id: combatTarget.id,
          x: combatTargetPos.x,
          y: combatTargetPos.y,
          isWindow: false,
          windowIdx: 0,
        };
      }
    } else {
      this.lockedTargetId = null;
      world.players[owner].lockedTarget = null;
    }

    // 11. Navigation waypoint calculation
    const enemyGateX = gateX(1 - owner);
    const assignedRole = this.tankRoles.get(tank.id) || 'VANGUARD';
    const roleWaypoint = getRoleWaypoint(
      tank,
      assignedRole,
      this.currentPlan,
      owner,
      enemyGateX,
      this.simTime,
    );

    const outOfShells = tank.shells === 0;
    let navTargetX = roleWaypoint.x;
    let navTargetY = roleWaypoint.y;
    let isDoorwayMode = false;
    let maxSpeedOverride = profile.maxSpeedKmh;

    if (profile.rearm && outOfShells) {
      this.lockedTargetId = null;
      world.players[owner].lockedTarget = null;

      const gatePose = getGateCorridorPose(tank, owner, this.simTime);
      navTargetX = gatePose.targetX;
      navTargetY = gatePose.targetY;
      isDoorwayMode = gatePose.isDoorwayMode;
      if (gatePose.speedLimitKmh) {
        maxSpeedOverride = Math.min(maxSpeedOverride, gatePose.speedLimitKmh);
      }
    } else {
      gateReservationManager.releaseGate(owner, tank.id);
      if (
        combatTarget &&
        combatTargetPos &&
        (combatTargetDist <= profile.maxFireDist + 8 ||
          this.currentPlan === C.AI_STRATEGY_PLANS.DELTA)
      ) {
        // High-level tactical attack standoff waypoint outside enemy front gun arc
        const attackWp = getAttackStandoffWaypoint(tank, combatTarget, world, profile, this.simTime);
        navTargetX = attackWp.x;
        navTargetY = attackWp.y;
      } else {
        navTargetY += this.laneOffset * 0.5;
      }
    }

    if (!isDoorwayMode) {
      navTargetX = Math.max(4, Math.min(C.FIELD_LENGTH_M - 4, navTargetX));
      navTargetY = Math.max(4, Math.min(C.FIELD_WIDTH_M - 4, navTargetY));
    }

    const targetDist = Math.hypot(navTargetX - tank.x, navTargetY - tank.y);
    const desiredHeading = Math.atan2(navTargetY - tank.y, navTargetX - tank.x);

    // 12. Kinematic Dynamic Window Trajectory Rollout & Obstacle Avoidance
    const traj = evaluateKinematicTrajectoryArcs(
      tank,
      world,
      this.navGrid,
      { x: navTargetX, y: navTargetY },
      profile,
      { isDoorwayMode, maxSpeedOverride, simTime: this.simTime },
    );

    // 13. Apply kinematic commands
    applyKinematicCommands(world, owner, tank, traj.bestSpeedKmh, traj.bestTurnDeg);

    // 14. Defensive smoke
    if (tank.smokes > 0) {
      let threat =
        tank.shells <= 1 &&
        targetDist < C.AI_SMOKE_LOW_AMMO_DIST_M &&
        Math.random() < profile.useSmoke;
      if (!threat) {
        for (const s of world.shells) {
          if (s.owner !== owner) {
            const sDist = Math.hypot(s.x - tank.x, s.y - tank.y);
            if (sDist < C.AI_SMOKE_INCOMING_SHELL_DIST_M) {
              const toMeX = tank.x - s.x;
              const toMeY = tank.y - s.y;
              const dot = (s.dx * toMeX + s.dy * toMeY) / sDist;
              if (dot > C.AI_SMOKE_SHELL_DOT_THRESHOLD && Math.random() < profile.useSmoke) {
                threat = true;
                break;
              }
            }
          }
        }
      }
      if (threat) applyAction(world, owner, 'SMOKE');
    }

    // 15. Defensive mines
    if (tank.mines > 0 && (combatTargetDist < 25 || assignedRole.includes('DEFENSE'))) {
      const behindAngle = normalizeAngle(desiredHeading - (tank.heading + Math.PI));
      if (Math.abs(behindAngle) < C.AI_MINE_BEHIND_ANGLE_RAD && Math.random() < profile.useMines) {
        applyAction(world, owner, 'MINE');
      }
    }
  }
}
