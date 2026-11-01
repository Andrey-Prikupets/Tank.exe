import * as C from '../../constants.js';
import { gateX, inwardDir } from '../world.js';

export const BRIGADE_DOCTRINES = [
  'NORTH_SWEEP',     // Heavy North concentration (2-3 tanks), 1 vanguard, 1 gate lurker
  'SOUTH_SWEEP',     // Heavy South concentration (2-3 tanks), 1 vanguard, 1 gate lurker
  'PINCER_AMBUSH',   // Dual North + South pincer with dedicated ambush posts
  'SPEARHEAD_WEDGE', // Staggered spearhead wedge with asymmetric flank ambushers
  'ASYMMETRIC_SPLIT',// Asymmetric single flank thrust with stealth gate lurker
];

/** Role sets (ordered by slot) per doctrine. */
const DOCTRINE_ROLES = {
  NORTH_SWEEP: ['NORTH_GATE_AMBUSH', 'NORTH_FLANK_LEAD', 'NORTH_FLANK_TRAIL', 'VANGUARD', 'SOUTH_FLANK_LEAD'],
  SOUTH_SWEEP: ['SOUTH_GATE_AMBUSH', 'SOUTH_FLANK_LEAD', 'SOUTH_FLANK_TRAIL', 'VANGUARD', 'NORTH_FLANK_LEAD'],
  PINCER_AMBUSH: ['NORTH_GATE_AMBUSH', 'SOUTH_GATE_AMBUSH', 'VANGUARD', 'NORTH_FLANK_LEAD', 'SOUTH_FLANK_LEAD'],
  SPEARHEAD_WEDGE: ['SPEARHEAD_N', 'SPEARHEAD_S', 'ECHELON_N', 'NORTH_GATE_AMBUSH', 'SOUTH_GATE_AMBUSH'],
};
/** Plan Bravo: concentrated wedge with a rearguard. */
const BRAVO_ROLES = ['SPEARHEAD_N', 'SPEARHEAD_S', 'ECHELON_N', 'ECHELON_S', 'REARGUARD'];
/** Plan Delta: everybody chases. */
const DELTA_ROLES = ['PURSUER', 'PURSUER', 'PURSUER', 'PURSUER', 'PURSUER'];

/** Ordered role slots for a plan (Charlie is handled separately, it depends on ammo). */
function roleTable(plan, doctrine, owner) {
  if (plan === C.AI_STRATEGY_PLANS.BRAVO) return BRAVO_ROLES;
  if (plan === C.AI_STRATEGY_PLANS.DELTA) return DELTA_ROLES;
  if (doctrine === 'ASYMMETRIC_SPLIT' || !DOCTRINE_ROLES[doctrine]) {
    const n = owner === 0;
    return [
      n ? 'NORTH_GATE_AMBUSH' : 'SOUTH_GATE_AMBUSH',
      'VANGUARD',
      n ? 'NORTH_FLANK_LEAD' : 'SOUTH_FLANK_LEAD',
      n ? 'SOUTH_GATE_AMBUSH' : 'NORTH_GATE_AMBUSH',
      'REARGUARD',
    ];
  }
  return DOCTRINE_ROLES[doctrine];
}

/** Pseudo-random but stable permutation (seeded by tank id and owner) so roles are organically distributed. */
function hashSorted(myField, owner) {
  return [...myField].sort((a, b) => {
    const hashA = (a.id * 7 + (owner === 0 ? 3 : 11)) % 17;
    const hashB = (b.id * 7 + (owner === 0 ? 3 : 11)) % 17;
    return hashA - hashB;
  });
}

/** Assigns brigade formation roles across friendly field tanks with doctrine-specific tactical asymmetry. */
export function assignBrigadeRoles(myField, plan, doctrine = 'PINCER_AMBUSH', owner = 0) {
  const sorted = hashSorted(myField, owner);
  const roles = new Map();

  if (plan === C.AI_STRATEGY_PLANS.CHARLIE) {
    sorted.forEach((t, idx) => {
      if (t.shells === 0) roles.set(t.id, 'RELOADER');
      else if (idx === 0) roles.set(t.id, 'SENTRY');
      else if (idx % 2 === 1) roles.set(t.id, 'DEFENSE_ARC_N');
      else roles.set(t.id, 'DEFENSE_ARC_S');
    });
    return roles;
  }

  const table = roleTable(plan, doctrine, owner);
  sorted.forEach((t, idx) => roles.set(t.id, table[Math.min(idx, table.length - 1)]));
  return roles;
}

