import * as C from '../constants.js';
import { applyAction, selectedTank, gateX, inwardDir, baseHeading, windowY } from './world.js';
import { segmentVsObb, toLocal } from './geometry.js';

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
    maxFireDist: 50,         // fires up to 50m with predictive lead
    standoffDist: 30,        // stops advancing at 30m
    minDist: 18,             // reverses if closer than 18m
    useSmoke: 0.9,
    useMines: 0.9,
    multiTank: true,
    rearm: true,
  },
};

function normalizeAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
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

/** High-frequency firing reflex: pulls the trigger whenever gun crosshair aligns with an enemy in reach. */
function tryFireWeapon(world, owner, tank, enemyField, profile) {
  if (tank.shells <= 0 || tank.reload > 0 || enemyField.length === 0) return false;

  const maxDist = Math.min(profile.maxFireDist || 30, C.SHELL_RANGE_M - 4.0);

  for (const e of enemyField) {
    const dx = e.x - tank.x;
    const dy = e.y - tank.y;
    const dist = Math.hypot(dx, dy);
    // Must be within profile max firing distance and safe reach
    if (dist > maxDist) continue;

    const shellSpeed = C.SHELL_RANGE_M / C.SHELL_FLIGHT_TIME_S;
    const tFly = dist / shellSpeed;
    const aimX = e.x + Math.cos(e.heading) * e.speed * tFly * profile.leadFactor;
    const aimY = e.y + Math.sin(e.heading) * e.speed * tFly * profile.leadFactor;

    const aimAngle = Math.atan2(aimY - tank.y, aimX - tank.x);
    const aimErr = Math.abs(normalizeAngle(aimAngle - tank.heading));

    // Target hull angle tolerance: must actually point at tank body plus tolerance with organic jitter
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

export class AiController {
  constructor(owner) {
    this.owner = owner;
    this.timer = Math.random() * 0.05;
    this.coordTimer = Math.random() * 0.5;
    this.nextTickInterval = 0.1;
    this.nextCoordInterval = 2.0;
    this.stuckTimer = 0;
    this.reverseTimer = 0;
    this.lockedTargetId = null;
    this.windowTurn = 0;
    this.slitTimer = 0;
    this.standoffJitter = 0;
    this.speedJitter = 0;
    this.laneOffset = 0;
    this.randomizeOffsets();
  }

  randomizeOffsets() {
    this.standoffJitter = (Math.random() - 0.5) * 2 * C.AI_STANDOFF_JITTER_M;
    this.speedJitter = (Math.random() - 0.5) * 2 * C.AI_SPEED_JITTER_KMH;
    this.laneOffset = (Math.random() - 0.5) * 2 * C.AI_LANE_OFFSET_MAX_M;
  }

  reset() {
    this.timer = Math.random() * 0.05;
    this.coordTimer = Math.random() * 0.5;
    this.nextTickInterval = 0.1;
    this.nextCoordInterval = 2.0;
    this.stuckTimer = 0;
    this.reverseTimer = 0;
    this.lockedTargetId = null;
    this.windowTurn = 0;
    this.slitTimer = 0;
    this.randomizeOffsets();
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
    let bestScore = Infinity;

    for (const e of enemyField) {
      const dx = e.x - wx;
      const dy = e.y - wy;
      const dist = Math.hypot(dx, dy);
      if (dist > C.AI_SLIT_MAX_FIRE_DIST_M) continue;

      const angle = Math.atan2(dy, dx);
      const relYaw = normalizeAngle(angle - baseHead);
      if (Math.abs(relYaw) > maxYaw + 0.15) continue;

      if (isLineOfFireBlocked(world, owner, wx, wy, e.x, e.y, null)) continue;

      const yawDiff = Math.abs(normalizeAngle(angle - currentHead));
      const isLocked = e.id === this.lockedTargetId;
      const score = dist + yawDiff * 25 - (isLocked ? C.AI_TARGET_STICKINESS_BONUS : 0);
      if (score < bestScore) {
        bestScore = score;
        bestEnemy = e;
      }
    }

    if (bestEnemy) {
      this.lockedTargetId = bestEnemy.id;
      world.players[owner].lockedTarget = {
        id: bestEnemy.id,
        x: bestEnemy.x,
        y: bestEnemy.y,
        isWindow: true,
        windowIdx: pl.windowIdx,
      };

      const targetAngle = Math.atan2(bestEnemy.y - wy, bestEnemy.x - wx);
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

      // Check if other slit window has a target
      const otherIdx = pl.windowIdx === 0 ? 1 : 0;
      const otherWy = windowY(owner, otherIdx);
      const canSeeInOther = enemyField.some((e) => {
        const dx = e.x - wx;
        const dy = e.y - otherWy;
        const dist = Math.hypot(dx, dy);
        if (dist > C.AI_SLIT_MAX_FIRE_DIST_M) return false;
        const relYaw = normalizeAngle(Math.atan2(dy, dx) - baseHead);
        return Math.abs(relYaw) <= maxYaw && !isLineOfFireBlocked(world, owner, wx, otherWy, e.x, e.y, null);
      });

      if (canSeeInOther) {
        applyAction(world, owner, otherIdx === 0 ? 'WIN_R' : 'WIN_L');
        return;
      }

      // Exit slit if field tanks are available and no enemies threaten the base
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

  update(world, dt, levelName = 'MEDIUM') {
    if (world.over) return;
    const profile = PROFILES[levelName] || PROFILES.MEDIUM;
    const owner = this.owner;
    const pl = world.players[owner];

    this.windowTurn = 0;

    // Handle slit window state if player is in window view
    if (pl.view === 'window') {
      this.updateSlit(world, dt, profile);
      return;
    }

    // Ensure player is in tank view
    if (pl.view !== 'tank') {
      applyAction(world, owner, 'SELECT', C.TANK_NUMBERS[owner][0]);
    }

    this.timer += dt;
    this.coordTimer += dt;

    let tank = selectedTank(world, owner);

    // 1. If currently selected tank is in hangar and gate is blocked, switch to another field tank
    if (tank && tank.status === 'hangar') {
      if (pl.blocked) {
        const alt = world.tanks.find((t) => t.owner === owner && t.status === 'field');
        if (alt && alt.number) {
          applyAction(world, owner, 'SELECT', alt.number);
          tank = alt;
        }
      } else {
        applyAction(world, owner, 'FORWARD');
      }
      return; // Waiting for hangar doors to open & spawn
    }

    // 2. If no selected tank or selected tank is dead, pick a field tank or deploy reserve
    if (!tank || tank.status === 'dead') {
      const fieldTank = world.tanks.find((t) => t.owner === owner && t.status === 'field');
      if (fieldTank && fieldTank.number) {
        applyAction(world, owner, 'SELECT', fieldTank.number);
        tank = fieldTank;
      } else {
        const reserves = world.tanks.filter((t) => t.owner === owner && t.status === 'hangar' && t.number != null);
        if (reserves.length > 0) {
          const reserve = reserves[Math.floor(Math.random() * reserves.length)];
          applyAction(world, owner, 'SELECT', reserve.number);
          applyAction(world, owner, 'FORWARD');
        }
        return;
      }
    }

    // 3. Brigade coordination: check reserve deployments and cycle active tanks with desynchronized timing
    const coordLimit = this.nextCoordInterval || profile.coordInterval;
    if (this.coordTimer >= coordLimit) {
      this.coordTimer = 0;
      this.nextCoordInterval = profile.coordInterval * (1 - C.AI_COORD_JITTER_FRACTION + Math.random() * 2 * C.AI_COORD_JITTER_FRACTION);
      this.randomizeOffsets();

      const myField = world.tanks.filter((t) => t.owner === owner && t.status === 'field');
      if (myField.length < C.TANKS_ON_FIELD_MAX) {
        const reserves = world.tanks.filter((t) => t.owner === owner && t.status === 'hangar' && t.number != null);
        if (reserves.length > 0) {
          const pickIdx = Math.floor(Math.random() * reserves.length);
          const readyReserve = reserves[pickIdx];
          applyAction(world, owner, 'SELECT', readyReserve.number);
          applyAction(world, owner, 'FORWARD');
          return;
        }
      }
      if (profile.multiTank && myField.length > 1) {
        let nextTank = null;
        if (tank.shells === 0) {
          nextTank = myField.find((t) => t.id !== tank.id && t.shells > 0);
        }
        if (!nextTank) {
          const currentIdx = myField.findIndex((t) => t.id === tank.id);
          if (Math.random() < 0.25) {
            const others = myField.filter((t) => t.id !== tank.id);
            nextTank = others[Math.floor(Math.random() * others.length)];
          } else {
            nextTank = myField[(currentIdx + 1) % myField.length];
          }
        }
        if (nextTank && nextTank.id !== tank.id) {
          applyAction(world, owner, 'SELECT', nextTank.number);
          tank = nextTank;
        }
      }
    }

    if (!tank || tank.status !== 'field') return;

    // 4. Real-time weapons reflex: fire as soon as crosshairs align with enemy in reach
    const enemyField = world.tanks.filter((t) => t.owner !== owner && t.status === 'field');
    tryFireWeapon(world, owner, tank, enemyField, profile);

    // Tactical slit defense: if an enemy has penetrated close to gate and our tank is distant
    if (enemyField.length > 0 && profile.rearm) {
      const closestEnemyDist = enemyField.reduce((min, e) => {
        const dg = Math.abs(e.x - gateX(owner));
        return dg < min ? dg : min;
      }, Infinity);
      if (closestEnemyDist < C.AI_SLIT_DEFENSE_TRIGGER_DIST_M && Math.abs(tank.x - gateX(owner)) > 60) {
        if (Math.random() < 0.18) {
          const threat = enemyField.find((e) => Math.abs(e.x - gateX(owner)) < C.AI_SLIT_DEFENSE_TRIGGER_DIST_M);
          const slitAction = (threat && threat.y < C.GATE_CENTER_Y_M) ? 'WIN_L' : 'WIN_R';
          applyAction(world, owner, slitAction);
          return;
        }
      }
    }

    // 5. Stuck recovery
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
      // Check if a mine is directly behind the tank before reversing
      const mineBehind = world.mines && world.mines.some((m) => {
        const [mlx, mly] = toLocal(tank, m.x, m.y);
        return mlx < 0.5 && mlx > -8.0 && Math.abs(mly) < C.TANK_WIDTH_M / 2 + C.MINE_TRIGGER_RADIUS_M + 0.8;
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

    // 6. Tactical decision tick rate throttling with desynchronized jitter
    const tickLimit = this.nextTickInterval || profile.tickInterval;
    if (this.timer < tickLimit) return;
    this.timer = 0;
    this.nextTickInterval = profile.tickInterval * (1 - C.AI_TICK_JITTER_FRACTION + Math.random() * 2 * C.AI_TICK_JITTER_FRACTION);

    // 7. Find target (robust scoring with LOS obstacle check, lock hysteresis, and tie-breaking noise)
    let target = null;
    let targetDist = Infinity;

    if (enemyField.length > 0) {
      let bestScore = Infinity;
      for (const e of enemyField) {
        const d = Math.hypot(e.x - tank.x, e.y - tank.y);
        const b = Math.atan2(e.y - tank.y, e.x - tank.x);
        const ang = Math.abs(normalizeAngle(b - tank.heading));
        const blocked = isLineOfFireBlocked(world, owner, tank.x, tank.y, e.x, e.y, tank.id);
        const toUs = Math.atan2(tank.y - e.y, tank.x - e.x);
        const facingUs = Math.abs(normalizeAngle(toUs - e.heading)) < 0.35 && d < profile.maxFireDist;
        const isLocked = (e.id === this.lockedTargetId);
        const noise = (Math.random() - 0.5) * C.AI_TARGET_NOISE_AMPLITUDE;

        const score = d + ang * C.AI_TARGET_THREAT_ANGLE_WEIGHT +
          (blocked ? C.AI_TARGET_LOS_BLOCKED_PENALTY : 0) -
          (facingUs ? C.AI_TARGET_FACING_US_BONUS : 0) -
          (isLocked ? C.AI_TARGET_STICKINESS_BONUS : 0) + noise;

        if (score < bestScore) {
          bestScore = score;
          target = e;
          targetDist = d;
        }
      }

      if (target) {
        this.lockedTargetId = target.id;
        world.players[owner].lockedTarget = {
          id: target.id,
          x: target.x,
          y: target.y,
          isWindow: false,
          windowIdx: 0,
        };
      }
    } else {
      this.lockedTargetId = null;
      world.players[owner].lockedTarget = null;
      // No enemy on field: target enemy base gate
      const ex = gateX(1 - owner);
      const ey = C.GATE_CENTER_Y_M;
      target = { x: ex, y: ey, speed: 0, heading: 0 };
      targetDist = Math.hypot(ex - tank.x, ey - tank.y);
    }

    // 8. Tactical retreat to rearm if out of shells
    const outOfShells = tank.shells === 0;
    if (profile.rearm && outOfShells) {
      this.lockedTargetId = null;
      world.players[owner].lockedTarget = null;
      const gx = gateX(owner) + inwardDir(owner) * 4;
      const gy = C.GATE_CENTER_Y_M;
      target = { x: gx, y: gy, speed: 0, heading: inwardDir(owner) === 1 ? 0 : Math.PI };
      targetDist = Math.hypot(gx - tank.x, gy - tank.y);
    }

    // 9. Aim calculation (predictive lead with tactical lane offset)
    const shellSpeed = C.SHELL_RANGE_M / C.SHELL_FLIGHT_TIME_S;
    const tFly = targetDist / shellSpeed;
    const tvx = Math.cos(target.heading) * target.speed;
    const tvy = Math.sin(target.heading) * target.speed;
    const effectiveLead = profile.leadFactor * (0.9 + Math.random() * 0.2);
    let aimX = target.x + tvx * tFly * effectiveLead;
    let aimY = target.y + tvy * tFly * effectiveLead;

    // Apply tactical lane spreading when maneuvering at distance to prevent single-lane conga lines
    if (targetDist > profile.standoffDist) {
      aimY += this.laneOffset;
    }

    aimX = Math.max(4, Math.min(C.FIELD_LENGTH_M - 4, aimX));
    aimY = Math.max(4, Math.min(C.FIELD_WIDTH_M - 4, aimY));

    let desiredHeading = Math.atan2(aimY - tank.y, aimX - tank.x);

    // Arena boundary steering avoidance
    if (tank.y < 12 && Math.sin(tank.heading) < -0.3) {
      desiredHeading = Math.atan2(25 - tank.y, Math.cos(tank.heading));
    } else if (tank.y > C.FIELD_WIDTH_M - 12 && Math.sin(tank.heading) > 0.3) {
      desiredHeading = Math.atan2((C.FIELD_WIDTH_M - 25) - tank.y, Math.cos(tank.heading));
    }

    // Terrain hazard avoidance (Pits and Obstacles)
    const lookAhead = Math.max(12, Math.abs(tank.speed) * 1.8);
    const fx = tank.x + Math.cos(tank.heading) * lookAhead;
    const fy = tank.y + Math.sin(tank.heading) * lookAhead;
    let emergencyBrake = false;
    let avoidanceAngle = 0;

    // Check water pits (lethal danger)
    if (world.pits && world.pits.length > 0) {
      for (const pit of world.pits) {
        const dPit = Math.hypot(pit.x - tank.x, pit.y - tank.y);
        const pitR = Math.hypot(pit.l, pit.w) / 2;
        if (dPit > pitR + lookAhead + 4) continue;

        const [flx, fly] = toLocal(pit, fx, fy);
        const [tlx, tly] = toLocal(pit, tank.x, tank.y);
        const marginL = pit.l / 2 + C.TANK_WIDTH_M + 1.5;
        const marginW = pit.w / 2 + C.TANK_WIDTH_M + 1.5;

        const headingToPit = Math.abs(flx) < marginL && Math.abs(fly) < marginW;
        const closeToPit = Math.abs(tlx) < marginL + 3 && Math.abs(tly) < marginW + 3;

        if (headingToPit || closeToPit) {
          const awayAngle = Math.atan2(tank.y - pit.y, tank.x - pit.x);
          const diff = normalizeAngle(awayAngle - tank.heading);
          avoidanceAngle = diff > 0 ? 1.0 : -1.0;
          if (dPit < pitR + 6 && Math.abs(diff) > Math.PI / 2) {
            emergencyBrake = true;
          }
          break;
        }
      }
    }

    // Check mines (lethal danger to any tank)
    if (!avoidanceAngle && world.mines && world.mines.length > 0) {
      const mineSafetyR = C.TANK_WIDTH_M / 2 + C.MINE_TRIGGER_RADIUS_M + 1.2;
      let closestMine = null;
      let closestDist = Infinity;

      for (const m of world.mines) {
        const dMine = Math.hypot(m.x - tank.x, m.y - tank.y);
        if (dMine > lookAhead + 6) continue;

        const [mlx, mly] = toLocal(tank, m.x, m.y);
        const toMineAngle = Math.atan2(m.y - tank.y, m.x - tank.x);
        const relDesired = normalizeAngle(toMineAngle - desiredHeading);
        const fwdDesired = dMine * Math.cos(relDesired);
        const latDesired = Math.abs(dMine * Math.sin(relDesired));

        const inCurrentPath = mlx > -1.0 && mlx < lookAhead + 2 && Math.abs(mly) < mineSafetyR;
        const inDesiredPath = fwdDesired > 0 && fwdDesired < lookAhead + 2 && latDesired < mineSafetyR;

        if (inCurrentPath || inDesiredPath) {
          if (dMine < closestDist) {
            closestDist = dMine;
            closestMine = { m, dMine, mlx, mly, toMineAngle };
          }
        }
      }

      if (closestMine) {
        const rClear = mineSafetyR + 0.5;
        const dClear = Math.max(rClear + 0.1, closestMine.dMine);
        const alpha = Math.asin(Math.min(1.0, rClear / dClear)) + 0.2;
        const steerLeft = normalizeAngle(closestMine.toMineAngle + alpha);
        const steerRight = normalizeAngle(closestMine.toMineAngle - alpha);

        // Check which candidate heading is safer (stays within field boundaries)
        const leftOutOfBounds = (Math.sin(steerLeft) < 0 && tank.y < 12) || (Math.sin(steerLeft) > 0 && tank.y > C.FIELD_WIDTH_M - 12);
        const rightOutOfBounds = (Math.sin(steerRight) < 0 && tank.y < 12) || (Math.sin(steerRight) > 0 && tank.y > C.FIELD_WIDTH_M - 12);

        let bestSteer = steerLeft;
        if (leftOutOfBounds && !rightOutOfBounds) {
          bestSteer = steerRight;
        } else if (!leftOutOfBounds && rightOutOfBounds) {
          bestSteer = steerLeft;
        } else {
          if (closestMine.mly > 0.1) bestSteer = steerRight;
          else if (closestMine.mly < -0.1) bestSteer = steerLeft;
          else {
            const diffL = Math.abs(normalizeAngle(steerLeft - desiredHeading));
            const diffR = Math.abs(normalizeAngle(steerRight - desiredHeading));
            bestSteer = diffL <= diffR ? steerLeft : steerRight;
          }
        }

        avoidanceAngle = normalizeAngle(bestSteer - tank.heading);

        // Emergency braking if mine is dangerously close in the forward path
        if (closestMine.dMine < 8.5 || (closestMine.mlx > -0.5 && closestMine.mlx < 6.5 && Math.abs(closestMine.mly) < mineSafetyR)) {
          emergencyBrake = true;
        }
      }
    }

    // Check obstacles (buildings)
    if (!avoidanceAngle && world.obstacles && world.obstacles.length > 0) {
      for (const ob of world.obstacles) {
        const dOb = Math.hypot(ob.x - tank.x, ob.y - tank.y);
        const obR = Math.hypot(ob.l, ob.w) / 2;
        if (dOb > obR + lookAhead + 2) continue;

        const hit = segmentVsObb(tank.x, tank.y, fx, fy, ob);
        if (hit != null) {
          const [, tly] = toLocal(ob, tank.x, tank.y);
          avoidanceAngle = tly > 0 ? 0.8 : -0.8;
          break;
        }
      }
    }

    if (avoidanceAngle !== 0) {
      desiredHeading = normalizeAngle(tank.heading + avoidanceAngle);
    }

    const angleErr = normalizeAngle(desiredHeading - tank.heading);

    // 10. Steering with smooth dampening (prevents overshooting oscillation)
    const maxTurnLimit = tank.cmdSpeedKmh === 0 ? C.TANK_MAX_PIVOT_TURN_DEG_S : C.TANK_MAX_TURN_DEG_S;
    if (Math.abs(angleErr) <= profile.aimTolerance) {
      // Locked onto target: zero out turn command immediately to hold heading
      while (tank.cmdTurnDeg > 0) applyAction(world, owner, 'TURN_L');
      while (tank.cmdTurnDeg < 0) applyAction(world, owner, 'TURN_R');
    } else {
      const turnLimit = Math.abs(angleErr) < 0.5 ? Math.min(30, maxTurnLimit) : maxTurnLimit;
      if (angleErr > 0) {
        if (tank.cmdTurnDeg < turnLimit) applyAction(world, owner, 'TURN_R');
        else if (tank.cmdTurnDeg > turnLimit) applyAction(world, owner, 'TURN_L');
      } else {
        if (tank.cmdTurnDeg > -turnLimit) applyAction(world, owner, 'TURN_L');
        else if (tank.cmdTurnDeg < -turnLimit) applyAction(world, owner, 'TURN_R');
      }
    }

    // 11. Throttle control and combat standoff distance (prevents ramming opponent tanks)
    const effectiveStandoff = Math.max(C.TANK_LENGTH_M + 4, profile.standoffDist + this.standoffJitter);
    const effectiveMinDist = Math.max(C.TANK_LENGTH_M + 2, profile.minDist + this.standoffJitter * 0.5);
    const effectiveMaxSpeed = profile.maxSpeedKmh;

    let desiredSpeed = effectiveMaxSpeed;
    if (emergencyBrake) {
      desiredSpeed = -C.TANK_MAX_REVERSE_KMH;
    } else if (outOfShells && profile.rearm) {
      desiredSpeed = effectiveMaxSpeed;
    } else if (targetDist > effectiveStandoff + 10) {
      desiredSpeed = effectiveMaxSpeed;
    } else if (targetDist > effectiveStandoff) {
      desiredSpeed = Math.min(18, effectiveMaxSpeed);
    } else if (targetDist >= effectiveMinDist) {
      // Prime combat standoff zone: stop advancing to maintain position and fire
      desiredSpeed = 0;
    } else {
      // Too close to opponent: reverse to back off and avoid collision!
      desiredSpeed = -C.TANK_MAX_REVERSE_KMH;
    }

    // Avoid reversing if a mine is behind the tank
    if (desiredSpeed < 0 && world.mines && world.mines.length > 0) {
      const mineSafetyR = C.TANK_WIDTH_M / 2 + C.MINE_TRIGGER_RADIUS_M + 0.8;
      const mineBehind = world.mines.some((m) => {
        const [mlx, mly] = toLocal(tank, m.x, m.y);
        return mlx < 0.5 && mlx > -8.0 && Math.abs(mly) < mineSafetyR;
      });
      if (mineBehind) {
        desiredSpeed = 0;
      }
    }

    if (desiredSpeed === 0 && tank.cmdSpeedKmh > 0) {
      // Active braking to stop promptly without coasting into collision
      applyAction(world, owner, 'BACK');
    } else if (tank.cmdSpeedKmh < desiredSpeed) {
      applyAction(world, owner, 'FORWARD');
    } else if (tank.cmdSpeedKmh > desiredSpeed) {
      applyAction(world, owner, 'BACK');
    }

    // 12. Defensive smoke
    if (tank.smokes > 0) {
      let threat = tank.shells <= 1 && targetDist < C.AI_SMOKE_LOW_AMMO_DIST_M && Math.random() < profile.useSmoke;
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

    // 13. Defensive mines
    if (tank.mines > 0 && targetDist < 25) {
      const behindAngle = normalizeAngle(desiredHeading - (tank.heading + Math.PI));
      if (Math.abs(behindAngle) < C.AI_MINE_BEHIND_ANGLE_RAD && Math.random() < profile.useMines) {
        applyAction(world, owner, 'MINE');
      }
    }
  }
}
