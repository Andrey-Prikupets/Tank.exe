import * as C from '../../constants.js';
import { gateX, selectedTank } from '../world.js';
import { getGateCorridorPose, getGateAmbushPose } from '../nav.js';
import { normalizeAngle } from './math.js';
import { segmentVsObb, toLocal } from '../geometry.js';
import { assignBrigadeRoles, updateBrigadeRoles, getRoleWaypoint } from './roles.js';

export function isPathClearOfPits(world, x0, y0, heading, dist = 24.0) {
  if (!world.pits || world.pits.length === 0) return true;
  const fx = x0 + Math.cos(heading) * dist;
  const fy = y0 + Math.sin(heading) * dist;
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
  return true;
}

/** Per-tick fast safety reflex for unselected tanks cruising on the field. */
export function enforceUnselectedTanksSafety(ctl, world, myField, activeTank) {
  if (!world.pits || world.pits.length === 0) return;
  for (const t of myField) {
    if (t.status === 'field' && t.id !== activeTank?.id && t.cmdSpeedKmh > 0) {
      const lookAhead = Math.max(12.0, Math.abs(t.speed) * 1.8);
      if (!isPathClearOfPits(world, t.x, t.y, t.heading, lookAhead)) {
        let clearAngle = null;
        for (const off of [0.55, -0.55, 1.05, -1.05, 1.55, -1.55]) {
          if (isPathClearOfPits(world, t.x, t.y, t.heading + off, lookAhead + 4.0)) {
            clearAngle = t.heading + off;
            break;
          }
        }
        if (clearAngle != null) {
          const errRad = normalizeAngle(clearAngle - t.heading);
          t.cmdTurnDeg = Math.sign(errRad) * C.TANK_MAX_TURN_DEG_S;
          t.cmdSpeedKmh = Math.min(t.cmdSpeedKmh, 18);
        } else {
          t.cmdSpeedKmh = 0;
          t.cmdTurnDeg = 45;
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
      } else if (t.cmdSpeedKmh > 0 && !isAtAmbush) {
        // Continuous hazard protection for moving unselected tanks: check forward trajectory
        const forwardLookAhead = Math.max(18.0, Math.abs(t.speed) * 3.0);
        if (!isPathClearOfPits(world, t.x, t.y, t.heading, forwardLookAhead)) {
          let clearAngle = null;
          for (const off of [0.5, -0.5, 0.9, -0.9, 1.3, -1.3, 1.7, -1.7]) {
            if (isPathClearOfPits(world, t.x, t.y, t.heading + off, forwardLookAhead + 5.0)) {
              clearAngle = t.heading + off;
              break;
            }
          }
          if (clearAngle != null) {
            const errRad = normalizeAngle(clearAngle - t.heading);
            const desiredTurn = Math.round(C.radToDeg(errRad) / C.TURN_STEP_DEG_S) * C.TURN_STEP_DEG_S;
            t.cmdTurnDeg = Math.max(-C.TANK_MAX_TURN_DEG_S, Math.min(C.TANK_MAX_TURN_DEG_S, desiredTurn));
            t.cmdSpeedKmh = Math.min(t.cmdSpeedKmh, 18);
          } else {
            t.cmdSpeedKmh = 0;
            t.cmdTurnDeg = 45;
          }
        }
      } else if (t.cmdSpeedKmh === 0 && !isAtAmbush) {
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
        if (!isPathClearOfPits(world, t.x, t.y, wpAngle)) {
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
        t.cmdTurnDeg = Math.max(-C.TANK_MAX_TURN_DEG_S, Math.min(C.TANK_MAX_TURN_DEG_S, desiredTurn));
        t.cmdSpeedKmh = profile.maxSpeedKmh > 18 ? 27 : C.AI_MOBILIZE_CRUISE_KMH;
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