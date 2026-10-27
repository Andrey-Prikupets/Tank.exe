import * as C from '../../constants.js';
import { applyAction, isSpawnClear } from '../world.js';
import { urgencyReason, evaluateTankUrgency, applySafeCruisingTrim } from './urgency.js';

export function runDispatcher(ctl, world, myField, enemyField, profile, tank) {
  const owner = ctl.owner;
  // 6. Tier 2: Urgency-Weighted Time-Slice Dispatcher
  const canSwitch = ctl.sliceTimer >= C.AI_MIN_SLICE_S;
  const forceSwitch = ctl.sliceTimer >= C.AI_MAX_SLICE_S;

  let bestTank = null;
  let maxUrgency = -Infinity;
  let bestUrgencyInfo = null;

  for (const t of myField) {
    const timeSince = ctl.simTime - (ctl.lastCommandedTime.get(t.id) || 0);
    const info = evaluateTankUrgency(
      world,
      owner,
      t,
      enemyField,
      profile,
      timeSince,
      ctl.enemyTracker,
      ctl.simTime,
    );
    if (info.urgency > maxUrgency) {
      maxUrgency = info.urgency;
      bestTank = t;
      bestUrgencyInfo = info;
    }
  }

  const currTimeSince = ctl.simTime - (ctl.lastCommandedTime.get(tank.id) || 0);
  const currUrgencyInfo = evaluateTankUrgency(
    world,
    owner,
    tank,
    enemyField,
    profile,
    currTimeSince,
    ctl.enemyTracker,
    ctl.simTime,
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
    ctl.reserveDeployTimer >= 2.0 &&
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
        const activeRole = ctl.tankRoles.get(tank.id);
        const cruisingSpeed =
          ctl.currentPlan === C.AI_STRATEGY_PLANS.DELTA || activeRole?.startsWith('SPEARHEAD')
            ? C.TANK_MAX_SPEED_KMH
            : Math.min(18, profile.maxSpeedKmh);
        applySafeCruisingTrim(world, owner, tank, cruisingSpeed);

        ctl.reserveDeployTimer = 0;
        ctl.sliceTimer = 0;
        applyAction(world, owner, 'SELECT', reserveToDeploy.number);
        applyAction(world, owner, 'FORWARD');
        ctl.note('DEPLOY', `Reserve tank ${reserveToDeploy.number} deploys (${myField.length}/${C.TANKS_ON_FIELD_MAX} on field)`, {
          key: 'deploy',
          gap: 1,
        });
        ctl.lastCommandedTime.set(reserveToDeploy.id, ctl.simTime);
        if (ctl.mobilizedTankIds) ctl.mobilizedTankIds.add(reserveToDeploy.id);
        return { tank, done: true };
      }
    }
  }

  // Dispatcher switch execution
  if (shouldSwitch && bestTank) {
    const activeRole = ctl.tankRoles.get(tank.id);
    const cruisingSpeed =
      ctl.currentPlan === C.AI_STRATEGY_PLANS.DELTA || activeRole?.startsWith('SPEARHEAD')
        ? C.TANK_MAX_SPEED_KMH
        : Math.min(18, profile.maxSpeedKmh);

    // Safe Cruising Course Projection
    const halted = applySafeCruisingTrim(world, owner, tank, cruisingSpeed);
    if (halted === 'veer') {
      ctl.note('AVOID', `T${tank.number} veers away from hazard ahead at creep speed before hand-off`, {
        key: `veer${tank.id}`,
        gap: 3,
      });
    } else if (halted) {
      ctl.note('AVOID', `T${tank.number} halted (hazard ahead) before hand-off`, {
        key: `halt${tank.id}`,
        gap: 3,
      });
    }

    // Switch selection
    const why = urgencyReason(bestUrgencyInfo);
    ctl.note(why.tag, `T${tank.number} -> T${bestTank.number}: ${why.text}`, { key: 'select', gap: 1.2 });
    applyAction(world, owner, 'SELECT', bestTank.number);
    tank = bestTank;
    ctl.sliceTimer = 0;
    ctl.lastCommandedTime.set(bestTank.id, ctl.simTime);
  }

  return { tank, done: false };
}
