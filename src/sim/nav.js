import * as C from '../constants.js';
import { segmentVsObb, toLocal } from './geometry.js';
import { gateX, inwardDir, windowY, applyAction } from './world.js';

// =============================================================================
// NAVIGATION & PATHFINDING CONSTANTS
// =============================================================================

export const COST_OPEN = 1;
export const COST_CAUTION = 4;
export const COST_HOUSE = 12;
export const COST_LETHAL = 255; // Pits and Mines (impassable)

export const TANK_COLLISION_RADIUS_M = Math.hypot(C.TANK_LENGTH_M / 2, C.TANK_WIDTH_M / 2); // ~3.61m
export const MINE_LETHAL_RADIUS_M = C.TANK_WIDTH_M / 2 + C.MINE_TRIGGER_RADIUS_M + 0.6;   // ~3.60m
export const PIT_LETHAL_MARGIN_M = 1.6;

export const GRID_CELL_SIZE_M = 2.0; // 250m x 100m -> 125 x 50 grid cells
export const GRID_COLS = Math.ceil(C.FIELD_LENGTH_M / GRID_CELL_SIZE_M);
export const GRID_ROWS = Math.ceil(C.FIELD_WIDTH_M / GRID_CELL_SIZE_M);

function normalizeAngle(a) {
  if (!Number.isFinite(a)) return 0;
  a = a % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// =============================================================================
// 1. TACTICAL COST GRID (Macro-Scale Obstacle & Hazard Modeling)
// =============================================================================

export class NavigationGrid {
  constructor() {
    this.cols = GRID_COLS;
    this.rows = GRID_ROWS;
    this.cellSize = GRID_CELL_SIZE_M;
    this.data = new Uint8Array(this.cols * this.rows);
  }

  coordToCell(x, y) {
    const col = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);
    return [col, row];
  }

  cellIndex(col, row) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return -1;
    return row * this.cols + col;
  }

  getCostAt(x, y) {
    const inGate = Math.abs(y - C.GATE_CENTER_Y_M) <= C.GATE_WIDTH_M / 2 + 0.6;
    if (x < 0) {
      return inGate && x >= -C.AI_REARM_PENETRATION_DEPTH_M - 2 ? COST_OPEN : COST_LETHAL;
    }
    if (x > C.FIELD_LENGTH_M) {
      return inGate && x <= C.FIELD_LENGTH_M + C.AI_REARM_PENETRATION_DEPTH_M + 2 ? COST_OPEN : COST_LETHAL;
    }
    if (y < 0 || y > C.FIELD_WIDTH_M) {
      return COST_LETHAL;
    }
    const [col, row] = this.coordToCell(x, y);
    const idx = this.cellIndex(col, row);
    return idx === -1 ? COST_LETHAL : this.data[idx];
  }

  isLethal(x, y) {
    return this.getCostAt(x, y) === COST_LETHAL;
  }

  /**
   * Rebuilds cost grid based on static terrain and dynamic hazard state.
   */
  update(world) {
    this.data.fill(COST_OPEN);

    // 1. Border Walls (with 7m gate openings preserved)
    for (let r = 0; r < this.rows; r++) {
      const cy = (r + 0.5) * this.cellSize;
      const inGateZone = Math.abs(cy - C.GATE_CENTER_Y_M) < C.GATE_WIDTH_M / 2 + 1.0;
      if (!inGateZone) {
        this.data[r * this.cols] = COST_HOUSE;
        this.data[r * this.cols + (this.cols - 1)] = COST_HOUSE;
      }
    }
    for (let c = 0; c < this.cols; c++) {
      this.data[c] = COST_HOUSE;
      this.data[(this.rows - 1) * this.cols + c] = COST_HOUSE;
    }

    // 2. Houses / Building Obstacles (Soft Obstacles: Traversable with drag cost)
    if (world.obstacles && world.obstacles.length > 0) {
      for (const ob of world.obstacles) {
        const radius = Math.hypot(ob.l, ob.w) / 2 + TANK_COLLISION_RADIUS_M;
        const minX = Math.max(0, ob.x - radius);
        const maxX = Math.min(C.FIELD_LENGTH_M, ob.x + radius);
        const minY = Math.max(0, ob.y - radius);
        const maxY = Math.min(C.FIELD_WIDTH_M, ob.y + radius);

        const [c0, r0] = this.coordToCell(minX, minY);
        const [c1, r1] = this.coordToCell(maxX, maxY);

        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const cx = (c + 0.5) * this.cellSize;
            const cy = (r + 0.5) * this.cellSize;
            const [lx, ly] = toLocal(ob, cx, cy);

            const inHouse = Math.abs(lx) < ob.l / 2 + 1.2 && Math.abs(ly) < ob.w / 2 + 1.2;
            const inCaution = Math.abs(lx) < ob.l / 2 + 3.0 && Math.abs(ly) < ob.w / 2 + 3.0;

            const idx = this.cellIndex(c, r);
            if (idx === -1) continue;

            if (inHouse) {
              this.data[idx] = Math.max(this.data[idx], COST_HOUSE);
            } else if (inCaution && this.data[idx] < COST_CAUTION) {
              this.data[idx] = COST_CAUTION;
            }
          }
        }
      }
    }

    // 3. Pits (FATAL Hazards: Strict Infinite / 255 Cost)
    if (world.pits && world.pits.length > 0) {
      for (const pit of world.pits) {
        const radius = Math.hypot(pit.l, pit.w) / 2 + TANK_COLLISION_RADIUS_M + 1.0;
        const minX = Math.max(0, pit.x - radius);
        const maxX = Math.min(C.FIELD_LENGTH_M, pit.x + radius);
        const minY = Math.max(0, pit.y - radius);
        const maxY = Math.min(C.FIELD_WIDTH_M, pit.y + radius);

        const [c0, r0] = this.coordToCell(minX, minY);
        const [c1, r1] = this.coordToCell(maxX, maxY);

        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const cx = (c + 0.5) * this.cellSize;
            const cy = (r + 0.5) * this.cellSize;
            const [lx, ly] = toLocal(pit, cx, cy);

            // Pit overlap threshold margin
            const marginL = pit.l / 2 + PIT_LETHAL_MARGIN_M;
            const marginW = pit.w / 2 + PIT_LETHAL_MARGIN_M;

            if (Math.abs(lx) < marginL && Math.abs(ly) < marginW) {
              const idx = this.cellIndex(c, r);
              if (idx !== -1) this.data[idx] = COST_LETHAL;
            }
          }
        }
      }
    }

    // 4. Mines (FATAL Hazards: Strict Infinite / 255 Cost)
    if (world.mines && world.mines.length > 0) {
      for (const m of world.mines) {
        const minX = Math.max(0, m.x - MINE_LETHAL_RADIUS_M);
        const maxX = Math.min(C.FIELD_LENGTH_M, m.x + MINE_LETHAL_RADIUS_M);
        const minY = Math.max(0, m.y - MINE_LETHAL_RADIUS_M);
        const maxY = Math.min(C.FIELD_WIDTH_M, m.y + MINE_LETHAL_RADIUS_M);

        const [c0, r0] = this.coordToCell(minX, minY);
        const [c1, r1] = this.coordToCell(maxX, maxY);

        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const cx = (c + 0.5) * this.cellSize;
            const cy = (r + 0.5) * this.cellSize;
            if (Math.hypot(cx - m.x, cy - m.y) <= MINE_LETHAL_RADIUS_M) {
              const idx = this.cellIndex(c, r);
              if (idx !== -1) this.data[idx] = COST_LETHAL;
            }
          }
        }
      }
    }
  }
}

