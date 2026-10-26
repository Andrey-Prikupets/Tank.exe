import assert from 'node:assert';
import * as C from '../src/constants.js';
import {
  NavigationGrid,
  COST_OPEN,
  COST_HOUSE,
  COST_LETHAL,
  predictTargetCurvilinear,
  getAttackStandoffWaypoint,
  GateReservationManager,
  getGateCorridorPose,
  evaluateKinematicTrajectoryArcs,
} from '../src/sim/nav.js';

console.log('\n--- Running Unit Tests: src/sim/nav.js ---');

// =============================================================================
// TEST 1: NavigationGrid Cost Differentiation (Hard Hazards vs Soft Obstacles)
// =============================================================================
console.log('Testing NavigationGrid cost mapping...');
{
  const grid = new NavigationGrid();
  const mockWorld = {
    obstacles: [
      { id: 1, x: 100, y: 50, l: 14, w: 10, h: 0 },
    ],
    pits: [
      { id: 1, x: 150, y: 50, l: 16, w: 7, h: 0 },
    ],
    mines: [
      { id: 1, x: 180, y: 50, armT: 0 },
    ],
  };

  grid.update(mockWorld);

  // 1. Open terrain
  const openCost = grid.getCostAt(60, 30);
  assert.strictEqual(openCost, COST_OPEN, 'Open terrain must have COST_OPEN (1)');
  assert.strictEqual(grid.isLethal(60, 30), false, 'Open terrain must not be lethal');

  // 2. Fatal Pit
  const pitCost = grid.getCostAt(150, 50);
  assert.strictEqual(pitCost, COST_LETHAL, 'Pits must have COST_LETHAL (255)');
  assert.strictEqual(grid.isLethal(150, 50), true, 'Pits must be marked lethal');

  // 3. Fatal Mine
  const mineCost = grid.getCostAt(180, 50);
  assert.strictEqual(mineCost, COST_LETHAL, 'Mines must have COST_LETHAL (255)');
  assert.strictEqual(grid.isLethal(180, 50), true, 'Mines must be marked lethal');

  // 4. Soft House Obstacle (Traversable with drag cost, NOT lethal)
  const houseCost = grid.getCostAt(100, 50);
  assert.strictEqual(houseCost, COST_HOUSE, 'House obstacles must have COST_HOUSE (12)');
  assert.strictEqual(grid.isLethal(100, 50), false, 'Houses must NOT be marked lethal (traversable with drag)');

  console.log('✔ NavigationGrid: Lethal pits/mines (255) correctly differentiated from soft houses (12) and open terrain (1).');
}

// =============================================================================
// TEST 2: Curvilinear Target Intercept Prediction & Attack Standoff
// =============================================================================
console.log('Testing Curvilinear Target Prediction & Attack Standoff...');
{
  // Moving straight
  const straightTarget = { x: 100, y: 50, speed: 10, heading: 0, turn: 0 };
  const predStraight = predictTargetCurvilinear(straightTarget, 1.0);
  assert.ok(Math.abs(predStraight.x - 110) < 0.1, 'Straight target moves linear dx = speed * dt');
  assert.ok(Math.abs(predStraight.y - 50) < 0.1, 'Straight target maintains Y');

  // Maneuvering (turning at 45 deg/s = 0.785 rad/s)
  const turningTarget = { x: 100, y: 50, speed: 10, heading: 0, turn: 0.785 };
  const predTurn = predictTargetCurvilinear(turningTarget, 1.0);
  // With positive turn (right / +Y in map coords), end heading is ~0.785 rad, Y increases
  assert.ok(predTurn.y > 52, 'Turning target curves into +Y direction');
  assert.ok(predTurn.x < 110, 'Turning target travels less in X than straight target');

  // Attack Standoff Waypoint
  const mockTank = { x: 50, y: 50, speed: 10, heading: 0 };
  const mockWorld = { obstacles: [], pits: [] };
  const profile = { standoffDist: 26 };
  const attackWp = getAttackStandoffWaypoint(mockTank, straightTarget, mockWorld, profile);

  const standoffDist = Math.hypot(attackWp.x - attackWp.predTarget.x, attackWp.y - attackWp.predTarget.y);
  assert.ok(standoffDist >= 20 && standoffDist <= 32, `Attack waypoint maintains tactical standoff (~26m, got ${standoffDist.toFixed(1)}m)`);
  console.log('✔ Target Maneuver & Attack Standoff: Accurate curvilinear projection and standoff envelope verified.');
}

