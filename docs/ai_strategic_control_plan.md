# AI Strategic Brigade Control in Tank.exe

> Source of truth for the AI hierarchy. Implementation lives in `src/sim/ai/` (`src/sim/ai.js` is a
> re-export facade) and `src/sim/nav.js` (navigation). Planned improvements are tracked in
> [`ai_improvement_tasks.md`](./ai_improvement_tasks.md).

| Module (`src/sim/ai/`) | Responsibility |
|---|---|
| `controller.js` | `AiController`: state, per-frame `update` orchestration, window/tank selection |
| `commander.js` | Tier 1: casualties, plan transitions, role (re)assignment |
| `dispatcher.js` | Tier 2: urgency evaluation, selection switching, reserve deployment |
| `executor.js` | Tier 3: fire reflex, slit trigger, stuck recovery, targeting, navigation, smoke/mines |
| `slit.js` | Hangar slit-window defence |
| `roles.js` | Doctrines, role assignment, role waypoints |
| `urgency.js` | Urgency scoring, safe cruising trim |
| `perception.js` | Smoke LOS, line of fire, enemy tracking/prediction |
| `weapons.js` | Fire decision |
| `profiles.js`, `math.js`, `decision_log.js` | Difficulty profiles, helpers, decision log |

## 1. Hard game constraints the AI must respect

- **Only the selected tank can be commanded.** Unselected tanks keep their last commanded
  linear speed and turn rate until selected again.
- **The gun is rigidly fixed to the hull.** The turret does **not** rotate; the firing vector is
  always the tank body heading. "Aiming" therefore means steering/pivoting the whole tank.
  Hull turn rate is limited to 45°/s while moving and 30°/s when stationary, with 0.5 s per
  15°/s step (see `functional_spec.md` §16).
- **Only the selected tank fires** (plus the hangar slit gun while the player is in window view).
  One brigade therefore delivers at most one tank gun's fire at a time; the dispatcher decides
  whose gun that is.
- Each tank carries 5 shells, 2 mines, 2 smokes; reload 1 s; shell range 50 m.
- A side loses when all 15 of its tanks are destroyed.

## 2. Three-tier hierarchy

```
TIER 1  Brigade Commander   (every AI_COMMANDER_EVAL_INTERVAL_S = 0.8 s)
        - picks strategic plan (Alpha/Bravo/Charlie/Delta)
        - assigns tactical roles to field tanks (per brigade doctrine)
TIER 2  Urgency Dispatcher  (every update)
        - scores each field tank, switches the selected tank to the most urgent
TIER 3  Tactical Executor   (decision tick 50-160 ms depending on level)
        - target selection, waypoint choice, DWA steering, weapons, smoke/mines
```

## 3. Tier 1 - Brigade doctrines, roles and plans

### 3.1 Doctrine (chosen once per match per brigade)
`NORTH_SWEEP`, `SOUTH_SWEEP`, `PINCER_AMBUSH`, `SPEARHEAD_WEDGE`, `ASYMMETRIC_SPLIT`.
Owners 0 and 1 are offset in the pick so opposing AIs differ. A doctrine maps the tanks (ordered
by a pseudo-random id hash) onto roles, e.g. `PINCER_AMBUSH` = North ambush, South ambush,
Vanguard, North flank lead, South flank lead.

### 3.2 Roles and where they go (all coordinates in metres)
| Role | Destination |
|---|---|
| `NORTH_GATE_AMBUSH` / `SOUTH_GATE_AMBUSH` | Edge-crawl along Y=7.5 / Y=92.5, then ambush post 8.5 m from the enemy gate at Y=30 / Y=70, gun held on the doorway threshold. |
| `VANGUARD` | Safe standoff line 52 m from the enemy gate, Y = centre -/+ 6 with S-curve weave. |
| `*_FLANK_LEAD` / `*_FLANK_TRAIL` | Edge-crawl along Y=7.5 / 92.5 to mid-field, then to 8.5-20 m from the enemy gate on the same side. |
| `SPEARHEAD_N/S`, `ECHELON_N/S` | Wedge on the 52-56 m line at Y = centre -/+ 4 m (multiples of 4). |
| `REARGUARD` | Behind mid-field, offset 12 m from centre. |
| `SENTRY`, `DEFENSE_ARC_N/S`, `RELOADER` | Charlie only: gate +14 m, arc 26 m out at Y = 50 -/+ 15, rearm standoff 22 m. |
| `PURSUER` | Fallback: chase along the nearest edge corridor. |

