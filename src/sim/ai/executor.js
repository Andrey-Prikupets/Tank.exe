import * as C from '../../constants.js';
import { applyAction, gateX, inwardDir, baseHeading, windowY } from '../world.js';
import { toLocal } from '../geometry.js';
import { getAttackStandoffWaypoint, getGateCorridorPose, getGateAmbushPose, isInEnemySlitGunSector, evaluateKinematicTrajectoryArcs, applyKinematicCommands, gateReservationManager } from '../nav.js';
import { normalizeAngle, fuzz } from './math.js';
import { isLineOfSightBlockedBySmoke, getPredictedEnemyState, isLineOfFireBlocked } from './perception.js';
import { tryFireWeapon } from './weapons.js';
import { getRoleWaypoint } from './roles.js';
import { findAimSolution, aimTurnCommandDeg } from './aiming.js';

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
    ctl.lastFiredTime = ctl.simTime;
    const fd = Math.hypot(firedAt.x - tank.x, firedAt.y - tank.y);
    ctl.note('FIRE', `T${tank.number} fires at enemy #${firedAt.id} (${fd.toFixed(0)} m)`, {
      key: `fire${tank.id}`,
      sig: 'f',
      gap: 1.5,
    });
  }

  // Tactical slit defense: if an enemy has penetrated close to gate and our tank is distant
  // and not engaged in close combat itself. Verify the enemy is actually inside the 45-deg window cone!
  if (enemyField.length > 0 && profile.rearm && ctl.simTime >= (ctl.slitCooldownUntil || 0)) {
    const minEnemyToTank = enemyField.reduce(
      (minD, e) => Math.min(minD, Math.hypot(e.x - tank.x, e.y - tank.y)),
      Infinity,
    );
    const wx = gateX(owner) + inwardDir(owner) * C.WINDOW_CAMERA_INSET_M;
    const baseHead = baseHeading(owner);
    const maxYaw = C.degToRad(C.WINDOW_MAX_YAW_DEG);
    const canHitFromWindow = (e, idx) => {
      const wy = windowY(owner, idx);
      const d = Math.hypot(e.x - wx, e.y - wy);
      if (d > C.AI_SLIT_MAX_FIRE_DIST_M) return false;
      const relYaw = normalizeAngle(Math.atan2(e.y - wy, e.x - wx) - baseHead);
      if (Math.abs(relYaw) > maxYaw) return false;
      return !isLineOfFireBlocked(world, owner, wx, wy, e.x, e.y, null);
    };
    const threat = enemyField
      .filter(
        (e) =>
          Math.abs(e.x - gateX(owner)) < fuzz(C.AI_SLIT_DEFENSE_TRIGGER_DIST_M, profile, 14.0, 34.0) &&
          (canHitFromWindow(e, 0) || canHitFromWindow(e, 1)),
      )
      .sort((a, b) => Math.abs(a.x - gateX(owner)) - Math.abs(b.x - gateX(owner)))[0];
    const timeSinceFire = ctl.simTime - (ctl.lastFiredTime || 0);
    const canSwitchToSlit =
      ctl.sliceTimer >= fuzz(C.AI_MIN_SLICE_S, profile, 0.6, 2.0) &&
      timeSinceFire >= fuzz(C.AI_POST_FIRE_HOLD_S, profile, 0.2, 0.7) &&
      minEnemyToTank > fuzz(42.0, profile, 25.0, 60.0);
    if (threat && Math.abs(tank.x - gateX(owner)) > fuzz(C.AI_SLIT_ENTRY_MIN_TANK_DIST_M, profile, 22.0, 55.0) && canSwitchToSlit) {
      const useWin0 = canHitFromWindow(threat, 0);
      const slitAction = useWin0 ? 'WIN_L' : 'WIN_R';
      ctl.note(
        'SLIT',
        `Enemy ${Math.abs(threat.x - gateX(owner)).toFixed(0)} m from gate, field tanks far - manning slit window`,
        { key: 'slit-enter', gap: 3 },
      );
      applyAction(world, owner, slitAction);
      ctl.slitTimer = 0;
      return;
    }
  }

  // 8. Stuck recovery
  if (tank.contacts.length > 0 && Math.abs(tank.speed) < fuzz(0.6, profile, 0.1, 2.0)) {
    ctl.stuckTimer += dt;
    if (ctl.stuckTimer > fuzz(0.4, profile, 0.15, 1.2)) {
      ctl.reverseTimer = fuzz(1.0, profile, 0.4, 2.0);
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

  const outOfShells = tank.shells === 0;
  const isRearming = profile.rearm && outOfShells;

  // 10. Target selection (LOS check with smoke obscuration, threat weighting, lock hysteresis)
  let combatTarget = null;
  let combatTargetDist = Infinity;
  let combatTargetPos = null;

  if (!isRearming && enemyField.length > 0) {
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
        Math.abs(normalizeAngle(toUs - e.heading)) < fuzz(0.35, profile, 0.1, 0.9) &&
        d < fuzz(profile.maxFireDist, profile, 8.0, 36.0);
      const isLocked = e.id === ctl.lockedTargetId;
      const noise = (Math.random() - 0.5) * C.AI_TARGET_NOISE_AMPLITUDE * (1 + (profile.noiseFactor || 0) * 3);

      // Highest priority for enemy tanks actively emerging through the gate entrance!
      const enemyGate = gateX(1 - owner);
      const isEmergingFromGate =
        Math.abs(e.speed || 0) > fuzz(0.5, profile, 0.1, 3.0) &&
        Math.abs(e.x - enemyGate) <= fuzz(9.0, profile, 4.0, 16.0) &&
        Math.abs(e.y - C.GATE_CENTER_Y_M) <= fuzz(5.0, profile, 2.0, 10.0);
      const emergingBonus = isEmergingFromGate ? fuzz(70.0, profile, 35.0, 100.0) : 0;

      // Prioritize active moving human attackers and base raiders over stationary spawn reserves
      const ownGate = gateX(owner);
      const isMovingThreat = Math.abs(e.speed || 0) > fuzz(1.5, profile, 0.3, 5.0);
      const isRaidingOurBase = Math.abs(e.x - ownGate) < fuzz(60.0, profile, 30.0, 95.0);
      const activeThreatBonus =
        (isMovingThreat ? fuzz(38.0, profile, 18.0, 60.0) : 0) +
        (isRaidingOurBase && isMovingThreat ? fuzz(24.0, profile, 10.0, 42.0) : 0);

      const isOpportunity =
        !blocked &&
        !smokeBlocked &&
        d <= fuzz(C.AI_TARGET_OPPORTUNITY_MAX_DIST_M + 12.0, profile, 18.0, 48.0) &&
        ang <= fuzz(C.AI_TARGET_OPPORTUNITY_MAX_ANGLE_RAD, profile, 0.5, 2.2) &&
        tank.shells > 0;

      const anglePenalty = isOpportunity
        ? ang * (C.AI_TARGET_THREAT_ANGLE_WEIGHT * 0.4)
        : ang * C.AI_TARGET_THREAT_ANGLE_WEIGHT;

      const score =
        d +
        anglePenalty +
        (blocked ? C.AI_TARGET_LOS_BLOCKED_PENALTY : 0) +
        smokePenalty -
        emergingBonus -
        activeThreatBonus -
        (facingUs ? C.AI_TARGET_FACING_US_BONUS : 0) -
        (isOpportunity ? C.AI_TARGET_OPPORTUNITY_BONUS : 0) -
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
    world,
  );

  let navTargetX = roleWaypoint.x;
  let navTargetY = roleWaypoint.y;
  let isDoorwayMode = false;
  let maxSpeedOverride = profile.maxSpeedKmh;

  const isAmbushRole =
    assignedRole === 'NORTH_GATE_AMBUSH' || assignedRole === 'SOUTH_GATE_AMBUSH';
  const ambushPose = isAmbushRole
    ? getGateAmbushPose(tank, owner, assignedRole === 'NORTH_GATE_AMBUSH' ? 'NORTH' : 'SOUTH')
    : null;

  if (isRearming) {
    ctl.note('REARM', `T${tank.number} out of shells - returning to hangar`, {
      key: `rearm${tank.id}`,
      gap: 5,
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

    // Identify nearest enemy threat while rearming / fleeing
    let nearestThreat = null;
    let nearestThreatDist = Infinity;
    for (const e of enemyField) {
      const d = Math.hypot(e.x - tank.x, e.y - tank.y);
      if (d < nearestThreatDist) {
        nearestThreatDist = d;
        nearestThreat = e;
      }
    }

    if (nearestThreat && nearestThreatDist < fuzz(35.0, profile, 18.0, 55.0)) {
      // Sprint to hangar to escape the armed pursuer!
      maxSpeedOverride = profile.maxSpeedKmh;

      // If enemy is directly in our path to the gate, add lateral evasive jinking
      const toGateX = navTargetX - tank.x;
      const toEnemyX = nearestThreat.x - tank.x;
      if (Math.sign(toGateX) === Math.sign(toEnemyX) && nearestThreatDist < fuzz(18.0, profile, 8.0, 28.0)) {
        const jinkDir = tank.y < nearestThreat.y ? -1 : 1;
        navTargetY = Math.max(12, Math.min(88, navTargetY + jinkDir * fuzz(16.0, profile, 8.0, 24.0)));
      }
    }
  } else {
    gateReservationManager.releaseGate(owner, tank.id);
    if (combatTarget && combatTargetPos && tank.shells > 0) {
      const isOpportunityTarget =
        !isLineOfFireBlocked(world, owner, tank.x, tank.y, combatTargetPos.x, combatTargetPos.y, tank.id) &&
        combatTargetDist <= fuzz(C.AI_TARGET_OPPORTUNITY_MAX_DIST_M + 12.0, profile, 18.0, 48.0);

      if (isOpportunityTarget) {
        // Opportunity fire diversion: divert directly toward target to line up and shoot
        navTargetX = combatTargetPos.x;
        navTargetY = combatTargetPos.y;
      } else {
        // High-level tactical attack standoff waypoint outside enemy front gun arc
        const attackWp = getAttackStandoffWaypoint(tank, combatTarget, world, profile, ctl.simTime);
        navTargetX = attackWp.x;
        navTargetY = attackWp.y;
      }
    } else if (isAmbushRole && ambushPose && ambushPose.isAtAmbush) {
      ctl.note('AMBUSH', `T${tank.number} holds gate ambush post`, { key: `amb${tank.id}`, gap: 30 });
      // Hold position in ambush post, pre-aim gun directly across gate doorway threshold
      navTargetX = ambushPose.doorwayAimX;
      navTargetY = ambushPose.doorwayAimY;
      maxSpeedOverride = 0; // pivot in place
    } else if (!isAmbushRole && !assignedRole.includes('FLANK') && distToEnemyGate > 40.0) {
      navTargetY += ctl.laneOffset * 0.5;
    }
  }

  const gx = gateX(1 - owner);
  const dir = (1 - owner) === 0 ? 1 : -1;
  const containmentX = gx + dir * 37.0;
  const containmentY = tank.y <= C.GATE_CENTER_Y_M ? 30.0 : 70.0;
  const nearContainmentPost = Math.hypot(containmentX - tank.x, containmentY - tank.y) <= 8.0;

  const isHoldingContainmentPost =
    !isRearming &&
    !isDoorwayMode &&
    tank.shells > 0 &&
    !isInEnemySlitGunSector(tank.x, tank.y, 1 - owner, 0) &&
    nearContainmentPost &&
    (!combatTarget || isInEnemySlitGunSector(combatTargetPos.x, combatTargetPos.y, 1 - owner));

  if (!isDoorwayMode && !isRearming) {
    // Immediate escape waypoint if currently inside enemy slit-gun sector and no immediate enemy tank in range
    if ((!combatTarget || combatTargetDist > 38.0) && isInEnemySlitGunSector(tank.x, tank.y, 1 - owner, 0)) {
      navTargetX = gx + dir * 40.0;
      navTargetY = tank.y <= C.GATE_CENTER_Y_M ? 28.0 : 72.0;
      maxSpeedOverride = profile.maxSpeedKmh;
    } else if (!isHoldingContainmentPost && isInEnemySlitGunSector(navTargetX, navTargetY, 1 - owner)) {
      // Slit gun sector avoidance clamp: clamp waypoint onto the safe Forward Containment Arc
      navTargetX = containmentX;
      navTargetY = containmentY;
    }
    navTargetX = Math.max(4, Math.min(C.FIELD_LENGTH_M - 4, navTargetX));
    navTargetY = Math.max(4, Math.min(C.FIELD_WIDTH_M - 4, navTargetY));
  }

  const targetDist = Math.hypot(navTargetX - tank.x, navTargetY - tank.y);

  // 12-13. Hull aiming (fixed gun): stop and pivot the whole tank onto the target's lead point,
  // or pre-aim at the enemy gate exit when holding on the Forward Containment Arc;
  // otherwise Kinematic Dynamic Window rollout & obstacle avoidance toward the waypoint.
  const rearming = profile.rearm && outOfShells;
  const aim =
    !rearming && !isDoorwayMode
      ? findAimSolution(world, owner, tank, combatTarget, combatTargetPos, profile)
      : null;

  if (aim) {
    ctl.note('AIM', `T${tank.number} aiming at enemy #${combatTarget.id} (err ${C.radToDeg(Math.abs(aim.errRad)).toFixed(0)} deg)`, {
      key: `aim${tank.id}`,
      sig: combatTarget.id,
      gap: 2,
    });
    const creepHold =
      isHoldingContainmentPost &&
      Math.abs(aim.errRad) > fuzz(0.20, profile, 0.06, 0.5) &&
      !isInEnemySlitGunSector(
        tank.x + Math.cos(tank.heading) * 4.5,
        tank.y + Math.sin(tank.heading) * 4.5,
        1 - owner,
        0,
      );
    const holdSpeed = isHoldingContainmentPost ? (creepHold ? 6 : 0) : (aim.cmdSpeedKmh ?? 0);
    const holdTurn = aimTurnCommandDeg(aim.errRad, tank.cmdTurnDeg || 0, holdSpeed !== 0, profile);
    applyKinematicCommands(world, owner, tank, holdSpeed, holdTurn);
  } else if (isHoldingContainmentPost) {
    const gateAimX = combatTargetPos ? combatTargetPos.x : gx + dir * fuzz(6.0, profile, 3.0, 12.0);
    const gateAimY = combatTargetPos ? combatTargetPos.y : C.GATE_CENTER_Y_M;
    const errRad = normalizeAngle(Math.atan2(gateAimY - tank.y, gateAimX - tank.x) - tank.heading);
    const creepSafe =
      Math.abs(errRad) > fuzz(0.20, profile, 0.06, 0.5) &&
      !isInEnemySlitGunSector(
        tank.x + Math.cos(tank.heading) * 4.5,
        tank.y + Math.sin(tank.heading) * 4.5,
        1 - owner,
        0,
      );
    const cmdSpd = creepSafe ? 6 : 0;
    const turnDeg = aimTurnCommandDeg(errRad, tank.cmdTurnDeg || 0, cmdSpd !== 0, profile);
    applyKinematicCommands(world, owner, tank, cmdSpd, turnDeg);
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
      targetDist < fuzz(C.AI_SMOKE_LOW_AMMO_DIST_M, profile, 8.0, 32.0) &&
      Math.random() < profile.useSmoke;
    if (!threat) {
      for (const s of world.shells) {
        if (s.owner !== owner) {
          const sDist = Math.hypot(s.x - tank.x, s.y - tank.y);
          if (sDist < fuzz(C.AI_SMOKE_INCOMING_SHELL_DIST_M, profile, 8.0, 30.0)) {
            const toMeX = tank.x - s.x;
            const toMeY = tank.y - s.y;
            const dot = (s.dx * toMeX + s.dy * toMeY) / sDist;
            if (dot > fuzz(C.AI_SMOKE_SHELL_DOT_THRESHOLD, profile, 0.4, 0.98) && Math.random() < profile.useSmoke) {
              threat = true;
              break;
            }
          }
        }
      }
    }
    // Offensive smoke: first smoke of an assaulting tank screens it from the enemy slit guns
    // while it closes on the gate (the second smoke stays in reserve for defence).
    if (
      !threat &&
      tank.smokes >= C.TANK_START_SMOKES &&
      !assignedRole.includes('DEFENSE') &&
      assignedRole !== 'RELOADER' &&
      assignedRole !== 'SENTRY' &&
      distToEnemyGate >= fuzz(C.AI_ASSAULT_SMOKE_MIN_DIST_M, profile, 12.0, 36.0) &&
      distToEnemyGate <= fuzz(C.AI_ASSAULT_SMOKE_MAX_DIST_M, profile, 28.0, 56.0) &&
      Math.random() < profile.useSmoke
    ) {
      applyAction(world, owner, 'SMOKE');
      ctl.note('SMOKE', `T${tank.number} screens its assault run with smoke`, { key: `smk${tank.id}`, gap: 2 });
    }
    if (threat) {
      applyAction(world, owner, 'SMOKE');
      ctl.note('SMOKE', `T${tank.number} drops smoke`, { key: `smk${tank.id}`, gap: 2 });
    }
  }

  // 15. Defensive mines: Lay mines when pursued from behind or when defending the base
  if (C.AI_MINES_ENABLED && tank.mines > 0 && Math.random() < (profile.useMines || 0.6)) {
    const ownGateX = gateX(owner);
    const inOwnGateLane =
      Math.abs(tank.x - ownGateX) < 14.0 &&
      Math.abs(tank.y - C.GATE_CENTER_Y_M) < 6.0;

    // Check if an enemy is actively pursuing in our trailing wake corridor
    let pursuerBehind = false;
    for (const e of enemyField) {
      const [elx, ely] = toLocal(tank, e.x, e.y);
      if (
        elx < fuzz(-2.0, profile, -5.0, -1.0) &&
        elx > fuzz(-24.0, profile, -35.0, -12.0) &&
        Math.abs(ely) < fuzz(5.0, profile, 2.5, 8.0) &&
        (e.speed || 0) > fuzz(1.5, profile, 0.3, 4.0) &&
        Math.cos(e.heading - tank.heading) > fuzz(0.35, profile, 0.1, 0.7)
      ) {
        pursuerBehind = true;
        break;
      }
    }

    const friendlyNear = world.tanks.some(
      (t) =>
        t.owner === owner &&
        t.id !== tank.id &&
        t.status === 'field' &&
        Math.hypot(t.x - tank.x, t.y - tank.y) < Math.max(18.0, C.AI_MINE_FRIENDLY_SAFE_DIST_M),
    );

    const gateThreat = enemyField.some(
      (e) => Math.abs(e.x - ownGateX) <= C.AI_MINE_GATE_THREAT_DIST_M && (e.speed || 0) > 1.0,
    );
    const isDefendingBase = assignedRole.includes('DEFENSE') && gateThreat && pursuerBehind;

    if (!inOwnGateLane && !friendlyNear && (pursuerBehind || isDefendingBase)) {
      // Must be moving forward away from the mine
      if (tank.speed > 0.5 || tank.cmdSpeedKmh > 0) {
        applyAction(world, owner, 'MINE');
        ctl.note('MINE', `T${tank.number} lays mine against pursuing enemy`, { key: `mine${tank.id}`, gap: 3 });
      }
    }
  }
}