/**
 * Sticky role update: a full reassignment happens only on a plan change (or for Charlie, which
 * depends on ammo). Otherwise tanks keep their roles; tanks without a role (newly deployed)
 * take the roles freed by tanks that left the field. Prevents flanks swapping sides mid-battle.
 */
export function updateBrigadeRoles(prevRoles, myField, plan, planChanged, doctrine, owner) {
  if (planChanged || plan === C.AI_STRATEGY_PLANS.CHARLIE || !prevRoles || prevRoles.size === 0) {
    return assignBrigadeRoles(myField, plan, doctrine, owner);
  }
  const free = [...roleTable(plan, doctrine, owner)];
  const sorted = hashSorted(myField, owner);
  const roles = new Map();
  for (const t of sorted) {
    const r = prevRoles.get(t.id);
    const i = r ? free.indexOf(r) : -1;
    if (i >= 0) {
      roles.set(t.id, r);
      free.splice(i, 1);
    }
  }
  for (const t of sorted) {
    if (!roles.has(t.id)) roles.set(t.id, free.length ? free.shift() : 'VANGUARD');
  }
  return roles;
}

/**
 * Calculates tactical waypoints based on assigned formation role with organic trajectory weaving.
 * Ensures tanks approach enemy gates laterally via flanks and vertically on the map along the wall,
 * never directly from the front into the lethal slit gun hit sector.
 */