The enemy slit-gun hit sector (`isInEnemySlitGunSector`) is never an acceptable destination.

### 3.3 Plans
| Plan | Meaning |
|---|---|
| **Alpha** (`PINCER`) | Default offensive using the brigade doctrine. |
| **Bravo** (`WEDGE`) | Periodic concentrated assault when >= 4 tanks are in the field. Same doctrine roles, maximum cruise speed. |
| **Charlie** (`BASE_DEFENSE`) | Enemy within 45 m of own gate. Roles become sentry / defense arcs / reloader; mines are laid behind defenders. |
| **Delta** (`PURSUIT`) | Enemy average ammo <= 0.5, or enemy has <= 1 tank vs >= 3 of ours. Maximum speed; attack-standoff waypoints are used regardless of range. |

### 3.4 Plan transitions (evaluated in this priority order)
1. Enemy within 45 m of own gate -> Charlie.
2. In Charlie and nearest enemy farther than 60 m -> Alpha.
3. >= 2 own casualties in 8 s -> Alpha (regroup).
4. Enemy ammo exhausted / outnumbered -> Delta.
5. In Alpha with >= 4 tanks and periodic trigger -> Bravo.

## 4. Tier 2 - Urgency dispatcher

Per field tank: `urgency = max(hazard, combat, rearm) + 0.4 * starvation`.

| Component | Values |
|---|---|
| Hazard | pit ahead 95; enemy slit sector ahead 92; mine ahead 90; building/boundary ahead 80 |
| Combat | aimed shot ready (gun within 0.16 rad of a visible target in range) 85; incoming shell 75; target in range but not aimed 65 |
| Rearm | 0 shells and level rearms: 50 |
| Starvation | +5 points per second since last command, capped at 40 |

Switching rules (`AI_MIN_SLICE_S = 0.22 s`, `AI_MAX_SLICE_S = 0.85 s`, `AI_DISPATCH_THRESHOLD_DELTA = 15`):
- immediate switch if another tank has a mine/pit-class hazard and the current one does not;
- after the minimum slice, switch if the best tank beats the current one by the delta;
- after the maximum slice, switch if the best tank has strictly higher urgency.
This is **not** blind round-robin.

Reserve deployment (armed reserve in hangar, spawn corridor clear) has its own urgency
(55-100) and competes with field tanks.

Before leaving a tank, **safe cruising trim** straightens its turn, projects 3.5 s ahead and either
holds an 18 km/h cruise (36 on Delta / spearhead) or issues STOP when a hazard lies ahead.

## 5. Tier 3 - Tactical executor

1. Target selection: distance + angle penalty + LOS-blocked penalty + smoke penalty, minus
   bonuses for enemies facing us, the locked target (hysteresis) and tanks emerging from a gate.
2. Waypoint: role waypoint, replaced by `getAttackStandoffWaypoint` (20-30 m flanking standoff
   outside the target's front cone and the slit sector) when a target is within range.
3. Steering: DWA rollout over 1.8 s (7 turn rates x 3-4 speeds), rejecting lethal arcs and slit-sector
   entries, penalising friendlies/buildings.
4. Weapons: fire when the hull heading is within tolerance of the lead point and the line of fire
   is clear (no building or friendly in the way). Smoke when incoming shell or low ammo; mines
   behind the tank when engaging closely or defending.
5. Rearm: empty tanks use the gate corridor with a one-token gate mutex per team.

## 6. Slit window defense

When an enemy is within 40 m of the home gate **and the selected tank is farther than 60 m from it**,
the AI enters a slit window (random trigger, ~18 % per update), aims within the 45° yaw limit and
fires with unlimited ammunition. After 2.5 s without a target it returns to a field tank.

## 7. Status

Phases 1-4 (foundation, dispatcher, roles, strategic state machine) are implemented.
Open improvements (doctrine persistence, sticky roles, hull-aiming, shot allocation, ammo
discipline, slit continuity, breach plan, routing) are in
[`ai_improvement_tasks.md`](./ai_improvement_tasks.md). AI decisions are visible live in the side
log panels (functional spec §15.11).
