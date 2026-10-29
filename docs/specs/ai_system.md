# Artificial Intelligence & Autonomous Control

> Sub-specification of `Tank.exe`.  
> Master document: [functional_spec.md](../functional_spec.md).  
> Tactical architecture reference: [ai_strategic_control_plan.md](./ai_strategic_control_plan.md).  
> Roadmap & improvements: [ai_improvement_tasks.md](./ai_improvement_tasks.md).

---

## 1. Hard Constraints Imposed by Game Rules

1. **Only the active/selected tank receives live commands.** Unselected tanks maintain their last commanded linear speed and turn rate indefinitely.
2. **Fixed gun mounting:** Turrets never rotate relative to the hull; aiming requires steering or pivoting the entire tank hull. Turn rate is limited to 45°/s moving and 30°/s stationary.
3. **Single firing point:** Only one tank gun can fire at a time per team (plus the hangar slit gun when observing in window view). The time-slice dispatcher decides which unit receives control.
4. **Finite munitions:** 5 shells, 2 mines, 2 smokes per tank. Rearm requires navigating into the home hangar.

---

## 2. Three-Tier Command Hierarchy

```
+-------------------------------------------------------------+
|             TIER 1: BRIGADE COMMANDER                      |
|  - Assesses global battlefield state every 0.8s             |
|  - Selects active Brigade Strategic Plan (Alpha/Bravo/...)  |
|  - Assigns sticky tactical roles across the 5 field tanks   |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|             TIER 2: TIME-SLICE DISPATCHER                   |
|  - Urgency-Weighted Priority Dispatcher (220ms - 850ms)     |
|  - Evaluates immediate micro-needs across all 5 tanks       |
|  - Instantly switches selection to the most critical unit   |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|             TIER 3: TACTICAL UNIT EXECUTOR                  |
|  - Executes role waypoints (Vanguard, Flanker, Ambush)      |
|  - Dynamic Window Trajectory Rollout (DWA) in nav.js        |
|  - Pre-switch Safe Cruising Course Projection (3.0s look)   |
|  - Aim alignment, predictive lead, reflex fire, and evasion |
+-------------------------------------------------------------+
```

---

## 3. Tier 1 — Strategic Plans & Tactical Doctrines

### 3.1 Brigade Tactical Doctrines
Assigned randomly per brigade at match start (`NORTH_SWEEP`, `SOUTH_SWEEP`, `PINCER_AMBUSH`, `SPEARHEAD_WEDGE`, `ASYMMETRIC_SPLIT`). Opposing teams are offset to prevent symmetrical mirroring.

### 3.2 Strategic Plans
- **Plan Alpha ("Pincer Envelopment", Default Offensive):** Vanguard pins center at 30 m standoff while North and South flankers advance along outer arena borders ($Y \approx 22\text{ m}$ and $Y \approx 78\text{ m}$) to envelope the enemy gateway.
- **Plan Bravo ("Wedge Breach", Concentrated Assault):** Spearhead pair cruises aggressively abreast along the center ($Y \approx 46, 54$) at $36\text{ km/h}$, supported by trailing echelons. Engaged periodically when $\ge 4$ tanks are operational.
- **Plan Charlie ("Base Defense & Slit Crossfire"):** Engaged when an enemy enters within $45\text{ m}$ of the home gate (`AI_PLAN_DEFENSE_TRIGGER_DIST_M`). The AI mans the hangar slit window (infinite shells) while field tanks form a defensive arc and lay rear deterrent mines.
- **Plan Delta ("All-Out Pursuit"):** Engaged when enemy forces are nearly out of ammunition ($\le 0.5$ shells average) or heavily outnumbered ($\ge 3:1$). All units charge at top speed to cut off hangar retreat.

---

## 4. Tier 2 — Urgency-Weighted Time-Slice Dispatcher

Replaces naive round-robin switching with dynamic micro-need scoring across all 5 brigade tanks:

$$U_i = \max(H_i, C_i, R_i) + 0.4 \cdot S_i$$

- **Hazards ($H_i$):** Water pit collision ahead = 95; enemy slit sector ahead = 92; mine ahead = 90; building or perimeter wall collision ahead = 80.
- **Combat Opportunities ($C_i$):** Gun aimed within tolerance with clear line of fire = 85; incoming hostile shell requiring evasion = 75; enemy within combat range = 65.
- **Rearm ($R_i$):** 0 shells remaining (eligible for reload) = 50.
- **Starvation ($S_i$):** $+5\text{ points/s}$ since last commanded (capped at 40), guaranteeing no tank is abandoned.

### Switching Rules & Pacing
- **Minimum Slice Duration:** $2.0\text{ s}$ (`AI_MIN_SLICE_S`) to prevent erratic, disorienting micro-switching.
- **Maximum Slice Duration:** $4.0\text{ s}$ (`AI_MAX_SLICE_S`) before yielding control to neglected units.
- **Post-Fire Holding Delay:** Selection holds for $\ge 0.5\text{ s}$ (`AI_POST_FIRE_HOLD_S`) after firing to observe projectile flight and impact.
- **Switch Threshold:** Switches if $\max(U_i) - U_{\text{curr}} \ge 15$ (`AI_DISPATCH_THRESHOLD_DELTA`), or immediately if another unit faces an acute hazard ($H \ge 90$).

