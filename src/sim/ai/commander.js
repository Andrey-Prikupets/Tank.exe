import * as C from '../../constants.js';
import { gateX, selectedTank } from '../world.js';
import { getGateCorridorPose } from '../nav.js';
import { normalizeAngle } from './math.js';
import { assignBrigadeRoles, updateBrigadeRoles, getRoleWaypoint } from './roles.js';

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
      const wpAngle = Math.atan2(roleWaypoint.y - t.y, roleWaypoint.x - t.x);
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
      const isRearming = profile.rearm && t.shells === 0;
      if (isRearming) {
        const gatePose = getGateCorridorPose(t, owner, ctl.simTime);
        const wpAngle = Math.atan2(gatePose.targetY - t.y, gatePose.targetX - t.x);
        const errRad = normalizeAngle(wpAngle - t.heading);
        const desiredTurn = Math.round(C.radToDeg(errRad) / C.TURN_STEP_DEG_S) * C.TURN_STEP_DEG_S;
        t.cmdTurnDeg = gatePose.isDoorwayMode ? 0 : Math.max(-C.TANK_MAX_TURN_DEG_S, Math.min(C.TANK_MAX_TURN_DEG_S, desiredTurn));
        t.cmdSpeedKmh = gatePose.speedLimitKmh || 18;
      } else if (t.cmdSpeedKmh === 0 && !isAmbush) {
        const roleWaypoint = getRoleWaypoint(
          t,
          role,
          ctl.currentPlan,
          owner,
          enemyGateX,
          ctl.simTime,
          world,
        );
        const wpAngle = Math.atan2(roleWaypoint.y - t.y, roleWaypoint.x - t.x);
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