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
export function getRoleWaypoint(tank, role, plan, owner, enemyGateX, simTime = 0) {
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
      // Advance along safe North edge crawl corridor (y=7.5m) until reaching pre-gate position
      if (distToEnemyGate > 12.0) {
        return {
          x: enemyGateX + enemyDir * 10.0,
          y: 7.5,
        };
      }
      // Pre-gate vertical approach: turn vertically South into North Ambush Post (y=30.0)
      return {
        x: enemyGateX + enemyDir * 8.5,
        y: 30.0,
      };
    }

    case 'SOUTH_GATE_AMBUSH': {
      // Advance along safe South edge crawl corridor (y=92.5m) until reaching pre-gate position
      if (distToEnemyGate > 12.0) {
        return {
          x: enemyGateX + enemyDir * 10.0,
          y: 92.5,
        };
      }
      // Pre-gate vertical approach: turn vertically North into South Ambush Post (y=70.0)
      return {
        x: enemyGateX + enemyDir * 8.5,
        y: 70.0,
      };
    }

    case 'VANGUARD': {
      const vanguardLaneY = owner === 0 ? C.AI_LANE_CENTER_Y - 6.0 : C.AI_LANE_CENTER_Y + 6.0;
      // Stop at safe 52m standoff line before enemy slit gun firing zone!
      if (distToEnemyGate <= 54.0) {
        return {
          x: enemyGateX + enemyDir * 52.0,
          y: vanguardLaneY,
        };
      }
      return { x: enemyGateX + enemyDir * 52.0, y: vanguardLaneY + weaveY };
    }

    case 'NORTH_FLANK_LEAD': {
      if (distToEnemyGate <= 14.0) {
        return { x: enemyGateX + enemyDir * 8.5, y: 24.0 };
      }
      return {
        x: beforeMid ? midX : enemyGateX + enemyDir * 14.0,
        y: 7.5,
      };
    }

    case 'NORTH_FLANK_TRAIL': {
      if (distToEnemyGate <= 18.0) {
        return { x: enemyGateX + enemyDir * 12.0, y: 20.0 };
      }
      return {
        x: beforeMid ? (gateX(owner) + midX) / 2 : enemyGateX + enemyDir * 20.0,
        y: 7.5,
      };
    }

    case 'SOUTH_FLANK_LEAD': {
      if (distToEnemyGate <= 14.0) {
        return { x: enemyGateX + enemyDir * 8.5, y: 76.0 };
      }
      return {
        x: beforeMid ? midX : enemyGateX + enemyDir * 14.0,
        y: 92.5,
      };
    }

    case 'SOUTH_FLANK_TRAIL': {
      if (distToEnemyGate <= 18.0) {
        return { x: enemyGateX + enemyDir * 12.0, y: 80.0 };
      }
      return {
        x: beforeMid ? (gateX(owner) + midX) / 2 : enemyGateX + enemyDir * 20.0,
        y: 92.5,
      };
    }

    case 'SPEARHEAD_N': {
      if (distToEnemyGate <= 54.0) {
        return { x: enemyGateX + enemyDir * 52.0, y: C.AI_LANE_NORTH_Y };
      }
      return { x: enemyGateX + enemyDir * 52.0, y: C.AI_LANE_CENTER_Y - C.AI_WEDGE_SPACING_Y + weaveY * 0.6 };
    }

    case 'SPEARHEAD_S': {
      if (distToEnemyGate <= 54.0) {
        return { x: enemyGateX + enemyDir * 52.0, y: C.AI_LANE_SOUTH_Y };
      }
      return { x: enemyGateX + enemyDir * 52.0, y: C.AI_LANE_CENTER_Y + C.AI_WEDGE_SPACING_Y + weaveY * 0.6 };
    }

    case 'ECHELON_N': {
      if (distToEnemyGate <= 58.0) {
        return { x: enemyGateX + enemyDir * 56.0, y: C.AI_LANE_NORTH_Y };
      }
      return { x: enemyGateX + enemyDir * 56.0, y: C.AI_LANE_CENTER_Y - C.AI_WEDGE_SPACING_Y * 2 + weaveY * 0.6 };
    }

    case 'ECHELON_S': {
      if (distToEnemyGate <= 58.0) {
        return { x: enemyGateX + enemyDir * 56.0, y: C.AI_LANE_SOUTH_Y };
      }
      return { x: enemyGateX + enemyDir * 56.0, y: C.AI_LANE_CENTER_Y + C.AI_WEDGE_SPACING_Y * 2 + weaveY * 0.6 };
    }

    case 'REARGUARD':
      return { x: (gateX(owner) + midX) / 2, y: C.AI_LANE_CENTER_Y + (owner === 0 ? -12 : 12) + weaveY * 0.5 };

    case 'SENTRY':
      return { x: gateX(owner) + inwardDir(owner) * 14, y: C.GATE_CENTER_Y_M };

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
      if (distToEnemyGate <= 54.0) {
        const edgeY = tank.y < C.GATE_CENTER_Y_M ? 7.5 : 92.5;
        if (Math.abs(tank.y - edgeY) < 5.0) {
          return { x: enemyGateX + enemyDir * 8.5, y: edgeY };
        }
        return { x: enemyGateX + enemyDir * 52.0, y: tank.y < 50 ? 25 : 75 };
      }
      return { x: enemyGateX + enemyDir * 52.0, y: (tank.y < 50 ? 25 : 75) + weaveY };
    }
  }
}