// =============================================================================
// 2. TARGET MANEUVER & CURVILINEAR INTERCEPT PREDICTOR
// =============================================================================

/**
 * Predicts target state accounting for linear speed, heading, and angular yaw rate.
 */
export function predictTargetCurvilinear(target, dt) {
  if (!target) return null;
  const speed = target.speed || 0;
  const heading = target.heading || 0;
  const omega = target.turn || 0;

  if (Math.abs(omega) > 0.04 && Math.abs(speed) > 0.3) {
    // Curvilinear circular arc projection
    const dTheta = omega * dt;
    const endHeading = normalizeAngle(heading + dTheta);
    const endX = target.x + (speed / omega) * (Math.sin(endHeading) - Math.sin(heading));
    const endY = target.y - (speed / omega) * (Math.cos(endHeading) - Math.cos(heading));
    return {
      x: Math.max(4, Math.min(C.FIELD_LENGTH_M - 4, endX)),
      y: Math.max(4, Math.min(C.FIELD_WIDTH_M - 4, endY)),
      heading: endHeading,
      speed,
      omega,
    };
  }

  // Straight line dead-reckoning projection
  return {
    x: Math.max(4, Math.min(C.FIELD_LENGTH_M - 4, target.x + Math.cos(heading) * speed * dt)),
    y: Math.max(4, Math.min(C.FIELD_WIDTH_M - 4, target.y + Math.sin(heading) * speed * dt)),
    heading,
    speed,
    omega: 0,
  };
}

