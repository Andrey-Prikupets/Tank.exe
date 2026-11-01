import * as C from '../../constants.js';
import { gateX, selectedTank } from '../world.js';
import {
  getGateCorridorPose,
  getGateAmbushPose,
  isInEnemySlitGunSector,
  isSegmentInEnemySlitGunSector,
  MINE_LETHAL_RADIUS_M,
} from '../nav.js';
import { normalizeAngle, fuzz } from './math.js';
import { segmentVsObb, toLocal } from '../geometry.js';
import { assignBrigadeRoles, updateBrigadeRoles, getRoleWaypoint } from './roles.js';
import { leadPoint } from './aiming.js';

export function isPathClearOfPits(world, x0, y0, heading, dist = 24.0, enemyOwner = null) {
  const fx = x0 + Math.cos(heading) * dist;
  const fy = y0 + Math.sin(heading) * dist;

  // Arena boundary check (keep away from top/bottom walls and end walls outside gate lane)
  const inGateLane = Math.abs(fy - C.GATE_CENTER_Y_M) <= C.GATE_WIDTH_M / 2 + 1.0;
  if (fy < 6.5 || fy > C.FIELD_WIDTH_M - 6.5) return false;
  if ((fx < 6.5 || fx > C.FIELD_LENGTH_M - 6.5) && !inGateLane) return false;

  // Enemy slit gun sector check (unless already inside and moving farther away from enemy gate)
  if (enemyOwner != null) {
    const currentlyInSlit = isInEnemySlitGunSector(x0, y0, enemyOwner, 1.5);
    if (!currentlyInSlit && isSegmentInEnemySlitGunSector(x0, y0, fx, fy, enemyOwner, 1.5)) {
      return false;
    }
    if (currentlyInSlit) {
      const gx = gateX(enemyOwner);
      if (Math.abs(fx - gx) < Math.abs(x0 - gx) + 2.0) {
        return false;
      }
    }
  }

  if (world.pits && world.pits.length > 0) {
    for (const pit of world.pits) {
      const [tlx, tly] = toLocal(pit, x0, y0);
      const startInOuterPitMargin =
        Math.abs(tlx) < pit.l / 2 + 4.2 && Math.abs(tly) < pit.w / 2 + 4.2;
      if (startInOuterPitMargin) {
        // Already inside outer pit margin: allow heading if it moves away from pit and misses physical pit
        const corePit = {
          x: pit.x,
          y: pit.y,
          h: pit.h,
          l: pit.l + 2.4,
          w: pit.w + 2.4,
        };
        if (segmentVsObb(x0, y0, fx, fy, corePit) != null) return false;
        const startDist = Math.hypot(x0 - pit.x, y0 - pit.y);
        const endDist = Math.hypot(fx - pit.x, fy - pit.y);
        if (endDist < startDist + 1.0) return false;
      } else {
        const expPit = {
          x: pit.x,
          y: pit.y,
          h: pit.h,
          l: pit.l + 7.2,
          w: pit.w + 7.2,
        };
        if (segmentVsObb(x0, y0, fx, fy, expPit) != null) return false;
      }
    }
  }

  // Also check mines along the path using full corner-safe trigger clearance
  if (world.mines && world.mines.length > 0) {
    const probe = { x: x0, y: y0, heading };
    for (const m of world.mines) {
      const [mlx, mly] = toLocal(probe, m.x, m.y);
      const dm = Math.hypot(x0 - m.x, y0 - m.y);
      if (dm < MINE_LETHAL_RADIUS_M + 0.4) {
        // Already near mine: reject any heading where mine is not strictly behind the motion vector
        if (mlx > -0.5) return false;
      } else if (mlx > -1.0 && mlx < dist + 2.0 && Math.abs(mly) < MINE_LETHAL_RADIUS_M + 0.5) {
        return false;
      }
    }
  }

  return true;
}

function setProportionalTurn(t, desiredH, profile = null) {
  const errDeg = C.radToDeg(normalizeAngle(desiredH - t.heading));
  if (Math.abs(errDeg) > fuzz(3.5, profile, 1.0, 9.0)) {
    const maxTurn = t.cmdSpeedKmh === 0 ? C.TANK_MAX_PIVOT_TURN_DEG_S : C.TANK_MAX_TURN_DEG_S;
    const stepTurn = Math.round((errDeg * fuzz(1.8, profile, 1.0, 3.0)) / C.TURN_STEP_DEG_S) * C.TURN_STEP_DEG_S;
    t.cmdTurnDeg = Math.max(-maxTurn, Math.min(maxTurn, stepTurn || (errDeg > 0 ? 15 : -15)));
  } else {
    t.cmdTurnDeg = 0;
  }
}