export function getRoleWaypoint(tank, role, plan, owner, enemyGateX, simTime = 0, world = null) {
  const dir = owner === 0 ? 1 : -1;
  const enemyDir = -dir;
  const distToEnemyGate = Math.abs(tank.x - enemyGateX);

  const midX = (gateX(owner) + enemyGateX) / 2;
  const beforeMid = owner === 0 ? tank.x < midX : tank.x > midX;

  // Organic S-curve lateral weave: amplitude ~3-5m, varies with time and tank ID
  const weavePhase = simTime * C.AI_TRAJECTORY_WEAVE_FREQ + (tank.id % 5) * 1.35;
  const weaveY = Math.sin(weavePhase) * C.AI_TRAJECTORY_WEAVE_AMP_M;

  switch (role) {
    case 'NORTH_GATE_AMBUSH': {
      // Forward Containment Arc North post: 36.0m from enemy gate, y=30.0m.
      // Safe from slit guns (hypot(36, 12) = 37.95m > 37.2m) with direct line of fire onto gate exit.
      return {
        x: enemyGateX + enemyDir * 36.0,
        y: 30.0,
      };
    }

    case 'SOUTH_GATE_AMBUSH': {
      // Forward Containment Arc South post: 36.0m from enemy gate, y=70.0m.
      // Safe from slit guns (hypot(36, 12) = 37.95m > 37.2m) with direct line of fire onto gate exit.
      return {
        x: enemyGateX + enemyDir * 36.0,
        y: 70.0,
      };
    }

    case 'VANGUARD': {
      const vanguardLaneY = owner === 0 ? 34.0 : 66.0;
      // Hold on the Forward Containment Arc outside enemy slit gun reach (hypot(37, 8) = 37.85m)
      if (distToEnemyGate <= 40.0) {
        return {
          x: enemyGateX + enemyDir * 37.0,
          y: vanguardLaneY,
        };
      }
      return { x: enemyGateX + enemyDir * 37.0, y: vanguardLaneY + weaveY * 0.5 };
    }

    case 'NORTH_FLANK_LEAD': {
      return {
        x: beforeMid ? midX : enemyGateX + enemyDir * 35.0,
        y: 20.0,
      };
    }

    case 'NORTH_FLANK_TRAIL': {
      return {
        x: beforeMid ? (gateX(owner) + midX) / 2 : enemyGateX + enemyDir * 40.0,
        y: 24.0,
      };
    }

    case 'SOUTH_FLANK_LEAD': {
      return {
        x: beforeMid ? midX : enemyGateX + enemyDir * 35.0,
        y: 80.0,
      };
    }

    case 'SOUTH_FLANK_TRAIL': {
      return {
        x: beforeMid ? (gateX(owner) + midX) / 2 : enemyGateX + enemyDir * 40.0,
        y: 76.0,
      };
    }

    case 'SPEARHEAD_N': {
      if (distToEnemyGate <= 40.0) {
        return { x: enemyGateX + enemyDir * 36.0, y: 32.0 };
      }
      return { x: enemyGateX + enemyDir * 36.0, y: C.AI_LANE_CENTER_Y - C.AI_WEDGE_SPACING_Y + weaveY * 0.6 };
    }

    case 'SPEARHEAD_S': {
      if (distToEnemyGate <= 40.0) {
        return { x: enemyGateX + enemyDir * 36.0, y: 68.0 };
      }
      return { x: enemyGateX + enemyDir * 36.0, y: C.AI_LANE_CENTER_Y + C.AI_WEDGE_SPACING_Y + weaveY * 0.6 };
    }

    case 'ECHELON_N': {
      if (distToEnemyGate <= 42.0) {
        return { x: enemyGateX + enemyDir * 40.0, y: 26.0 };
      }
      return { x: enemyGateX + enemyDir * 40.0, y: C.AI_LANE_CENTER_Y - C.AI_WEDGE_SPACING_Y * 2 + weaveY * 0.6 };
    }

    case 'ECHELON_S': {
      if (distToEnemyGate <= 42.0) {
        return { x: enemyGateX + enemyDir * 40.0, y: 74.0 };
      }
      return { x: enemyGateX + enemyDir * 40.0, y: C.AI_LANE_CENTER_Y + C.AI_WEDGE_SPACING_Y * 2 + weaveY * 0.6 };
    }

    case 'REARGUARD':
      return { x: (gateX(owner) + midX) / 2, y: C.AI_LANE_CENTER_Y + (owner === 0 ? -12 : 12) + weaveY * 0.5 };

    case 'SENTRY': {
      // Coordinate with hangar slit windows:
      // Slit windows are at y=42 (Window 0, North) and y=58 (Window 1, South) with +/-45 deg traverse.
      // Sentry must NOT block the gate center corridor (y=46.5..53.5) used by deploying/rearming tanks.
      // If a slit window is active, sentry guards the opposite flank (covering blind spot and avoiding line of fire).
      const pl = world && world.players ? world.players[owner] : null;
      let sentryFlank = tank.y < C.GATE_CENTER_Y_M ? -16.0 : 16.0;
      if (pl && pl.view === 'window') {
        sentryFlank = pl.windowIdx === 0 ? 16.0 : -16.0;
      }
      return {
        x: gateX(owner) + inwardDir(owner) * 14.0,
        y: C.GATE_CENTER_Y_M + sentryFlank,
      };
    }

    case 'DEFENSE_ARC_N':
      return {
        x: gateX(owner) + inwardDir(owner) * C.AI_BASE_DEFENSE_ARC_RADIUS_M,
        y: C.GATE_CENTER_Y_M - 15 + weaveY * 0.4,
      };

    case 'DEFENSE_ARC_S':
      return {
        x: gateX(owner) + inwardDir(owner) * C.AI_BASE_DEFENSE_ARC_RADIUS_M,
        y: C.GATE_CENTER_Y_M + 15 + weaveY * 0.4,
      };

    case 'RELOADER':
      return { x: gateX(owner) + inwardDir(owner) * C.AI_REARM_STANDOFF_DIST_M, y: C.GATE_CENTER_Y_M };

    case 'PURSUER':
    default: {
      if (distToEnemyGate <= 40.0) {
        return { x: enemyGateX + enemyDir * 36.0, y: tank.y < 50 ? 28.0 : 72.0 };
      }
      return { x: enemyGateX + enemyDir * 36.0, y: (tank.y < 50 ? 28.0 : 72.0) + weaveY * 0.6 };
    }
  }
}