/**
 * Returns true if (x, y) is inside the lethal firing sector of the enemy base slit guns.
 * For enemy base at gateX(enemyOwner):
 * - Slit windows are at y=42 and y=58. Firing range is up to 55m into the field.
 * - Direct frontal corridor y in [39, 61] within 45m is heavily dangerous.
 * - 45-degree yaw cones from each window extend to [42 - dx*0.95, 42 + dx*0.95] and [58 - dx*0.95, 58 + dx*0.95].
 * - Lateral positions hugging the wall (dx in [5, 14], y <= 35 or y >= 65) are SAFE outside the traverse arc.
 */
export function isInEnemySlitGunSector(x, y, enemyOwner, marginM = 2.0) {
  const gx = gateX(enemyOwner);
  const dir = enemyOwner === 0 ? 1 : -1;
  const dx = (x - gx) * dir; // distance into field from enemy wall

  // Behind wall or beyond max physical reach (+ margin) is safe
  if (dx < 1.0 || dx > C.SHELL_RANGE_M + marginM) return false;

  // Safe edge crawl corridors along North and South arena boundaries
  // Slit guns at y=42/58 with +/-45 deg traverse cannot hit y <= 9.0 or y >= 91.0
  if (y <= 9.0 || y >= C.FIELD_WIDTH_M - 9.0) {
    return false;
  }

  // Direct frontal gate channel is deadly
  if (dx <= 28.0 && y >= 36.0 && y <= 64.0) {
    return true;
  }

  // Reach limit
  const maxReachSq = (C.SHELL_RANGE_M + marginM) ** 2;

  // Window 0 (y = 42)
  const dy0 = Math.abs(y - 42.0);
  if (dy0 <= dx + 1.0 && dx * dx + dy0 * dy0 <= maxReachSq) {
    return true;
  }

  // Window 1 (y = 58)
  const dy1 = Math.abs(y - 58.0);
  if (dy1 <= dx + 1.0 && dx * dx + dy1 * dy1 <= maxReachSq) {
    return true;
  }

  return false;
}

/**
 * Computes safe tactical gate ambush coordinates outside the enemy slit gun sector,
 * with gun orientation aimed directly across the gate doorway to eliminate outgoing tanks.
 */
export function getGateAmbushPose(tank, owner, preferredFlank = 'AUTO') {
  const enemyOwner = 1 - owner;
  const gx = gateX(enemyOwner);
  const dir = enemyOwner === 0 ? 1 : -1;

  let useNorth = false;
  if (preferredFlank === 'NORTH') {
    useNorth = true;
  } else if (preferredFlank === 'SOUTH') {
    useNorth = false;
  } else {
    useNorth = tank.y < C.GATE_CENTER_Y_M;
  }

  // Ambush post: 8.5m into field from enemy wall, y=30.0 (North) or y=70.0 (South)
  // This is strictly outside the 45-degree traverse cone of both slit guns (y=42, 58)
  const ambushX = gx + dir * 8.5;
  const ambushY = useNorth ? 30.0 : 70.0;

  // Outgoing enemy tanks emerge at gate threshold (gx + dir * 2.0, 50.0)
  const doorwayAimX = gx + dir * 2.0;
  const doorwayAimY = C.GATE_CENTER_Y_M;
  const aimHeading = Math.atan2(doorwayAimY - ambushY, doorwayAimX - ambushX);

  const distToAmbush = Math.hypot(ambushX - tank.x, ambushY - tank.y);
  const isAtAmbush = distToAmbush < 3.5;

  return {
    targetX: ambushX,
    targetY: ambushY,
    doorwayAimX,
    doorwayAimY,
    aimHeading,
    isAtAmbush,
    flank: useNorth ? 'NORTH' : 'SOUTH',
  };
}

