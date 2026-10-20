import * as C from '../constants.js';
import { applyAction, selectedTank, inDeadZone, gateX, inwardDir } from './world.js';
import { segmentVsObb, toLocal } from './geometry.js';

const PROFILES = {
  EASY: {
    tickInterval: 0.35,
    aimTolerance: 0.28,      // ~16 deg
    fireTolerance: 0.32,     // ~18 deg
    leadFactor: 0.0,         // direct aiming, no lead
    maxSpeedKmh: 18,
    useSmoke: 0.2,
    useMines: 0.2,
    multiTank: false,
    rearm: false,
  },
  MEDIUM: {
    tickInterval: 0.18,
    aimTolerance: 0.14,      // ~8 deg
    fireTolerance: 0.18,     // ~10 deg
    leadFactor: 0.5,         // partial lead
    maxSpeedKmh: 30,
    useSmoke: 0.6,
    useMines: 0.6,
    multiTank: true,
    rearm: true,
  },
  HARD: {
    tickInterval: 0.08,
    aimTolerance: 0.06,      // ~3.5 deg
    fireTolerance: 0.08,     // ~4.5 deg
    leadFactor: 1.0,         // full predictive lead
    maxSpeedKmh: 36,
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

export class AiController {
  constructor(owner) {
    this.owner = owner;
    this.timer = 0;
    this.stuckTimer = 0;
    this.reverseTimer = 0;
    this.coordTimer = 0;
  }

  reset() {
    this.timer = 0;
    this.stuckTimer = 0;
    this.reverseTimer = 0;
    this.coordTimer = 0;
  }

  update(world, dt, levelName = 'MEDIUM') {
    if (world.over) return;
    const profile = PROFILES[levelName] || PROFILES.MEDIUM;
    const owner = this.owner;
    const pl = world.players[owner];

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
        const reserve = world.tanks.find((t) => t.owner === owner && t.status === 'hangar' && t.number != null);
        if (reserve) {
          applyAction(world, owner, 'SELECT', reserve.number);
        }
        return;
      }
    }

    // 3. Brigade coordination: check reserve deployments and idle tanks
    if (this.coordTimer >= (profile.multiTank ? 2.0 : 4.0)) {
      this.coordTimer = 0;
      const myField = world.tanks.filter((t) => t.owner === owner && t.status === 'field');
      if (myField.length < C.TANKS_ON_FIELD_MAX) {
        const readyReserve = world.tanks.find((t) => t.owner === owner && t.status === 'hangar' && t.number != null);
        if (readyReserve) {
          applyAction(world, owner, 'SELECT', readyReserve.number);
          return;
        }
      }
      if (profile.multiTank) {
        const idle = myField.find((t) => t.id !== tank.id && t.speed === 0 && t.turn === 0);
        if (idle && idle.number && Math.random() < 0.5) {
          applyAction(world, owner, 'SELECT', idle.number);
          tank = idle;
        }
      }
    }

    if (!tank || tank.status !== 'field') return;

    // 4. Stuck recovery
    if (tank.contacts.length > 0 && Math.abs(tank.speed) < 0.6) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.5) {
        this.reverseTimer = 1.0;
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - dt);
    }

    if (this.reverseTimer > 0) {
      this.reverseTimer -= dt;
      if (tank.cmdSpeedKmh > -C.TANK_MAX_REVERSE_KMH) applyAction(world, owner, 'BACK');
      if (tank.cmdTurnDeg < C.TANK_MAX_TURN_DEG_S) applyAction(world, owner, 'TURN_R');
      return;
    }

    // 5. Decision tick rate throttling
    if (this.timer < profile.tickInterval) return;
    this.timer = 0;

    // 6. Find target
    const enemyField = world.tanks.filter((t) => t.owner !== owner && t.status === 'field');
    let target = null;
    let targetDist = Infinity;

    if (enemyField.length > 0) {
      let bestScore = Infinity;
      for (const e of enemyField) {
        const d = Math.hypot(e.x - tank.x, e.y - tank.y);
        const b = Math.atan2(e.y - tank.y, e.x - tank.x);
        const ang = Math.abs(normalizeAngle(b - tank.heading));
        const score = d + ang * 25;
        if (score < bestScore) {
          bestScore = score;
          target = e;
          targetDist = d;
        }
      }
    } else {
      // No enemy on field: target enemy base gate
      const ex = gateX(1 - owner);
      const ey = C.GATE_CENTER_Y_M;
      target = { x: ex, y: ey, speed: 0, heading: 0 };
      targetDist = Math.hypot(ex - tank.x, ey - tank.y);
    }

    // 7. Tactical retreat to rearm if completely empty
    const outOfAmmo = tank.shells === 0 && tank.mines === 0 && tank.smokes === 0;
    if (profile.rearm && outOfAmmo) {
      const gx = gateX(owner) + inwardDir(owner) * 4;
      const gy = C.GATE_CENTER_Y_M;
      target = { x: gx, y: gy, speed: 0, heading: inwardDir(owner) === 1 ? 0 : Math.PI };
      targetDist = Math.hypot(gx - tank.x, gy - tank.y);
    }

    // 8. Aim calculation (predictive lead)
    const shellSpeed = C.SHELL_RANGE_M / C.SHELL_FLIGHT_TIME_S;
    const tFly = targetDist / shellSpeed;
    const tvx = Math.cos(target.heading) * target.speed;
    const tvy = Math.sin(target.heading) * target.speed;
    let aimX = target.x + tvx * tFly * profile.leadFactor;
    let aimY = target.y + tvy * tFly * profile.leadFactor;

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

    // 9. Steering
    if (angleErr > profile.aimTolerance) {
      if (tank.cmdTurnDeg < C.TANK_MAX_TURN_DEG_S) applyAction(world, owner, 'TURN_R');
    } else if (angleErr < -profile.aimTolerance) {
      if (tank.cmdTurnDeg > -C.TANK_MAX_TURN_DEG_S) applyAction(world, owner, 'TURN_L');
    } else {
      // Straighten out
      if (tank.cmdTurnDeg > 0) applyAction(world, owner, 'TURN_L');
      else if (tank.cmdTurnDeg < 0) applyAction(world, owner, 'TURN_R');
    }

    // 10. Throttle control
    let desiredSpeed = profile.maxSpeedKmh;
    if (emergencyBrake) {
      desiredSpeed = -C.SPEED_STEP_KMH;
    } else if (outOfAmmo && profile.rearm) {
      desiredSpeed = profile.maxSpeedKmh;
    } else if (targetDist > 55) {
      desiredSpeed = profile.maxSpeedKmh;
    } else if (targetDist < 16) {
      desiredSpeed = 0;
      if (targetDist < 10 && Math.abs(angleErr) > 1.0) desiredSpeed = -C.SPEED_STEP_KMH;
    } else {
      desiredSpeed = Math.min(24, profile.maxSpeedKmh);
    }

    if (tank.cmdSpeedKmh < desiredSpeed) {
      applyAction(world, owner, 'FORWARD');
    } else if (tank.cmdSpeedKmh > desiredSpeed) {
      applyAction(world, owner, 'BACK');
    }

    // 11. Weapons firing
    if (tank.shells > 0 && tank.reload <= 0 && enemyField.length > 0) {
      if (targetDist < 115 && Math.abs(angleErr) <= profile.fireTolerance) {
        if (!isLineOfFireBlocked(world, owner, tank.x, tank.y, aimX, aimY, tank.id)) {
          applyAction(world, owner, 'FIRE');
        }
      }
    }

    // 12. Defensive smoke
    if (tank.smokes > 0) {
      let threat = tank.shells <= 1 && targetDist < 35 && Math.random() < profile.useSmoke;
      if (!threat) {
        for (const s of world.shells) {
          if (s.owner !== owner) {
            const sDist = Math.hypot(s.x - tank.x, s.y - tank.y);
            if (sDist < 30) {
              const toMeX = tank.x - s.x;
              const toMeY = tank.y - s.y;
              const dot = (s.dx * toMeX + s.dy * toMeY) / sDist;
              if (dot > 0.8 && Math.random() < profile.useSmoke) {
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
      if (Math.abs(behindAngle) < 0.7 && Math.random() < profile.useMines) {
        applyAction(world, owner, 'MINE');
      }
    }
  }
}
