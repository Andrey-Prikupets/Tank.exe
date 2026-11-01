import * as C from '../../constants.js';
import { gateX, selectedTank } from '../world.js';
import { getGateCorridorPose, getGateAmbushPose, isInEnemySlitGunSector, MINE_LETHAL_RADIUS_M } from '../nav.js';
import { normalizeAngle } from './math.js';
import { segmentVsObb, toLocal } from '../geometry.js';
import { assignBrigadeRoles, updateBrigadeRoles, getRoleWaypoint } from './roles.js';
import { leadPoint } from './aiming.js';

export function isPathClearOfPits(world, x0, y0, heading, dist = 24.0) {
  const fx = x0 + Math.cos(heading) * dist;
  const fy = y0 + Math.sin(heading) * dist;

  // Arena boundary check (keep away from top/bottom walls and end walls outside gate lane)
  const inGateLane = Math.abs(fy - C.GATE_CENTER_Y_M) <= C.GATE_WIDTH_M / 2 + 1.0;
  if (fy < 6.5 || fy > C.FIELD_WIDTH_M - 6.5) return false;
  if ((fx < 6.5 || fx > C.FIELD_LENGTH_M - 6.5) && !inGateLane) return false;

  if (world.pits && world.pits.length > 0) {
    for (const pit of world.pits) {
      const expPit = {
        x: pit.x,
        y: pit.y,
        h: pit.h,
        l: pit.l + 8.0,
        w: pit.w + 8.0,
      };
      if (segmentVsObb(x0, y0, fx, fy, expPit) != null) return false;
      const [tlx, tly] = toLocal(pit, x0, y0);
      if (Math.abs(tlx) < pit.l / 2 + 5.0 && Math.abs(tly) < pit.w / 2 + 5.0) return false;
    }
  }

  // Also check mines along the path using full corner-safe trigger clearance
  if (world.mines && world.mines.length > 0) {
    const probe = { x: x0, y: y0, heading };
    for (const m of world.mines) {
      const [mlx, mly] = toLocal(probe, m.x, m.y);
      if (mlx > -1.0 && mlx < dist + 2.0 && Math.abs(mly) < MINE_LETHAL_RADIUS_M + 0.5) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Per-tick parallel multi-tank controller for all unselected field units:
 * 1. Immediate hazard avoidance (mines, pits, boundaries).
 * 2. Parallel Wolfpack crossfire enveloping against active human attackers (2-3 units converge
 *    from -32 deg, 0 deg, +32 deg crossfire angles and pre-aim their hulls simultaneously).
 * 3. Parallel Hunter steering toward unattended/parked enemy tanks outside enemy slit-gun arcs.
 */
export function enforceUnselectedTanksSafety(ctl, world, myField, activeTank) {
  const owner = ctl.owner;
  const enemyOwner = 1 - owner;
  const enemyField = world.tanks.filter((t) => t.owner === enemyOwner && t.status === 'field');

  // Identify active moving enemies vs stationary/unattended enemies
  const movingEnemies = enemyField.filter((e) => Math.abs(e.speed || 0) > 1.0);
  const primaryActiveEnemy = movingEnemies[0] || null;

  // Assign closest 3 armed friendly tanks to Wolfpack crossfire slots (-0.52, 0, +0.52 rad)
  const wolfpackOffsets = new Map();
  if (primaryActiveEnemy) {
    const armedSorted = myField
      .filter((t) => t.status === 'field' && t.shells > 0)
      .sort(
        (a, b) =>
          Math.hypot(a.x - primaryActiveEnemy.x, a.y - primaryActiveEnemy.y) -
          Math.hypot(b.x - primaryActiveEnemy.x, b.y - primaryActiveEnemy.y),
      );
    const offsets = [0, 0.52, -0.52];
    for (let i = 0; i < Math.min(3, armedSorted.length); i++) {
      wolfpackOffsets.set(armedSorted[i].id, offsets[i]);
    }
  }

  for (const t of myField) {
    if (t.status === 'field' && t.id !== activeTank?.id) {
      const lookAhead = Math.max(14.0, Math.abs(t.speed) * 2.2);
      if (t.cmdSpeedKmh !== 0 && !isPathClearOfPits(world, t.x, t.y, t.heading, lookAhead)) {
        let clearAngle = null;
        for (const off of [0.55, -0.55, 1.05, -1.05, 1.55, -1.55, 2.2, -2.2]) {
          if (isPathClearOfPits(world, t.x, t.y, t.heading + off, lookAhead + 4.0)) {
            clearAngle = t.heading + off;
            break;
          }
        }
        if (clearAngle != null) {
          const errRad = normalizeAngle(clearAngle - t.heading);
          t.cmdTurnDeg = Math.sign(errRad) * C.TANK_MAX_TURN_DEG_S;
          t.cmdSpeedKmh = Math.min(Math.max(6, t.cmdSpeedKmh), 18);
        } else {
          t.cmdSpeedKmh = 0;
          t.cmdTurnDeg = C.TANK_MAX_PIVOT_TURN_DEG_S;
        }
        continue;
      }

      // Parallel combat steering & pre-aiming for armed unselected tanks
      if (t.shells > 0 && enemyField.length > 0) {
        let targetEnemy = null;
        let minScore = Infinity;
        for (const e of enemyField) {
          const d = Math.hypot(e.x - t.x, e.y - t.y);
          // Wolfpack members prioritize the active moving human tank; other tanks hunt nearest enemy
          const isWolfpackTarget = wolfpackOffsets.has(t.id) && Math.abs(e.speed || 0) > 1.0;
          const score = d - (isWolfpackTarget ? 45.0 : Math.abs(e.speed || 0) > 1.5 ? 20.0 : 0);
          if (score < minScore) {
            minScore = score;
            targetEnemy = e;
          }
        }

        if (targetEnemy) {
          const rawDist = Math.hypot(targetEnemy.x - t.x, targetEnemy.y - t.y);
          const lead = leadPoint(t, targetEnemy.x, targetEnemy.y, targetEnemy.speed, targetEnemy.heading, 1.0, targetEnemy.turn || 0);

          let desiredH = Math.atan2(lead.y - t.y, lead.x - t.x);
          let desiredSpeed = 36;

          if (rawDist <= 50.0) {
            // Within 50m: pre-align hull gun directly onto enemy lead point so this tank is ready
            // for instant volley fire the moment the dispatcher selects it!
            const errDeg = Math.abs(C.radToDeg(normalizeAngle(desiredH - t.heading)));
            desiredSpeed = lead.muzzleDist > C.SHELL_RANGE_M - 1.0 ? 36 : errDeg > 10 ? 18 : 6;
          } else if (wolfpackOffsets.has(t.id) && Math.abs(targetEnemy.speed || 0) > 1.0) {
            // Beyond 50m: converge along assigned Wolfpack pincer crossfire angle (-30, 0, +30 deg)
            const angleToMe = Math.atan2(t.y - lead.y, t.x - lead.x);
            const crossfireAngle = angleToMe + wolfpackOffsets.get(t.id);
            const wpX = Math.max(12, Math.min(C.FIELD_LENGTH_M - 12, lead.x + Math.cos(crossfireAngle) * 26.0));
            const wpY = Math.max(12, Math.min(C.FIELD_WIDTH_M - 12, lead.y + Math.sin(crossfireAngle) * 26.0));
            if (!isInEnemySlitGunSector(wpX, wpY, enemyOwner)) {
              desiredH = Math.atan2(wpY - t.y, wpX - t.x);
            }
            desiredSpeed = 36;
          } else {
            // Non-wolfpack tank beyond 50m: let role waypoint / flank approach guide it
            continue;
          }

          const checkDist = Math.max(14.0, (desiredSpeed / 3.6) * 1.5);
          const projX = t.x + Math.cos(desiredH) * checkDist;
          const projY = t.y + Math.sin(desiredH) * checkDist;
          if (
            isPathClearOfPits(world, t.x, t.y, desiredH, checkDist) &&
            !isInEnemySlitGunSector(projX, projY, enemyOwner)
          ) {
            const errDeg = C.radToDeg(normalizeAngle(desiredH - t.heading));
            t.cmdSpeedKmh = desiredSpeed;
            if (Math.abs(errDeg) > 4.0) {
              const maxTurn = t.cmdSpeedKmh === 0 ? C.TANK_MAX_PIVOT_TURN_DEG_S : C.TANK_MAX_TURN_DEG_S;
              const stepTurn = Math.round(errDeg / C.TURN_STEP_DEG_S) * C.TURN_STEP_DEG_S;
              t.cmdTurnDeg = Math.max(-maxTurn, Math.min(maxTurn, stepTurn || (errDeg > 0 ? 15 : -15)));
            } else {
              t.cmdTurnDeg = 0;
            }
          }
        }
      }
    }
  }
}


/** Tier 1: Brigade Commander Strategic State Machine. */
export function updateCommander(ctl, world, dt, myField, enemyField, profile) {
  const owner = ctl.owner;
  ctl.commanderTimer += dt;

  // Track casualties
  for (const t of world.tanks) {
    if (t.owner === owner && t.status === 'dead' && !ctl.deadTankIds.has(t.id)) {
      ctl.deadTankIds.add(t.id);
      ctl.casualtyTimestamps.push(ctl.simTime);
      ctl.note('LOSS', `Tank destroyed at (${t.x.toFixed(0)}, ${t.y.toFixed(0)}); ${ctl.deadTankIds.size} lost`);
    }
  }
  ctl.casualtyTimestamps = ctl.casualtyTimestamps.filter(
    (ts) => ctl.simTime - ts <= C.AI_CASUALTY_WINDOW_S,
  );

  const enemyGateX = gateX(1 - owner);

  // Initial and dynamic brigade role assignment if unassigned
  if (!ctl.tankRoles || ctl.tankRoles.size === 0) {
    ctl.tankRoles = assignBrigadeRoles(myField, ctl.currentPlan, ctl.doctrine, owner);
    ctl.noteRoles(myField, ctl.tankRoles);
  }

  // Mobilize brigade tanks into formation with organic stagger and speed diversity (only once per tank)
  if (!ctl.mobilizedTankIds) ctl.mobilizedTankIds = new Set();
  for (const t of myField) {
    if (t.status === 'field' && !ctl.mobilizedTankIds.has(t.id)) {
      const deployDelay = ctl.tankDeployDelay.get(t.id) || 0;
      if (ctl.simTime < deployDelay) continue;

      ctl.mobilizedTankIds.add(t.id);
      const role = ctl.tankRoles.get(t.id) || 'VANGUARD';
      const roleWaypoint = getRoleWaypoint(
        t,
        role,
        ctl.currentPlan,
        owner,
        enemyGateX,
        ctl.simTime,
      );
      let wpAngle = Math.atan2(roleWaypoint.y - t.y, roleWaypoint.x - t.x);
      const distToWp = Math.hypot(roleWaypoint.x - t.x, roleWaypoint.y - t.y);

      // Verify opening route is clear of pits
      const checkDist = Math.min(75.0, distToWp);
      if (!isPathClearOfPits(world, t.x, t.y, wpAngle, checkDist)) {
        let clearAngle = null;
        for (const off of [0.45, -0.45, 0.85, -0.85, 1.25, -1.25, 1.6, -1.6]) {
          if (isPathClearOfPits(world, t.x, t.y, wpAngle + off, Math.min(45.0, checkDist))) {
            clearAngle = wpAngle + off;
            break;
          }
        }
        if (clearAngle != null) {
          wpAngle = clearAngle;
        } else {
          const flankY = t.y < C.FIELD_WIDTH_M / 2 ? 16 : 84;
          wpAngle = Math.atan2(flankY - t.y, (owner === 0 ? 50 : 200) - t.x);
        }
      }

      const errRad = normalizeAngle(wpAngle - t.heading);
      const desiredTurn = Math.round(C.radToDeg(errRad) / C.TURN_STEP_DEG_S) * C.TURN_STEP_DEG_S;
      t.cmdTurnDeg = Math.max(-C.TANK_MAX_TURN_DEG_S, Math.min(C.TANK_MAX_TURN_DEG_S, desiredTurn));

      const individualCruise = ctl.tankCruiseSpeeds.get(t.id) || (
        profile.maxSpeedKmh > 18 ? 36 : C.AI_MOBILIZE_CRUISE_KMH
      );
      const cruiseSpeed =
        ctl.currentPlan === C.AI_STRATEGY_PLANS.DELTA ||
        role.startsWith('SPEARHEAD') ||
        role === 'VANGUARD'
          ? profile.maxSpeedKmh
          : Math.min(individualCruise, profile.maxSpeedKmh);
      t.cmdSpeedKmh = cruiseSpeed;
      ctl.lastCommandedTime.set(t.id, ctl.simTime - (t.id % 5) * 0.18);
    }
  }

  if (ctl.commanderTimer < C.AI_COMMANDER_EVAL_INTERVAL_S) return;
  ctl.commanderTimer = 0;

  // Keep unselected tanks maneuvering: armed tanks advance toward role waypoints, empty tanks return to hangar
  const activeTank = selectedTank(world, owner);
  for (const t of myField) {
    if (t.status === 'field' && t.id !== activeTank?.id) {
      const role = ctl.tankRoles.get(t.id) || 'VANGUARD';
      const isAmbush = role === 'NORTH_GATE_AMBUSH' || role === 'SOUTH_GATE_AMBUSH';
      const ambushPose = isAmbush
        ? getGateAmbushPose(t, owner, role === 'NORTH_GATE_AMBUSH' ? 'NORTH' : 'SOUTH')
        : null;
      const isAtAmbush = ambushPose?.isAtAmbush;
      const isRearming = profile.rearm && t.shells === 0;
      if (isRearming) {
        const gatePose = getGateCorridorPose(t, owner, ctl.simTime);
        let wpAngle = Math.atan2(gatePose.targetY - t.y, gatePose.targetX - t.x);
        if (!gatePose.isDoorwayMode && !isPathClearOfPits(world, t.x, t.y, wpAngle)) {
          let clearAngle = null;
          for (const off of [0.6, -0.6, 1.1, -1.1]) {
            if (isPathClearOfPits(world, t.x, t.y, wpAngle + off)) {
              clearAngle = wpAngle + off;
              break;
            }
          }
          if (clearAngle != null) wpAngle = clearAngle;
          else {
            t.cmdSpeedKmh = 0;
            continue;
          }
        }
        const errRad = normalizeAngle(wpAngle - t.heading);
        const desiredTurn = Math.round(C.radToDeg(errRad) / C.TURN_STEP_DEG_S) * C.TURN_STEP_DEG_S;
        t.cmdTurnDeg = gatePose.isDoorwayMode ? 0 : Math.max(-C.TANK_MAX_TURN_DEG_S, Math.min(C.TANK_MAX_TURN_DEG_S, desiredTurn));
        t.cmdSpeedKmh = gatePose.speedLimitKmh || 18;
      } else if (!isAtAmbush) {
        // Continuous parallel waypoint steering for ALL unselected tanks (both moving and stopped)
        // when not already within 50m combat pre-aim range of an enemy.
        const nearEnemy = enemyField.some((e) => Math.hypot(e.x - t.x, e.y - t.y) <= 50.0);
        if (!nearEnemy || t.cmdSpeedKmh === 0) {
          const roleWaypoint = getRoleWaypoint(
            t,
            role,
            ctl.currentPlan,
            owner,
            enemyGateX,
            ctl.simTime,
            world,
          );
          let wpAngle = Math.atan2(roleWaypoint.y - t.y, roleWaypoint.x - t.x);
          const forwardLookAhead = Math.max(18.0, Math.abs(t.speed) * 3.0);
          if (!isPathClearOfPits(world, t.x, t.y, wpAngle, forwardLookAhead)) {
            let clearAngle = null;
            for (const off of [0.5, -0.5, 0.9, -0.9, 1.3, -1.3, 1.7, -1.7]) {
              if (isPathClearOfPits(world, t.x, t.y, wpAngle + off, forwardLookAhead)) {
                clearAngle = wpAngle + off;
                break;
              }
            }
            if (clearAngle != null) wpAngle = clearAngle;
            else {
              t.cmdSpeedKmh = 0;
              t.cmdTurnDeg = C.TANK_MAX_PIVOT_TURN_DEG_S;
              continue;
            }
          }
          const errRad = normalizeAngle(wpAngle - t.heading);
          const desiredTurn = Math.round(C.radToDeg(errRad) / C.TURN_STEP_DEG_S) * C.TURN_STEP_DEG_S;
          t.cmdTurnDeg = Math.max(-C.TANK_MAX_TURN_DEG_S, Math.min(C.TANK_MAX_TURN_DEG_S, desiredTurn));
          t.cmdSpeedKmh = profile.maxSpeedKmh > 18 ? 36 : C.AI_MOBILIZE_CRUISE_KMH;
        }
      }
    }
  }

  const myGateX = gateX(owner);
  const closestEnemyDist = enemyField.reduce((min, e) => {
    const d = Math.abs(e.x - myGateX);
    return d < min ? d : min;
  }, Infinity);

  const enemyAvgAmmo =
    enemyField.length > 0 ? enemyField.reduce((s, e) => s + e.shells, 0) / enemyField.length : 0;
  const recentCasualties = ctl.casualtyTimestamps.length;

  // Dynamic Plan Transitions (with dwell time / hysteresis so plans do not flap)
  const P = C.AI_STRATEGY_PLANS;
  const prevPlan = ctl.currentPlan;
  const dwell = ctl.simTime - ctl.planSince;
  const nearThreats = enemyField.filter(
    (e) => Math.abs(e.x - myGateX) <= C.AI_PLAN_DEFENSE_TRIGGER_DIST_M,
  ).length;
  const gateThreat =
    closestEnemyDist <= C.AI_PLAN_DEFENSE_INNER_DIST_M ||
    nearThreats >= C.AI_PLAN_DEFENSE_MIN_THREATS;
  const pursuitCond =
    enemyField.length > 0 &&
    (enemyAvgAmmo <= C.AI_PURSUIT_AMMO_THRESHOLD ||
      (enemyField.length <= 1 && myField.length >= 3));
  const pursuitWhy =
    enemyAvgAmmo <= C.AI_PURSUIT_AMMO_THRESHOLD ? 'enemy out of ammo' : 'enemy nearly eliminated';
  const calm = recentCasualties < C.AI_CASUALTY_RETREAT_COUNT;
  let planReason = '';

  if (gateThreat && prevPlan !== P.CHARLIE) {
    ctl.currentPlan = P.CHARLIE; // Base Defense
    planReason = `${nearThreats} enemy near gate, nearest ${closestEnemyDist.toFixed(0)} m`;
  } else if (prevPlan === P.CHARLIE) {
    if (!gateThreat && closestEnemyDist >= C.AI_PLAN_DEFENSE_CLEAR_DIST_M && dwell >= C.AI_PLAN_MIN_DWELL_S) {
      ctl.currentPlan = P.ALPHA; // Disengage Defense
      planReason = 'gate threat cleared';
    }
  } else if (!calm && prevPlan !== P.ALPHA) {
    ctl.currentPlan = P.ALPHA; // Regroup with Standoff
    planReason = `${recentCasualties} tanks lost recently - regroup`;
  } else if (prevPlan === P.DELTA) {
    if (!pursuitCond && dwell >= C.AI_PLAN_MIN_DWELL_S) {
      ctl.currentPlan = P.ALPHA;
      planReason = 'pursuit condition ended';
    }
  } else if (prevPlan === P.BRAVO) {
    if (pursuitCond) {
      ctl.currentPlan = P.DELTA;
      planReason = pursuitWhy;
    } else if (myField.length < C.AI_WEDGE_MIN_TANKS || dwell >= C.AI_WEDGE_MAX_DURATION_S) {
      ctl.currentPlan = P.ALPHA;
      planReason = myField.length < C.AI_WEDGE_MIN_TANKS ? 'wedge depleted' : 'wedge assault timed out';
    }
  } else if (calm) {
    // Alpha
    if (pursuitCond) {
      ctl.currentPlan = P.DELTA; // Pursuit
      planReason = pursuitWhy;
    } else if (myField.length >= C.AI_WEDGE_MIN_TANKS && Math.sin(ctl.simTime * 0.12) > 0.75) {
      // Periodic Wedge breach assault when forces are consolidated
      ctl.currentPlan = P.BRAVO;
      planReason = 'forces consolidated - wedge assault';
    }
  }

  const planChanged = ctl.currentPlan !== prevPlan;
  if (planChanged) {
    ctl.planSince = ctl.simTime;
    ctl.note('PLAN', `${prevPlan} -> ${ctl.currentPlan}: ${planReason}`);
  }

  ctl.tankRoles = updateBrigadeRoles(ctl.tankRoles, myField, ctl.currentPlan, planChanged, ctl.doctrine, owner);
  ctl.noteRoles(myField, ctl.tankRoles);
}