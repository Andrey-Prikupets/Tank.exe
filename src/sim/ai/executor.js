import * as C from '../../constants.js';
import { applyAction, gateX } from '../world.js';
import { toLocal } from '../geometry.js';
import { getAttackStandoffWaypoint, getGateCorridorPose, getGateAmbushPose, isInEnemySlitGunSector, evaluateKinematicTrajectoryArcs, applyKinematicCommands, gateReservationManager } from '../nav.js';
import { normalizeAngle } from './math.js';
import { isLineOfSightBlockedBySmoke, getPredictedEnemyState, isLineOfFireBlocked } from './perception.js';
import { tryFireWeapon } from './weapons.js';
import { getRoleWaypoint } from './roles.js';
import { findAimSolution } from './aiming.js';

export function executeTactics(ctl, world, dt, tank, enemyField, profile, levelName) {
  const owner = ctl.owner;

  // 7. Real-time weapons reflex: handles direct LOS and blind fire through smoke
  const firedAt = tryFireWeapon(
    world,
    owner,
    tank,
    enemyField,
    profile,
    ctl.enemyTracker,
    ctl.simTime,
    levelName,
  );
  if (firedAt) {
    const fd = Math.hypot(firedAt.x - tank.x, firedAt.y - tank.y);
    ctl.note('FIRE', `T${tank.number} fires at enemy #${firedAt.id} (${fd.toFixed(0)} m)`, {
      key: `fire${tank.id}`,
      sig: 'f',
      gap: 1.5,
    });
  }

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
        ctl.note(
          'SLIT',
          `Enemy ${closestEnemyDist.toFixed(0)} m from gate, field tanks far - manning slit window`,
          { key: 'slit-enter', gap: 3 },
        );
        applyAction(world, owner, slitAction);
        return;
      }
    }
  }

  // 8. Stuck recovery
  if (tank.contacts.length > 0 && Math.abs(tank.speed) < 0.6) {
    ctl.stuckTimer += dt;
    if (ctl.stuckTimer > 0.4) {
      ctl.reverseTimer = 1.0;
      ctl.stuckTimer = 0;
      ctl.note('AVOID', `T${tank.number} stuck on contact - reversing`, { key: `stuck${tank.id}`, gap: 2 });
    }
  } else {
    ctl.stuckTimer = Math.max(0, ctl.stuckTimer - dt);
  }

  if (ctl.reverseTimer > 0) {
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
      ctl.reverseTimer = 0;
    } else {
      ctl.reverseTimer -= dt;
      if (tank.cmdSpeedKmh > -C.TANK_MAX_REVERSE_KMH) applyAction(world, owner, 'BACK');
      if (tank.cmdTurnDeg < C.TANK_MAX_TURN_DEG_S) applyAction(world, owner, 'TURN_R');
      return;
    }
  }

  // 9. Tactical decision tick rate throttling with desynchronized jitter
  ctl.decisionTimer += dt;
  const tickLimit = ctl.nextTickInterval || profile.tickInterval;
  if (ctl.decisionTimer < tickLimit) return;
  ctl.decisionTimer = 0;
  ctl.nextTickInterval =
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
        const pred = getPredictedEnemyState(ctl.enemyTracker, e, ctl.simTime, levelName);
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
      const isLocked = e.id === ctl.lockedTargetId;
      const noise = (Math.random() - 0.5) * C.AI_TARGET_NOISE_AMPLITUDE;

      // Highest priority for enemy tanks emerging through the gate entrance!
      const enemyGate = gateX(1 - owner);
      const isEmergingFromGate =
        Math.abs(e.x - enemyGate) <= 9.0 && Math.abs(e.y - C.GATE_CENTER_Y_M) <= 5.0;
      const emergingBonus = isEmergingFromGate ? 70.0 : 0;

      const score =
        d +
        ang * C.AI_TARGET_THREAT_ANGLE_WEIGHT +
        (blocked ? C.AI_TARGET_LOS_BLOCKED_PENALTY : 0) +
        smokePenalty -
        emergingBonus -
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
      if (combatTargetDist <= C.AI_LOG_TARGET_MAX_DIST_M) {
        ctl.note(
          ctl.currentPlan === C.AI_STRATEGY_PLANS.DELTA ? 'PURSUE' : 'ATTACK',
          `T${tank.number} locks enemy #${combatTarget.id} at ${combatTargetDist.toFixed(0)} m`,
          { key: `lock${tank.id}`, sig: combatTarget.id, gap: 1.5 },
        );
      }
      ctl.lockedTargetId = combatTarget.id;
      world.players[owner].lockedTarget = {
        id: combatTarget.id,
        x: combatTargetPos.x,
        y: combatTargetPos.y,
        isWindow: false,
        windowIdx: 0,
      };
    }
  } else {
    ctl.lockedTargetId = null;
    world.players[owner].lockedTarget = null;
  }

  // 11. Navigation waypoint calculation
  const enemyGateX = gateX(1 - owner);
  const distToEnemyGate = Math.abs(tank.x - enemyGateX);
  const assignedRole = ctl.tankRoles.get(tank.id) || 'VANGUARD';
  const roleWaypoint = getRoleWaypoint(
    tank,
    assignedRole,
    ctl.currentPlan,
    owner,
    enemyGateX,
    ctl.simTime,
  );

  const outOfShells = tank.shells === 0;
  let navTargetX = roleWaypoint.x;
  let navTargetY = roleWaypoint.y;
  let isDoorwayMode = false;
  let maxSpeedOverride = profile.maxSpeedKmh;

  const isAmbushRole =
    assignedRole === 'NORTH_GATE_AMBUSH' || assignedRole === 'SOUTH_GATE_AMBUSH';
  const ambushPose = isAmbushRole
    ? getGateAmbushPose(tank, owner, assignedRole === 'NORTH_GATE_AMBUSH' ? 'NORTH' : 'SOUTH')
    : null;

  if (profile.rearm && outOfShells) {
    ctl.note('REARM', `T${tank.number} out of shells - returning to hangar`, {
      key: `rearm${tank.id}`,
      gap: 20,
    });
    ctl.lockedTargetId = null;
    world.players[owner].lockedTarget = null;

    const gatePose = getGateCorridorPose(tank, owner, ctl.simTime);
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
        ctl.currentPlan === C.AI_STRATEGY_PLANS.DELTA)
    ) {
      // High-level tactical attack standoff waypoint outside enemy front gun arc
      const attackWp = getAttackStandoffWaypoint(tank, combatTarget, world, profile, ctl.simTime);
      navTargetX = attackWp.x;
      navTargetY = attackWp.y;
    } else if (isAmbushRole && ambushPose && ambushPose.isAtAmbush) {
      ctl.note('AMBUSH', `T${tank.number} holds gate ambush post`, { key: `amb${tank.id}`, gap: 30 });
      // Hold position in ambush post, pre-aim gun directly across gate doorway threshold
      navTargetX = ambushPose.doorwayAimX;
      navTargetY = ambushPose.doorwayAimY;
      maxSpeedOverride = 0; // pivot in place
    } else if (!isAmbushRole && !assignedRole.includes('FLANK') && distToEnemyGate > 54.0) {
      navTargetY += ctl.laneOffset * 0.5;
    }
  }

  if (!isDoorwayMode) {
    // Slit gun sector avoidance clamp: ensure no navigation waypoint forces tank into enemy slit gun sector
    if (isInEnemySlitGunSector(navTargetX, navTargetY, 1 - owner)) {
      const gx = gateX(1 - owner);
      const dir = (1 - owner) === 0 ? 1 : -1;
      navTargetX = gx + dir * 52.0;
      if (navTargetY > 9.0 && navTargetY < C.FIELD_WIDTH_M - 9.0) {
        navTargetY = tank.y <= C.GATE_CENTER_Y_M ? 7.5 : 92.5;
      }
    }
    navTargetX = Math.max(4, Math.min(C.FIELD_LENGTH_M - 4, navTargetX));
    navTargetY = Math.max(4, Math.min(C.FIELD_WIDTH_M - 4, navTargetY));
  }

  const targetDist = Math.hypot(navTargetX - tank.x, navTargetY - tank.y);
  const desiredHeading = Math.atan2(navTargetY - tank.y, navTargetX - tank.x);

  // 12-13. Hull aiming (fixed gun): stop and pivot the whole tank onto the target's lead point,
  // otherwise Kinematic Dynamic Window rollout & obstacle avoidance toward the waypoint.
  const rearming = profile.rearm && outOfShells;
  const aim =
    !rearming && !isDoorwayMode && !isInEnemySlitGunSector(tank.x, tank.y, 1 - owner)
      ? findAimSolution(world, owner, tank, combatTarget, combatTargetPos, profile)
      : null;

  if (aim) {
    ctl.note('AIM', `T${tank.number} aiming at enemy #${combatTarget.id} (err ${C.radToDeg(Math.abs(aim.errRad)).toFixed(0)} deg)`, {
      key: `aim${tank.id}`,
      sig: combatTarget.id,
      gap: 2,
    });
    applyKinematicCommands(world, owner, tank, 0, aim.turnDeg);
  } else {
    const traj = evaluateKinematicTrajectoryArcs(
      tank,
      world,
      ctl.navGrid,
      { x: navTargetX, y: navTargetY },
      profile,
      { isDoorwayMode, maxSpeedOverride, simTime: ctl.simTime },
    );
    applyKinematicCommands(world, owner, tank, traj.bestSpeedKmh, traj.bestTurnDeg);
  }

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
    if (threat) {
      applyAction(world, owner, 'SMOKE');
      ctl.note('SMOKE', `T${tank.number} drops smoke`, { key: `smk${tank.id}`, gap: 2 });
    }
  }

  // 15. Defensive mines
  if (tank.mines > 0 && (combatTargetDist < 25 || assignedRole.includes('DEFENSE'))) {
    const behindAngle = normalizeAngle(desiredHeading - (tank.heading + Math.PI));
    if (Math.abs(behindAngle) < C.AI_MINE_BEHIND_ANGLE_RAD && Math.random() < profile.useMines) {
      applyAction(world, owner, 'MINE');
      ctl.note('MINE', `T${tank.number} lays a mine`, { key: `mine${tank.id}`, gap: 2 });
    }
  }
}