---

## 5. Tier 3 — Tactical Navigation, Aiming & Combat

### 5.1 Custom Kinematic Navigation Framework (`src/sim/nav.js`)
- **Macro-Scale 2D Cost Grid:** Discretizes the $250\text{ m} \times 100\text{ m}$ arena into $2.0\text{ m}$ cells ($125 \times 50$ cells in a `Uint8Array`).
  - Lethal hazards (pits and armed mines): `COST_LETHAL = 255`.
  - Soft obstacles (building walls and arena borders): `COST_HOUSE = 12`.
  - Open arena: `COST_OPEN = 1`.
- **Dynamic Window Trajectory Rollout (DWA):**
  - Evaluates candidate steering arcs over a $1.8\text{ s}$ horizon (6 simulation steps) adhering to skid-steer acceleration limits.
  - Rejects any trajectory contacting water pits, mine trigger radii, or entering the enemy slit gun sector.
  - Penalizes arcs passing within $6.0\text{ m}$ of unselected friendly tanks, eliminating bunching.
- **Gate Reservation Mutex:** `GateReservationManager` ensures only a single tank transits or approaches the 7 m gateway at a time. Other retreating or deploying units hold at lateral staging waypoints ($Y = 32\text{ m}$ or $68\text{ m}$).

### 5.2 Hull Aiming & Fire Reflex
- Because the gun is fixed to the hull, the selected tank **stops and pivots** onto the predicted target lead point:
  $$\text{leadPoint} = \text{targetPos} + \text{targetVel} \cdot t_{\text{flight}} \cdot \text{leadFactor}$$
- Commanded turn rate uses heading error multiplied by `AI_AIM_GAIN_PER_S = 1.5`, capped at the stationary pivot limit ($30^\circ/\text{s}$), with a deadband of $1^\circ$.
- Turn rate hysteresis around $180^\circ$ prevents direction fluttering when acquiring targets directly behind.
- Fires immediately once alignment falls within aim tolerance.

### 5.3 Active Mine Avoidance & Evasion
- Forward hazard lookahead ($16\dots 25\text{ m}$) calculates lateral clearance arcs around detected mines ($\ge 5.8\text{ m}$ clearance).
- If approaching a mine at point-blank range ($< 5\text{ m}$), the tank emergency brakes to pivot-turn clear before accelerating forward.
- Reverse maneuvers verify that no mine lies directly behind the hull.

### 5.4 Fair Smoke Obscuration & Dead-Reckoning
- Active smoke clouds completely block line-of-sight for both tank crews and slit sentries (`isLineOfSightBlockedBySmoke`). The AI never cheats through smoke.
- `enemyTracker` records last-known enemy position and velocity, applying dead-reckoning extrapolation with spatial dispersion ($\pm 1.5\dots 4.0\text{ m}$) for blind fire into smoke.
- Confidence decays rapidly over time; firing ceases when confidence falls below difficulty thresholds.

### 5.5 Pre-Switch Safe Cruising Trim
Before relinquishing control of a tank, the AI zeroes turn commands (`cmdTurnDeg = 0`) and projects a 3.0-second lookahead path:
- If clear: locks stable cruising speed ($18$ or $36\text{ km/h}$).
- If an obstacle, pit, mine, or border is ahead: veers away at creep speed ($6\text{ km/h}$) toward a probed clear heading, or issues an emergency stop (`STOP`).

---

## 6. Difficulty Profiles

| Parameter | EASY | MEDIUM | HARD |
|---|---|---|---|
| Decision Interval | ~0.16 s | ~0.10 s | ~0.05 s |
| Aim Tolerance | ~7° (no lead) | ~4.5° (0.5 lead) | ~3° (full lead) |
| Max Firing Distance | 30 m | 40 m | Max shell range ($62.5\text{ m}$) |
| Max Cruising Speed | 18 km/h | 36 km/h | 36 km/h |
| Standoff Distance | 22 m | 26 m | 30 m |
| Tactical Countermeasures | Low (0.2) | Medium (0.6) | High (0.9) |
| Blind Fire Confidence Threshold | $\ge 0.65$ | $\ge 0.45$ | $\ge 0.30$ |

---

## 7. AI Diagnostic Tooling & Telemetry

- **On-Screen Decision Log Panels:** For AI-controlled sides, scrolling telemetry appears in the canvas margins outside the 2D map, streaming timestamped decisions: `DOCTRINE`, `PLAN`, `ROLES`, `ATTACK`, `AVOID`, `SLIT`, `REARM`, `DEPLOY`, `FIRE`, `SMOKE`, `MINE`.
- **Headless VCR Tool (`.\vcr.cmd [seconds] [level] [seed]`):** Runs deterministic headless AI matches producing comprehensive logs of tank states and strategic choices for tuning without browser overhead.
- **Benchmark Suite (`.\bench.cmd [seeds] [seconds] [level]`):** Aggregates win rates, tank losses, accuracy, and mine casualties across dozens of seeded matches to validate AI improvements.