/**
 * Computes optimal tactical attack standoff vantage position outside enemy's forward gun arc
 * and strictly outside enemy hangar slit gun firing cones.
 */
export function getAttackStandoffWaypoint(tank, target, world, profile, simTime = 0) {
  const enemyOwner = 1 - tank.owner;
  const enemyGate = gateX(enemyOwner);
  const distToEnemyGate = Math.abs(target.x - enemyGate);

  // If target is inside enemy hangar or emerging near gate: take up gate ambush position!
  if (distToEnemyGate <= 20.0 || target.x < 0 || target.x > C.FIELD_LENGTH_M) {
    const ambushPose = getGateAmbushPose(tank, tank.owner);
    return {
      x: ambushPose.targetX,
      y: ambushPose.targetY,
      predTarget: target,
      isGateAmbush: true,
      aimHeading: ambushPose.aimHeading,
    };
  }

  const dist = Math.hypot(target.x - tank.x, target.y - tank.y);
  const mySpeed = Math.max(4, Math.abs(tank.speed));
  const tIntercept = Math.min(3.0, dist / (mySpeed + Math.max(1, Math.abs(target.speed))));

  const predTarget = predictTargetCurvilinear(target, tIntercept);
  const standoffJitter = (Math.random() - 0.5) * 2.5;
  const standoffDist = Math.max(10, Math.min(22, (profile.standoffDist || 18) + standoffJitter));

  // Candidate attack angles around predicted target: prefer lateral angles (flanking) with organic asymmetry
  const ownerBias = tank.owner === 0 ? 0.35 : -0.35;
  const tankPhase = (tank.id % 5) * 0.45 + simTime * 0.25;
  const candidateOffsets = [
    Math.PI + ownerBias,
    Math.PI + 0.65 + Math.sin(tankPhase) * 0.25,
    Math.PI - 0.65 - Math.sin(tankPhase) * 0.25,
    Math.PI + 1.25 + (Math.random() - 0.5) * 0.2,
    Math.PI - 1.25 + (Math.random() - 0.5) * 0.2,
  ];

  let bestWaypoint = null;
  let bestScore = -Infinity;

  for (const angleOffset of candidateOffsets) {
    const candidateAngle = normalizeAngle(predTarget.heading + angleOffset);
    const wx = predTarget.x + Math.cos(candidateAngle) * standoffDist;
    const wy = predTarget.y + Math.sin(candidateAngle) * standoffDist;

    // Field bounds check
    if (wx < 8 || wx > C.FIELD_LENGTH_M - 8 || wy < 8 || wy > C.FIELD_WIDTH_M - 8) {
      continue;
    }

    // Do NOT select standoff positions inside the enemy slit gun sector!
    if (isInEnemySlitGunSector(wx, wy, enemyOwner)) {
      continue;
    }

    // Check if line of fire from waypoint to target is clear
    let losBlocked = false;
    if (world.obstacles) {
      for (const ob of world.obstacles) {
        const hit = segmentVsObb(wx, wy, predTarget.x, predTarget.y, ob);
        if (hit != null && hit > 0.05 && hit < 0.95) {
          losBlocked = true;
          break;
        }
      }
    }
    if (losBlocked) continue;

    // Check if waypoint is inside lethal pit
    let pitBlocked = false;
    if (world.pits) {
      for (const pit of world.pits) {
        const [plx, ply] = toLocal(pit, wx, wy);
        if (Math.abs(plx) < pit.l / 2 + 2.0 && Math.abs(ply) < pit.w / 2 + 2.0) {
          pitBlocked = true;
          break;
        }
      }
    }
    if (pitBlocked) continue;

    const travelDist = Math.hypot(wx - tank.x, wy - tank.y);
    const threatAngle = Math.abs(normalizeAngle(candidateAngle - (predTarget.heading + Math.PI)));
    const noise = (Math.random() - 0.5) * 8.0;
    // Higher score for clear flanking positions with shorter travel + organic noise
    const score = 100 - travelDist * 1.5 + threatAngle * 10 + noise;

    if (score > bestScore) {
      bestScore = score;
      bestWaypoint = { x: wx, y: wy, predTarget };
    }
  }

  if (!bestWaypoint) {
    const gx = gateX(enemyOwner);
    const dir = enemyOwner === 0 ? 1 : -1;
    const safeX = gx + dir * 34.0;
    const safeY = tank.y <= C.GATE_CENTER_Y_M ? 7.5 : 92.5;
    return { x: safeX, y: safeY, predTarget };
  }

  return bestWaypoint;
}