// =============================================================================
// TEST 3: Gate Passage Mutex & Precise Corridor Alignment
// =============================================================================
console.log('Testing Gate Passage Mutex & Corridor Positioning...');
{
  const gateMgr = new GateReservationManager();
  const owner = 0; // Left base (X = 0, Gate Y = 50)

  // Tank 1 requests gate access
  const t1Access = gateMgr.requestGate(owner, 101, 10.0);
  assert.strictEqual(t1Access, true, 'First tank must obtain gate reservation token');

  // Tank 2 requests gate access at the same time
  const t2Access = gateMgr.requestGate(owner, 102, 10.0);
  assert.strictEqual(t2Access, false, 'Second tank must be denied reservation while Tank 1 holds gate');

  // Test pose for Tank 1 (aligned in corridor, dist <= 20m)
  const tank1 = { id: 101, x: 14.0, y: 50.0, heading: Math.PI, speed: 5 };
  const pose1 = getGateCorridorPose(tank1, owner, 10.0);
  assert.strictEqual(pose1.isDoorwayMode, true, 'Aligned tank within 20m enters doorway tunnel mode');
  assert.strictEqual(pose1.targetY, C.GATE_CENTER_Y_M, 'Doorway mode targets exact gate center Y = 50.0m');

  // Release gate
  gateMgr.releaseGate(owner, 101);
  const t2Retry = gateMgr.requestGate(owner, 102, 10.1);
  assert.strictEqual(t2Retry, true, 'Tank 2 receives token after Tank 1 releases');

  console.log('✔ Gate Mutex: Single-tank corridor reservation and doorway funnel alignment verified.');
}

// =============================================================================
// TEST 4: Multi-Tank Friendly Collision Avoidance & High-Speed Arcs
// =============================================================================
console.log('Testing Trajectory Evaluator: Hazard Rejection & Fleet Coordination...');
{
  const grid = new NavigationGrid();
  // Tank at (50, 50) cruising East at 36 km/h.
  // Directly ahead at (65, 50) is a fatal water pit!
  const mockWorld = {
    obstacles: [],
    pits: [
      { id: 1, x: 65, y: 50, l: 14, w: 8, h: 0 },
    ],
    mines: [],
    tanks: [],
  };
  grid.update(mockWorld);

  const tank = {
    id: 1,
    owner: 0,
    status: 'field',
    x: 50,
    y: 50,
    heading: 0, // facing East
    speed: C.kmhToMs(36),
    cmdSpeedKmh: 36,
    cmdTurnDeg: 0,
  };

  const targetWaypoint = { x: 150, y: 50 };
  const profile = { maxSpeedKmh: 36 };

  const evalResult = evaluateKinematicTrajectoryArcs(
    tank,
    mockWorld,
    grid,
    targetWaypoint,
    profile,
  );

  // The straight ahead arc (turn 0) would plunge into the pit at (65, 50)!
  // The evaluator MUST choose a steering arc (turn != 0) while maintaining forward speed!
  assert.notStrictEqual(evalResult.bestTurnDeg, 0, 'Evaluator must avoid straight ahead path into lethal pit');
  assert.ok(evalResult.bestSpeedKmh > 0, 'Evaluator maintains forward cruising speed around pit');
  assert.ok(evalResult.bestScore > -1000, 'Evaluator found a non-lethal valid trajectory');

  // Now add a friendly tank in North lane: verify evaluator prefers Southern bypass arc
  mockWorld.tanks = [
    tank,
    {
      id: 2,
      owner: 0,
      status: 'field',
      x: 60,
      y: 44, // North side of pit
      heading: 0,
      speed: 0,
    },
  ];

  const evalWithTeammate = evaluateKinematicTrajectoryArcs(
    tank,
    mockWorld,
    grid,
    targetWaypoint,
    profile,
  );

  assert.ok(evalWithTeammate.bestTurnDeg > 0, 'Evaluator turns South (+turn / +Y) to avoid friendly tank at North');

  console.log('✔ Trajectory Evaluator: Lethal pit rejected, friendly tank avoided, high-speed cruise maintained.');
}

console.log('\nALL NAV UNIT TESTS PASSED SUCCESSFULLY! ✔✔✔\n');
