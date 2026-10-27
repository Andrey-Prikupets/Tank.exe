import * as C from '../../constants.js';
import { gateX } from '../world.js';
import { assignBrigadeRoles, getRoleWaypoint } from './roles.js';

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

  // Mobilize brigade tanks into formation with organic stagger and speed diversity
  for (const t of myField) {
    if (t.status === 'field' && t.cmdSpeedKmh === 0 && Math.abs(t.speed) < 0.2) {
      const deployDelay = ctl.tankDeployDelay.get(t.id) || 0;
      if (ctl.simTime < deployDelay) continue;

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
      t.heading = wpAngle;
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
      t.speed = C.kmhToMs(C.SPEED_STEP_KMH); // immediate forward roll
      ctl.lastCommandedTime.set(t.id, ctl.simTime - (t.id % 5) * 0.18);
    }
  }

  if (ctl.commanderTimer < C.AI_COMMANDER_EVAL_INTERVAL_S) return;
  ctl.commanderTimer = 0;

  const myGateX = gateX(owner);
  const closestEnemyDist = enemyField.reduce((min, e) => {
    const d = Math.abs(e.x - myGateX);
    return d < min ? d : min;
  }, Infinity);

  const enemyAvgAmmo =
    enemyField.length > 0 ? enemyField.reduce((s, e) => s + e.shells, 0) / enemyField.length : 0;
  const recentCasualties = ctl.casualtyTimestamps.length;

  // Dynamic Plan Transitions
  const prevPlan = ctl.currentPlan;
  let planReason = '';
  if (closestEnemyDist <= C.AI_PLAN_DEFENSE_TRIGGER_DIST_M) {
    ctl.currentPlan = C.AI_STRATEGY_PLANS.CHARLIE; // Base Defense
    planReason = `enemy ${closestEnemyDist.toFixed(0)} m from our gate`;
  } else if (
    ctl.currentPlan === C.AI_STRATEGY_PLANS.CHARLIE &&
    closestEnemyDist >= C.AI_PLAN_DEFENSE_CLEAR_DIST_M
  ) {
    ctl.currentPlan = C.AI_STRATEGY_PLANS.ALPHA; // Disengage Defense
    planReason = 'gate threat cleared';
  } else if (recentCasualties >= C.AI_CASUALTY_RETREAT_COUNT) {
    ctl.currentPlan = C.AI_STRATEGY_PLANS.ALPHA; // Regroup with Standoff
    planReason = `${recentCasualties} tanks lost recently - regroup`;
  } else if (
    enemyField.length > 0 &&
    (enemyAvgAmmo <= C.AI_PURSUIT_AMMO_THRESHOLD ||
      (enemyField.length <= 1 && myField.length >= 3))
  ) {
    ctl.currentPlan = C.AI_STRATEGY_PLANS.DELTA; // Pursuit
    planReason = enemyAvgAmmo <= C.AI_PURSUIT_AMMO_THRESHOLD ? 'enemy out of ammo' : 'enemy nearly eliminated';
  } else if (ctl.currentPlan === C.AI_STRATEGY_PLANS.ALPHA && myField.length >= 4) {
    // Periodic Wedge breach assault when forces are consolidated
    if (Math.sin(ctl.simTime * 0.12) > 0.75) {
      ctl.currentPlan = C.AI_STRATEGY_PLANS.BRAVO;
      planReason = 'forces consolidated - wedge assault';
    }
  }
  if (ctl.currentPlan !== prevPlan) {
    ctl.note('PLAN', `${prevPlan} -> ${ctl.currentPlan}: ${planReason}`);
  }

  ctl.tankRoles = assignBrigadeRoles(myField, ctl.currentPlan);
  ctl.noteRoles(myField, ctl.tankRoles);
}