// =============================================================================
// 3. GATE PASSAGE MUTEX & TWO-STAGE CORRIDOR CONTROLLER
// =============================================================================

export class GateReservationManager {
  constructor() {
    this.reservedTankId = [null, null]; // [owner 0, owner 1]
    this.reservationTime = [0, 0];
  }

  requestGate(owner, tankId, simTime) {
    if (this.reservedTankId[owner] === tankId) {
      this.reservationTime[owner] = simTime;
      return true;
    }
    // Token timeout after 6 seconds
    if (this.reservedTankId[owner] == null || simTime - this.reservationTime[owner] > 6.0) {
      this.reservedTankId[owner] = tankId;
      this.reservationTime[owner] = simTime;
      return true;
    }
    return false;
  }

  releaseGate(owner, tankId) {
    if (this.reservedTankId[owner] === tankId) {
      this.reservedTankId[owner] = null;
      this.reservationTime[owner] = 0;
    }
  }

  reset(owner) {
    if (owner != null) {
      this.reservedTankId[owner] = null;
      this.reservationTime[owner] = 0;
    } else {
      this.reservedTankId = [null, null];
      this.reservationTime = [0, 0];
    }
  }

  isGateReservedByOther(owner, tankId) {
    return this.reservedTankId[owner] != null && this.reservedTankId[owner] !== tankId;
  }
}

export const gateReservationManager = new GateReservationManager();

/**
 * Computes corridor docking target for precise gate passage.
 */
export function getGateCorridorPose(tank, owner, simTime) {
  const myGateX = gateX(owner);
  const inward = inwardDir(owner);
  const distToGate = inward * (tank.x - myGateX);
  const lateralOffset = Math.abs(tank.y - C.GATE_CENTER_Y_M);
  const hangarHeading = owner === 0 ? Math.PI : 0;
  const headingErr = Math.abs(normalizeAngle(hangarHeading - tank.heading));

  const hasAccess = gateReservationManager.requestGate(owner, tank.id, simTime);

  // If another friendly tank is currently occupying the gate, hold at standoff staging point
  if (!hasAccess) {
    const stagingY = tank.y < C.GATE_CENTER_Y_M ? 32.0 : 68.0;
    return {
      targetX: myGateX + inward * 26.0,
      targetY: stagingY,
      speedLimitKmh: 18,
      isDoorwayMode: false,
      isHolding: true,
    };
  }

  // Zone 2: In corridor approach or doorway ($distToGate \le 26m$, laterally aligned)
  // Target penetrates deep into the hangar so heading vector pulls directly through doorway.
  if (distToGate <= C.AI_REARM_STANDOFF_DIST_M + 4.0 && lateralOffset <= 2.6) {
    const isDoorway = distToGate <= 16.0 && lateralOffset <= 1.6 && headingErr <= 0.45;
    return {
      targetX: myGateX - inward * C.AI_REARM_PENETRATION_DEPTH_M,
      targetY: C.GATE_CENTER_Y_M,
      speedLimitKmh: 18,
      isDoorwayMode: isDoorway,
      isHolding: false,
    };
  }

  // Zone 1: Approach Funnel (Steer to external standoff alignment point)
  return {
    targetX: myGateX + inward * C.AI_REARM_STANDOFF_DIST_M,
    targetY: C.GATE_CENTER_Y_M,
    speedLimitKmh: 18,
    isDoorwayMode: false,
    isHolding: false,
  };
}

// =============================================================================
// 4. KINEMATIC TRAJECTORY ROLLOUT (DYNAMIC WINDOW APPROACH)
// =============================================================================

/**
 * Predicts bounding line segment / capsule for time-to-collision evaluations.
 */
export function predictTankFuturePosition(tank, dt) {
  const sp = tank.speed || 0;
  const h = tank.heading || 0;
  return {
    x: tank.x + Math.cos(h) * sp * dt,
    y: tank.y + Math.sin(h) * sp * dt,
  };
}