/**
 * Per-tick parallel multi-tank controller for all unselected field units:
 * 1. Immediate hazard avoidance (enemy slit-gun sector escape, incoming shell evasion, mines, pits, boundaries).
 * 2. Parallel Wolfpack crossfire enveloping against active human attackers (2-3 units converge
 *    from -30 deg, 0 deg, +30 deg crossfire angles and pre-aim their hulls simultaneously).
 * 3. Forward Containment Arc positioning & gate exit pre-aiming when no enemy tanks are on the field.
 */
export function enforceUnselectedTanksSafety(ctl, world, myField, activeTank) {
  const owner = ctl.owner;
  const profile = ctl.profile || ctl.level || 'HARD';
  const maxSpd = ctl.profile?.maxSpeedKmh || 36;
  const enemyOwner = 1 - owner;
  const enemyGateX = gateX(enemyOwner);
  const enemyDir = enemyOwner === 0 ? 1 : -1;
  const enemyField = world.tanks.filter((t) => t.owner === enemyOwner && t.status === 'field');

  // Identify active moving enemies vs stationary/unattended enemies
  const movingEnemies = enemyField.filter((e) => Math.abs(e.speed || 0) > fuzz(1.0, profile, 0.2, 4.0));
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
    const offsets = [0, fuzz(0.52, profile, 0.25, 0.85), -fuzz(0.52, profile, 0.25, 0.85)];
    for (let i = 0; i < Math.min(3, armedSorted.length); i++) {
      wolfpackOffsets.set(armedSorted[i].id, offsets[i]);
    }
  }

  for (const t of myField) {
    if (t.status === 'field' && t.id !== activeTank?.id) {
      // 1. Immediate escape if inside enemy slit-gun firing sector
      if (isInEnemySlitGunSector(t.x, t.y, enemyOwner, 0.5)) {
        const escapeX = enemyGateX + enemyDir * fuzz(40.0, profile, 37.5, 46.0);
        const escapeY = t.y < C.GATE_CENTER_Y_M ? fuzz(28.0, profile, 20.0, 32.0) : fuzz(72.0, profile, 68.0, 80.0);
        const escapeAngle = Math.atan2(escapeY - t.y, escapeX - t.x);
        const errRad = normalizeAngle(escapeAngle - t.heading);
        if (
          Math.abs(errRad) > fuzz(1.45, profile, 1.0, 2.2) &&
          isPathClearOfPits(world, t.x, t.y, t.heading + Math.PI, 8.0)
        ) {
          t.cmdSpeedKmh = -6;
          t.cmdTurnDeg = -Math.sign(errRad || 1) * C.TANK_MAX_TURN_DEG_S;
        } else if (isPathClearOfPits(world, t.x, t.y, t.heading, 11.0)) {
          t.cmdSpeedKmh = maxSpd;
          setProportionalTurn(t, escapeAngle, profile);
        } else {
          t.cmdSpeedKmh = 0;
          setProportionalTurn(t, escapeAngle, profile);
        }
        continue;
      }

      // 2. Incoming shell evasion for unselected tanks (reaction reliability scales with difficulty noiseFactor)
      const noiseF = typeof profile === 'object' ? (profile.noiseFactor ?? 0.03) : 0.03;
      if (world.shells && world.shells.length > 0 && Math.random() > noiseF * 2.5) {
        let evadedShell = false;
        for (const s of world.shells) {
          if (s.owner !== owner) {
            const toMeX = t.x - s.x;
            const toMeY = t.y - s.y;
            const dist = Math.hypot(toMeX, toMeY);
            const remainingRange = C.SHELL_RANGE_M - (s.dist || 0) + 3.5;
            if (dist > 1.0 && dist < fuzz(28.0, profile, 14.0, 34.0) && dist <= remainingRange) {
              const dot = (s.dx * toMeX + s.dy * toMeY) / dist;
              const perpDist = Math.abs(s.dx * toMeY - s.dy * toMeX);
              if (dot > fuzz(0.88, profile, 0.72, 0.96) && perpDist < fuzz(3.8, profile, 2.2, 5.2)) {
                const cross = s.dx * toMeY - s.dy * toMeX;
                const evadeAngle = Math.atan2(s.dy, s.dx) + (cross >= 0 ? Math.PI / 2 : -Math.PI / 2);
                const headingParallelToShell = Math.abs(
                  s.dx * Math.cos(t.heading) + s.dy * Math.sin(t.heading),
                );
                if (
                  headingParallelToShell < fuzz(0.8, profile, 0.5, 0.95) &&
                  isPathClearOfPits(world, t.x, t.y, t.heading, 12.0, enemyOwner)
                ) {
                  t.cmdSpeedKmh = maxSpd;
                  setProportionalTurn(t, evadeAngle, profile);
                } else if (isPathClearOfPits(world, t.x, t.y, t.heading + Math.PI, 8.0, enemyOwner)) {
                  t.cmdSpeedKmh = -6;
                  t.cmdTurnDeg = C.TANK_MAX_TURN_DEG_S;
                } else {
                  t.cmdSpeedKmh = 0;
                  setProportionalTurn(t, evadeAngle, profile);
                }
                evadedShell = true;
                break;
              }
            }
          }
        }
        if (evadedShell) continue;
      }

      // 3. Forward hazard check on current heading (mines, pits, boundaries, enemy slit gun sector)
      const lookAhead = Math.max(fuzz(14.0, profile, 10.0, 20.0), Math.abs(t.speed) * fuzz(2.2, profile, 1.5, 3.2));
      if (t.cmdSpeedKmh > 0 && !isPathClearOfPits(world, t.x, t.y, t.heading, lookAhead, enemyOwner)) {
        let clearAngle = null;
        for (const off of [0.55, -0.55, 1.05, -1.05, 1.55, -1.55, 2.2, -2.2]) {
          if (isPathClearOfPits(world, t.x, t.y, t.heading + off, lookAhead + 4.0, enemyOwner)) {
            clearAngle = t.heading + off;
            break;
          }
        }
        if (clearAngle != null && isPathClearOfPits(world, t.x, t.y, t.heading, 10.0, enemyOwner)) {
          const errRad = normalizeAngle(clearAngle - t.heading);
          t.cmdTurnDeg = Math.sign(errRad) * C.TANK_MAX_TURN_DEG_S;
          t.cmdSpeedKmh = 12;
        } else {
          t.cmdSpeedKmh = 0;
          t.cmdTurnDeg = clearAngle != null
            ? Math.sign(normalizeAngle(clearAngle - t.heading) || 1) * C.TANK_MAX_PIVOT_TURN_DEG_S
            : C.TANK_MAX_PIVOT_TURN_DEG_S;
        }
        continue;
      }

      // 4. Containment & Gate Pre-Aiming when no enemy tanks are on the field
      if (t.shells > 0 && enemyField.length === 0) {
        const role = ctl.tankRoles.get(t.id) || 'PURSUER';
        const roleWp = getRoleWaypoint(t, role, ctl.currentPlan, owner, enemyGateX, ctl.simTime, world);
        const distToWp = Math.hypot(roleWp.x - t.x, roleWp.y - t.y);
        if (distToWp <= fuzz(5.5, profile, 3.0, 9.0)) {
          // Hold on the Forward Containment Arc and pre-aim hull directly at the enemy gate exit!
          // Use 6 km/h creep while turning > 12 deg (if 5m ahead is safe) to unlock 45 deg/s turn rate!
          const gateAimX = enemyGateX + enemyDir * fuzz(6.0, profile, 3.0, 12.0);
          const gateAimY = C.GATE_CENTER_Y_M;
          const aimH = Math.atan2(gateAimY - t.y, gateAimX - t.x);
          const aimErrDeg = Math.abs(C.radToDeg(normalizeAngle(aimH - t.heading)));
          const creepSafe =
            aimErrDeg > fuzz(12.0, profile, 5.0, 25.0) &&
            isPathClearOfPits(world, t.x, t.y, t.heading, 6.0, enemyOwner);
          t.cmdSpeedKmh = creepSafe ? 6 : 0;
          setProportionalTurn(t, aimH, profile);
        } else {
          const desiredH = Math.atan2(roleWp.y - t.y, roleWp.x - t.x);
          const errDeg = Math.abs(C.radToDeg(normalizeAngle(desiredH - t.heading)));
          const currentClear = isPathClearOfPits(world, t.x, t.y, t.heading, 14.0, enemyOwner);
          if (isPathClearOfPits(world, t.x, t.y, desiredH, 16.0, enemyOwner)) {
            if (errDeg > fuzz(20.0, profile, 10.0, 35.0) && !currentClear) {
              t.cmdSpeedKmh = 0;
              setProportionalTurn(t, desiredH, profile);
            } else {
              t.cmdSpeedKmh = distToWp > fuzz(14.0, profile, 8.0, 24.0) ? maxSpd : Math.min(18, maxSpd);
              setProportionalTurn(t, desiredH, profile);
            }
          } else {
            t.cmdSpeedKmh = 0;
            setProportionalTurn(t, desiredH, profile);
          }
        }
        continue;
      }

      // 5. Parallel combat steering & pre-aiming for armed unselected tanks when enemies are on field
      // On EASY/MEDIUM, higher noiseFactor causes noticeable command lag/hesitation on unselected units
      if (t.shells > 0 && enemyField.length > 0 && Math.random() > noiseF * 2.2) {
        let targetEnemy = null;
        let minScore = Infinity;
        for (const e of enemyField) {
          const d = Math.hypot(e.x - t.x, e.y - t.y);
          // Wolfpack members prioritize the active moving human tank; other tanks hunt nearest enemy
          const isWolfpackTarget = wolfpackOffsets.has(t.id) && Math.abs(e.speed || 0) > fuzz(1.0, profile, 0.2, 3.5);
          const score =
            d -
            (isWolfpackTarget
              ? fuzz(45.0, profile, 25.0, 65.0)
              : Math.abs(e.speed || 0) > fuzz(1.5, profile, 0.3, 4.0)
                ? fuzz(20.0, profile, 8.0, 35.0)
                : 0);
          if (score < minScore) {
            minScore = score;
            targetEnemy = e;
          }
        }

        if (targetEnemy) {
          const rawDist = Math.hypot(targetEnemy.x - t.x, targetEnemy.y - t.y);
          const effLead = ctl.profile ? (ctl.profile.leadFactor > 0 ? fuzz(ctl.profile.leadFactor, profile, 0, 1.2) : 0) : 1.0;
          const lead = leadPoint(t, targetEnemy.x, targetEnemy.y, targetEnemy.speed, targetEnemy.heading, effLead, targetEnemy.turn || 0);

          let desiredH = Math.atan2(lead.y - t.y, lead.x - t.x);
          let desiredSpeed = maxSpd;

          if (rawDist <= fuzz(50.0, profile, 28.0, 68.0)) {
            // Within 50m: pre-align hull gun directly onto enemy lead point so this tank is ready
            // for instant volley fire the moment the dispatcher selects it!
            const errDeg = Math.abs(C.radToDeg(normalizeAngle(desiredH - t.heading)));
            desiredSpeed =
              lead.muzzleDist > C.SHELL_RANGE_M - fuzz(1.0, profile, 0.2, 4.0)
                ? maxSpd
                : errDeg > fuzz(4.5, profile, 1.5, 12.0)
                  ? Math.min(18, maxSpd)
                  : 6;
          } else if (wolfpackOffsets.has(t.id) && Math.abs(targetEnemy.speed || 0) > fuzz(1.0, profile, 0.2, 3.5)) {
            // Beyond 50m: converge along assigned Wolfpack pincer crossfire angle (-30, 0, +30 deg)
            const angleToMe = Math.atan2(t.y - lead.y, t.x - lead.x);
            const crossfireAngle = angleToMe + wolfpackOffsets.get(t.id);
            const standoffR = fuzz(26.0, profile, 16.0, 36.0);
            const wpX = Math.max(12, Math.min(C.FIELD_LENGTH_M - 12, lead.x + Math.cos(crossfireAngle) * standoffR));
            const wpY = Math.max(12, Math.min(C.FIELD_WIDTH_M - 12, lead.y + Math.sin(crossfireAngle) * standoffR));
            if (!isInEnemySlitGunSector(wpX, wpY, enemyOwner)) {
              desiredH = Math.atan2(wpY - t.y, wpX - t.x);
            }
            desiredSpeed = maxSpd;
          } else {
            // Non-wolfpack tank beyond 50m: let role waypoint / flank approach guide it
            continue;
          }

          const checkDist = Math.max(fuzz(14.0, profile, 10.0, 20.0), (desiredSpeed / 3.6) * fuzz(1.5, profile, 1.0, 2.2));
          const errDegAbs = Math.abs(C.radToDeg(normalizeAngle(desiredH - t.heading)));
          const currentHeadingClear = isPathClearOfPits(
            world,
            t.x,
            t.y,
            t.heading,
            Math.max(11.0, Math.abs(t.speed) * 1.8),
            enemyOwner,
          );

          if (isPathClearOfPits(world, t.x, t.y, desiredH, checkDist, enemyOwner)) {
            if (errDegAbs > fuzz(18.0, profile, 10.0, 30.0) && !currentHeadingClear) {
              // Current heading has a mine/pit/slit hazard ahead! Stop and pivot in place first
              // instead of accelerating forward into the hazard while turning.
              t.cmdSpeedKmh = 0;
              setProportionalTurn(t, desiredH, profile);
            } else {
              t.cmdSpeedKmh = desiredSpeed;
              setProportionalTurn(t, desiredH, profile);
            }
          } else {
            // Desired combat vector enters a hazard or enemy slit-gun sector:
            // Hold outside the sector (using 6 km/h creep if 6m ahead is safe so turn rate is 45 deg/s) and aim at target!
            const creepSafe =
              errDegAbs > fuzz(12.0, profile, 5.0, 25.0) &&
              isPathClearOfPits(world, t.x, t.y, t.heading, 6.0, enemyOwner);
            t.cmdSpeedKmh = creepSafe ? 6 : 0;
            setProportionalTurn(t, desiredH, profile);
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

  if (ctl.commanderTimer < fuzz(C.AI_COMMANDER_EVAL_INTERVAL_S, profile, 0.72, 2.5)) return;
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
        const nearEnemy = enemyField.some((e) => Math.hypot(e.x - t.x, e.y - t.y) <= fuzz(50.0, profile, 28.0, 68.0));
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
          const forwardLookAhead = Math.max(fuzz(18.0, profile, 12.0, 26.0), Math.abs(t.speed) * fuzz(3.0, profile, 1.8, 4.2));
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
    (e) => Math.abs(e.x - myGateX) <= fuzz(C.AI_PLAN_DEFENSE_TRIGGER_DIST_M, profile, 25.0, 65.0),
  ).length;
  const gateThreat =
    closestEnemyDist <= fuzz(C.AI_PLAN_DEFENSE_INNER_DIST_M, profile, 20.0, 50.0) ||
    nearThreats >= C.AI_PLAN_DEFENSE_MIN_THREATS;
  const pursuitCond =
    enemyField.length > 0 &&
    (enemyAvgAmmo <= fuzz(C.AI_PURSUIT_AMMO_THRESHOLD, profile, 0.1, 1.2) ||
      (enemyField.length <= 1 && myField.length >= 3));
  const pursuitWhy =
    enemyAvgAmmo <= C.AI_PURSUIT_AMMO_THRESHOLD ? 'enemy out of ammo' : 'enemy nearly eliminated';
  const calm = recentCasualties < C.AI_CASUALTY_RETREAT_COUNT;
  const minDwell = fuzz(C.AI_PLAN_MIN_DWELL_S, profile, 2.0, 8.0);
  let planReason = '';

  if (gateThreat && prevPlan !== P.CHARLIE && (dwell >= 0.75 || ctl.planSince === 0)) {
    ctl.currentPlan = P.CHARLIE; // Base Defense
    planReason = `${nearThreats} enemy near gate, nearest ${closestEnemyDist.toFixed(0)} m`;
  } else if (prevPlan === P.CHARLIE) {
    if (!gateThreat && closestEnemyDist >= fuzz(C.AI_PLAN_DEFENSE_CLEAR_DIST_M, profile, 40.0, 75.0) && dwell >= minDwell) {
      ctl.currentPlan = P.ALPHA; // Disengage Defense
      planReason = 'gate threat cleared';
    }
  } else if (!calm && prevPlan !== P.ALPHA && dwell >= 0.75) {
    ctl.currentPlan = P.ALPHA; // Regroup with Standoff
    planReason = `${recentCasualties} tanks lost recently - regroup`;
  } else if (prevPlan === P.DELTA) {
    if (!pursuitCond && dwell >= minDwell) {
      ctl.currentPlan = P.ALPHA;
      planReason = 'pursuit condition ended';
    }
  } else if (prevPlan === P.BRAVO) {
    if (pursuitCond && dwell >= 0.75) {
      ctl.currentPlan = P.DELTA;
      planReason = pursuitWhy;
    } else if ((myField.length < C.AI_WEDGE_MIN_TANKS && dwell >= 0.75) || dwell >= fuzz(C.AI_WEDGE_MAX_DURATION_S, profile, 10.0, 32.0)) {
      ctl.currentPlan = P.ALPHA;
      planReason = myField.length < C.AI_WEDGE_MIN_TANKS ? 'wedge depleted' : 'wedge assault timed out';
    }
  } else if (calm && (dwell >= 0.75 || ctl.planSince === 0)) {
    // Alpha
    if (pursuitCond) {
      ctl.currentPlan = P.DELTA; // Pursuit
      planReason = pursuitWhy;
    } else if (myField.length >= C.AI_WEDGE_MIN_TANKS && Math.sin(ctl.simTime * 0.12) > fuzz(0.75, profile, 0.5, 0.92)) {
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