/**
 * Evaluates reachable kinematic trajectory arcs to maintain high speed, avoid lethal hazards,
 * avoid friendly team collisions, and steer around or through obstacles.
 */
export function evaluateKinematicTrajectoryArcs(
  tank,
  world,
  navGrid,
  targetWaypoint,
  profile,
  options = {},
) {
  const maxSpeedKmh = options.maxSpeedOverride || profile.maxSpeedKmh || 36;
  const isDoorwayMode = options.isDoorwayMode || false;
  const targetDist = Math.hypot(targetWaypoint.x - tank.x, targetWaypoint.y - tank.y);

  // If in strict gate doorway mode, lock turn rate to 0 and cruise straight
  if (isDoorwayMode) {
    return {
      bestSpeedKmh: Math.min(18, maxSpeedKmh),
      bestTurnDeg: 0,
      bestScore: 1000,
    };
  }

  // Candidate commands
  const candidateTurns = [-45, -30, -15, 0, 15, 30, 45];
  const candidateSpeeds = [maxSpeedKmh, Math.min(18, maxSpeedKmh), 0];
  if (targetDist < 6.0 || isInEnemySlitGunSector(tank.x, tank.y, 1 - tank.owner)) {
    candidateSpeeds.push(-6);
  }

  let bestScore = -Infinity;
  let bestSpeedKmh = maxSpeedKmh;
  let bestTurnDeg = 0;

  const horizonSec = 1.8;
  const simSteps = 6;
  const dtStep = horizonSec / simSteps;

  const otherTanks = world.tanks.filter(
    (t) => t.id !== tank.id && t.status === 'field',
  );

  for (const cmdSpeed of candidateSpeeds) {
    for (const cmdTurn of candidateTurns) {
      let simX = tank.x;
      let simY = tank.y;
      let simHeading = tank.heading;
      let simSpeedMs = C.kmhToMs(cmdSpeed);
      const simTurnRad = C.degToRad(cmdTurn);

      let lethalCollision = false;
      let houseContactCount = 0;
      let enemySlitSectorContact = 0;
      let minFriendlyDist = Infinity;
      let minEnemyDist = Infinity;

      for (let step = 1; step <= simSteps; step++) {
        simHeading += simTurnRad * dtStep;
        simX += Math.cos(simHeading) * simSpeedMs * dtStep;
        simY += Math.sin(simHeading) * simSpeedMs * dtStep;

        // 1. Boundary & Lethal Hazards (Cost Grid check)
        const cost = navGrid ? navGrid.getCostAt(simX, simY) : COST_OPEN;
        if (cost === COST_LETHAL) {
          lethalCollision = true;
          break;
        }
        if (cost >= COST_HOUSE) {
          houseContactCount++;
        }

        // Direct Pit geometry verification
        if (world.pits) {
          for (const pit of world.pits) {
            const [plx, ply] = toLocal(pit, simX, simY);
            if (
              Math.abs(plx) < pit.l / 2 + PIT_LETHAL_MARGIN_M &&
              Math.abs(ply) < pit.w / 2 + PIT_LETHAL_MARGIN_M
            ) {
              lethalCollision = true;
              break;
            }
          }
        }
        if (lethalCollision) break;

        // Direct Mine geometry verification
        if (world.mines) {
          for (const m of world.mines) {
            if (Math.hypot(simX - m.x, simY - m.y) < MINE_LETHAL_RADIUS_M) {
              lethalCollision = true;
              break;
            }
          }
        }
        if (lethalCollision) break;

        // 2. Multi-Tank Fleet Collision Avoidance (TTC)
        const timeElapsed = step * dtStep;
        for (const other of otherTanks) {
          const otherFuture = predictTankFuturePosition(other, timeElapsed);
          const dOther = Math.hypot(simX - otherFuture.x, simY - otherFuture.y);
          if (other.owner === tank.owner) {
            if (dOther < minFriendlyDist) minFriendlyDist = dOther;
          } else {
            if (dOther < minEnemyDist) minEnemyDist = dOther;
          }
        }

        // 3. Enemy Slit Gun Hit Sector Avoidance (when not entering own gate)
        if (!isDoorwayMode && isInEnemySlitGunSector(simX, simY, 1 - tank.owner)) {
          enemySlitSectorContact++;
        }
      }

      // Hard lethal hazards: instant rejection!
      if (lethalCollision) {
        continue;
      }

      // Slit gun sector entry rejection: if tank is currently outside enemy slit sector,
      // never choose a trajectory that drives into it!
      if (!isDoorwayMode && enemySlitSectorContact > 0) {
        if (!isInEnemySlitGunSector(tank.x, tank.y, 1 - tank.owner)) {
          continue;
        }
      }

      // Friendly tank collision avoidance penalty
      let friendlyPenalty = 0;
      if (minFriendlyDist < 6.0) {
        friendlyPenalty = 600 * (1 - minFriendlyDist / 6.0);
      }

      // Soft house contact penalty: allowed, but penalized proportionally
      const housePenalty = houseContactCount * 18.0;

      // Enemy slit gun hit sector avoidance penalty
      const enemySlitPenalty = enemySlitSectorContact * 600.0;

      // Progress to target
      const endDist = Math.hypot(targetWaypoint.x - simX, targetWaypoint.y - simY);
      const progress = targetDist - endDist;

      // Heading alignment toward target
      const angleToTarget = Math.atan2(targetWaypoint.y - simY, targetWaypoint.x - simX);
      const headingDiff = Math.abs(normalizeAngle(angleToTarget - simHeading));
      const alignmentBonus = (1 - headingDiff / Math.PI) * 35.0;

      // Speed maintenance bonus: reward maintaining high cruising speed on HARD
      const speedBonus = (cmdSpeed / 36) * 15.0;

      // Steering smoothness bonus: prefer smaller turn adjustments
      const turnEffort = (Math.abs(cmdTurn - tank.cmdTurnDeg) / 45) * 4.0;

      // Organic asymmetry & noise bonus: breaks CvC mirror symmetry
      const simTime = options.simTime || 0;
      const ownerSign = tank.owner === 0 ? 1 : -1;
      const personalityBias = Math.sin((tank.id * 1.7) + ownerSign * 1.35 + simTime * 0.45);
      const asymmetryBonus = personalityBias * (cmdTurn / 45) * 4.0;
      const noise = (Math.random() - 0.5) * 4.0;

      const totalScore =
        progress * 18.0 +
        alignmentBonus +
        speedBonus +
        asymmetryBonus +
        noise -
        housePenalty -
        friendlyPenalty -
        enemySlitPenalty -
        turnEffort;

      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestSpeedKmh = cmdSpeed;
        bestTurnDeg = cmdTurn;
      }
    }
  }

  return {
    bestSpeedKmh,
    bestTurnDeg,
    bestScore,
  };
}

/**
 * Issues step-by-step game actions to achieve desired speed and turn commands.
 * Strictly bounded to prevent infinite loops even if vehicle limits clamp values.
 */
export function applyKinematicCommands(world, owner, tank, targetSpeedKmh, targetTurnDeg) {
  if (!tank || tank.status !== 'field') return;

  // Speed adjustments first (including STOP) so STOP does not wipe out turn command
  if (targetSpeedKmh === 0 && tank.cmdSpeedKmh > 0) {
    applyAction(world, owner, 'STOP');
  } else {
    for (let i = 0; i < 6 && tank.cmdSpeedKmh < targetSpeedKmh; i++) {
      applyAction(world, owner, 'FORWARD');
    }
    for (let i = 0; i < 6 && tank.cmdSpeedKmh > targetSpeedKmh; i++) {
      applyAction(world, owner, 'BACK');
    }
  }

  // Turn rate adjustments after speed adjustment
  const maxLimit = tank.cmdSpeedKmh === 0 ? C.TANK_MAX_PIVOT_TURN_DEG_S : C.TANK_MAX_TURN_DEG_S;
  const clampedTurn = Math.max(-maxLimit, Math.min(maxLimit, Math.round(targetTurnDeg / C.TURN_STEP_DEG_S) * C.TURN_STEP_DEG_S));

  for (let i = 0; i < 6 && tank.cmdTurnDeg < clampedTurn; i++) {
    applyAction(world, owner, 'TURN_R');
  }
  for (let i = 0; i < 6 && tank.cmdTurnDeg > clampedTurn; i++) {
    applyAction(world, owner, 'TURN_L');
  }
}
