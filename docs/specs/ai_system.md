# Artificial Intelligence & Autonomous Control

> Sub-specification of `Tank.exe`.  
> Master document: [functional_spec.md](../functional_spec.md).  
> Tactical architecture reference: [ai_strategic_control_plan.md](./ai_strategic_control_plan.md).  
> Roadmap & improvements: [ai_improvement_tasks.md](./ai_improvement_tasks.md).

---

## 1. Hard Constraints Imposed by Game Rules

1. **Single active trigger, parallel movement & steering:** While only the currently selected tank can pull the firing trigger (`FIRE`) on a given tick, all 5 field tanks execute their commanded linear speed (`cmdSpeedKmh`) and turn rate (`cmdTurnDeg`) simultaneously every tick. The AI exploits this asymmetry against human players (who can typically focus attention on only 1 tank at a time) by steering, enveloping, and pre-aiming all 5 tanks in parallel (`enforceUnselectedTanksSafety` and `updateCommander`), then rapidly multiplexing the active selection across pre-aimed tanks (`instantVolleyReady`) to fire near-simultaneous multi-tank volleys.
2. **Fixed gun mounting:** Turrets never rotate relative to the hull; aiming requires steering or pivoting the entire tank hull. Turn rate is limited to $45^\circ/\text{s}$ (`TANK_MAX_TURN_DEG_S`) while moving ($\text{cmdSpeedKmh} \ne 0$) and $30^\circ/\text{s}$ (`TANK_MAX_PIVOT_TURN_DEG_S`) while stationary ($\text{cmdSpeedKmh} = 0$).
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
|  - Controls all unselected tanks in parallel every tick:    |
|    Wolfpack crossfire swarm + Unattended-tank Hunters       |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|             TIER 2: TIME-SLICE DISPATCHER                   |
|  - Urgency-Weighted Priority Dispatcher (0.08s - 4.0s)      |
|  - Instant 0.08s Parallel Volley Multiplexing for pre-aimed |
|    unselected tanks ready to fire                           |
|  - Fast 0.3s preemption on hazard or close-combat threats   |
|  - Dampens distant unit starvation during active duels      |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|             TIER 3: TACTICAL UNIT EXECUTOR                  |
|  - Active-threat target prioritization (ignores decoys)     |
|  - Dynamic Window Trajectory Rollout (DWA) in nav.js        |
|  - Iterative curvilinear muzzle-lead & mobile 45°/s aiming  |
|  - Ballistic OBB ray-intersection firing gate & evasion     |
+-------------------------------------------------------------+
```

---

## 3. Tier 1 — Strategic Plans & Tactical Doctrines

### 3.1 Brigade Tactical Doctrines
Assigned randomly per brigade at match start (`NORTH_SWEEP`, `SOUTH_SWEEP`, `PINCER_AMBUSH`, `SPEARHEAD_WEDGE`, `ASYMMETRIC_SPLIT`). Opposing teams are offset to prevent symmetrical mirroring.

### 3.2 Strategic Plans
- **Plan Alpha ("Pincer Envelopment", Default Offensive):** Vanguard pins center at standoff distance while North and South flankers advance along outer arena borders ($Y \approx 22\text{ m}$ and $Y \approx 78\text{ m}$) to envelop the enemy gateway.
- **Plan Bravo ("Wedge Breach", Concentrated Assault):** Spearhead pair cruises aggressively abreast along the center ($Y \approx 46, 54$) at $36\text{ km/h}$, supported by trailing echelons. Engaged periodically when $\ge 4$ tanks are operational.
- **Plan Charlie ("Base Defense & Slit Crossfire"):** Engaged when $\ge 2$ enemies enter within $45\text{ m}$ of the home gate (`AI_PLAN_DEFENSE_TRIGGER_DIST_M = 45`) or immediately when any single enemy breaches within $35\text{ m}$ (`AI_PLAN_DEFENSE_INNER_DIST_M = 35`), and held until all threats are pushed beyond $55\text{ m}$ (`AI_PLAN_DEFENSE_CLEAR_DIST_M = 55`). The AI mans the hangar slit window (infinite shells) when field tanks are distant, while nearby field tanks form a defensive arc and lay rear deterrent mines against active pursuers.
- **Plan Delta ("All-Out Pursuit"):** Engaged when enemy forces are nearly out of ammunition ($\le 0.5$ shells average) or heavily outnumbered ($\ge 3:1$). All units charge at top speed to cut off hangar retreat.

---

## 4. Tier 2 — Urgency-Weighted Time-Slice Dispatcher (`urgency.js`, `dispatcher.js`)

Replaces naive round-robin switching with dynamic micro-need scoring across all 5 brigade tanks:

$$U_i = \max(H_i, C_i, R_i) + w_S \cdot S_i$$

### 4.1 Component Urgency Scores
- **Hazards ($H_i$):**
  - Water pit collision ahead = $95$ (`AI_URGENCY_HAZARD_PIT`).
  - Enemy slit-gun firing sector ahead = $92$.
  - Mine ahead or within the full corner-sweep trigger clearance ($d < 5.26\text{ m} + 0.8\text{ m}$, or forward corridor $|y_{\text{local}}| < 5.26\text{ m} + 0.8\text{ m}$) = $90$ (`AI_URGENCY_HAZARD_MINE`).
  - Building or perimeter wall collision ahead (outside own gate doorway lane) = $80$ (`AI_URGENCY_HAZARD_OBSTACLE`).
- **Combat Opportunities & Active Threat Defense ($C_i$):**
  - **Incoming Hostile Shell:** Enemy shell within $24\text{ m}$ (`AI_SMOKE_INCOMING_SHELL_DIST_M + 4`) heading toward the unit ($\text{dot} > 0.8$) = $85$ (`AI_URGENCY_COMBAT_SHELL_INCOMING + 10`).
  - **Active Close-Range Duel / Threat Intercept ($\le 48\text{ m}$):** Whenever an armed tank has an enemy within $48\text{ m}$ (`rawDist <= 48 m`), even before its gun is aligned or if line-of-fire is momentarily obstructed, it receives a close-threat urgency score:
    $$C_{\text{threat}} = 80 + 0.3 \cdot (48 - d) + (\text{enemyClosing} ? 5 : 0) - (\text{reload} > 0.3\text{ s} ? 6 : 0)$$
    reaching up to $94$. This guarantees the defender closest to a charging attacker is selected *before* the attacker enters $32\text{ m}$ firing range.
  - **Shot Allocation, Lead Alignment & Instant Volley Readiness:** For enemies within `lead.muzzleDist <= maxEngageDist + 4.5 m` with clear line of fire, estimates time-to-shot using the moving turn rate ($t_{\text{turn}} = |\text{errDeg}| / 45^\circ/\text{s}$, $t_{\text{shot}} = \max(\text{reload}, t_{\text{turn}})$):
    - **Instant Parallel Volley Readiness (`combatScore = 98..99`):** When an unselected tank has already pre-aligned its hull in parallel onto an unblocked target within firing range (`lead.muzzleDist <= maxEngageDist + 2.2 m`, $\text{reload} \le 0.05\text{ s}$, and $|\text{errDeg}| \le 4.5^\circ$), its combat score jumps to $98$ ($99$ against a moving target). This signals `runDispatcher` to immediately cycle selection to this unit, pull the trigger, and move on.
    - Base aimed score: $85 - \min(20, 8 \cdot t_{\text{shot}})$.
    - **Active-Attacker Priority Bonus:** $+6$ when the target is moving ($|v| > 1.5\text{ m/s}$), ensuring units fighting an active human raider outrank units aiming at stationary spawn reserves.
    - **Gate-Emergence Bonus:** $+5$ (`AI_URGENCY_GATE_TARGET_BONUS`) only when the enemy within the gate emergence box ($\Delta X \le 9\text{ m}, \Delta Y \le 5\text{ m}$) is actually moving ($|v| > 0.5\text{ m/s}$).
    - **Opportunity Boost:** $\max(\text{score}, 88 - 4 \cdot t_{\text{turn}} + (|v| > 1.5 ? 4 : 0))$ when unblocked within $32\text{ m}$ muzzle distance and $|\text{errDeg}| \le 75^\circ$.
  - **General Advance Baseline:** $45\dots 65$ (`AI_URGENCY_COMBAT_ENGAGING`) scaled by distance to nearest enemy.
- **Rearm ($R_i$):** $0$ shells remaining (eligible for reload) = $50$ (`AI_URGENCY_REARM`).
- **Combat-Aware Starvation Damping ($w_S \cdot S_i$):**
  - Raw starvation $S_i$ accumulates at $+5\text{ points/s}$ (`AI_STARVATION_RATE_PER_S`) up to $40$ (`AI_STARVATION_MAX`).
  - Normally $w_S = 0.75$. However, whenever **any** friendly tank is in close combat ($< 48\text{ m}$ from an enemy), distant unthreatened teammates ($d_{\min} > 56\text{ m}$ from all enemies) have their starvation weight dampened to $w_S = 0.20$. This prevents a distant cruising tank from stealing selection away from a teammate fighting a life-or-death duel.

### 4.2 Switching Rules, Parallel Volley Multiplexing & Guards (`runDispatcher`)
- **Normal Minimum Slice Duration:** $1.2\text{ s}$ (`AI_MIN_SLICE_S`) and post-fire hold of $0.4\text{ s}$ (`AI_POST_FIRE_HOLD_S`).
- **Instant $0.08\text{ s}$ Parallel Volley Multiplexing (`instantVolleyReady`):**
  - Because unselected tanks steer and pre-aim onto their targets in parallel every tick, whenever another tank reaches `combatScore >= 97` ($\text{reload} \le 0.05\text{ s}$, pre-aligned within $4.5^\circ$ on an unblocked target in range) while the currently selected tank is not itself ready to fire on this tick ($C_{\text{curr}} < 97$ or $\text{reload}_{\text{curr}} > 0.1\text{ s}$), the dispatcher switches after just $0.08\text{ s}$ (`sliceTimer >= 0.08 s`).
  - This allows the AI to fire near-simultaneous multi-tank volleys (e.g. 2–3 tanks firing within $0.1\text{--}0.3\text{ s}$ of each other from converging crossfire angles, or simultaneously sniping multiple unattended enemy tanks across the map).
- **Fast $0.3\text{ s}$ Emergency Preemption (`fastPreemptMet`):** Once `sliceTimer >= 0.3 s` and `timeSinceFire >= 0.4 s`, the dispatcher immediately switches selection on:
  1. **Acute Hazard Emergency:** Candidate unit has $H_{\text{best}} \ge 90$ while current unit has $H_{\text{curr}} < 90$.
  2. **Acute Combat Emergency:** Candidate unit has $C_{\text{best}} \ge 84$ while $C_{\text{curr}} < 77$, **or** the current unit is reloading ($\text{reload} > 0.35\text{ s}$) while another armed unit has an immediate shot ready ($\text{reload} \le 0.1\text{ s}$ and $C_{\text{best}} \ge 82$).
- **Active-Duel Protection Against Forced/Starvation Switches:**
  - At `AI_MAX_SLICE_S` ($4.0\text{ s}$), `forceSwitch` is suppressed if the currently selected unit is in active close combat ($C_{\text{curr}} \ge 80$) or avoiding a mine/pit ($H_{\text{curr}} \ge 90$).
  - Even when $\max(U_i) - U_{\text{curr}} \ge 10$ (`AI_DISPATCH_THRESHOLD_DELTA`), the dispatcher refuses to switch away from a unit with $C_{\text{curr}} \ge 82$ unless the new unit has $C_{\text{best}} \ge C_{\text{curr}} - 2$ or $H_{\text{best}} \ge 90$.
  - Hangar reserve deployment is similarly suppressed while the active field unit has $C_{\text{curr}} \ge 80$ or $H_{\text{curr}} \ge 90$.

---

## 5. Tier 3 — Tactical Navigation, Target Selection, Aiming & Combat

### 5.1 Custom Kinematic Navigation Framework (`src/sim/nav.js`)
- **Corner-Safe Mine Lethal Radius (`MINE_LETHAL_RADIUS_M`):**
  - Because a $6\text{ m} \times 4\text{ m}$ tank hull has a corner sweep radius of $\sqrt{3^2 + 2^2} \approx 3.61\text{ m}$ (`TANK_COLLISION_RADIUS_M`) and mines detonate at $1.0\text{ m}$ (`MINE_TRIGGER_RADIUS_M`), any mine within $4.61\text{ m}$ of tank center can detonate when the hull turns.
  - `MINE_LETHAL_RADIUS_M` is set to $3.61 + 1.0 + 0.65 \approx 5.26\text{ m}$, providing full corner clearance across all navigation layers.
- **Hull-Padded Enemy Slit-Gun Sector & Path-Segment Avoidance (`isInEnemySlitGunSector`, `isSegmentInEnemySlitGunSector`):**
  - Enemy hangar slit guns at $Y = 42\text{ m}$ and $Y = 58\text{ m}$ have a $32\text{ m}$ physical shell reach and a $\pm 45^\circ$ horizontal traverse cone.
  - `isInEnemySlitGunSector(x, y, enemyOwner, marginM)` pads the radial shell reach by `hullPad = 2.2 m + marginM` ($35.7\text{ m}$ at default `marginM = 1.5 m`) and pads the $45^\circ$ diagonal cone boundary by `conePad = 3.6 m + marginM` (`dy <= dx + conePad`) so a tank's $3.61\text{ m}$ corner cannot clip an oblique slit-gun shell at $(14.7, 76.6)$.
  - `isSegmentInEnemySlitGunSector(x0, y0, x1, y1, enemyOwner, marginM)` samples $s \in \{0.25, 0.5, 0.75, 1.0\}$ along any candidate movement or lookahead segment so neither selected nor unselected tanks cut across the slit-gun cone en route to a safe endpoint.
- **Forward Containment Arc (`getGateAmbushPose`, `getRoleWaypoint`):**
  - Rather than camping deep along the enemy wall ($dx \approx 12\text{ m}$) where tanks have poor forward reach and risk clipping the $45^\circ$ slit-gun cone, when the enemy has no active tanks on the field (or only tanks inside the slit-gun sector), the brigade establishes a **Forward Containment Arc** at $dx = 36\text{--}38\text{ m}$ from the enemy gate across five staggered firing lanes ($Y \in \{30, 38, 50, 62, 70\}\text{ m}$).
  - At $dx = 36\text{ m}$ (outside the $32\text{ m}$ slit-gun shell reach), every tank pre-rotates its hull toward the enemy gate exit threshold $(gx \pm 12\text{ m}, Y = 50\text{ m})$ using a $6\text{ km/h}$ fast-turn creep ($45^\circ/\text{s}$ moving turn rate vs $30^\circ/\text{s}$ stationary pivot) whenever $4.5\text{--}6\text{ m}$ ahead is clear, ready to immediately advance and crossfire the instant an enemy tank exits the hangar.
- **Macro-Scale 2D Cost Grid:** Discretizes the $250\text{ m} \times 100\text{ m}$ arena into $2.0\text{ m}$ cells ($125 \times 50$ cells in a `Uint8Array`):
  - Lethal hazards (water pits and mines within `MINE_LETHAL_RADIUS_M`): `COST_LETHAL = 255`.
  - Soft obstacles (building walls and arena borders): `COST_HOUSE = 12`.
  - Open arena: `COST_OPEN = 1`.
- **Dynamic Window Trajectory Rollout (DWA):**
  - Evaluates candidate steering arcs ($\{-45^\circ, -30^\circ, -15^\circ, 0^\circ, 15^\circ, 30^\circ, 45^\circ\}/\text{s}$) over a $1.8\text{ s}$ horizon (6 simulation steps).
  - Rejects any trajectory whose step endpoint **or step midpoint** contacts water pits, falls within `MINE_LETHAL_RADIUS_M` ($5.26\text{ m}$) of a mine, or enters the enemy slit gun sector (`marginM = 2.0 m`).
  - **Radial Escape from Enemy Slit-Gun Sector:** If a tank is already inside the enemy slit-gun sector, DWA switches to an escape evaluator that scores trajectories by immediate radial distance gained away from the enemy gate ($\Delta dx$) and lateral escape from the $Y = 50\text{ m}$ center channel, rapidly backing or steering the tank out to the $37\text{ m}$ Forward Containment Arc.
  - `getAttackStandoffWaypoint` also rejects any candidate flanking waypoint within `MINE_LETHAL_RADIUS_M + 1.5 m` ($6.76\text{ m}$) of a mine or inside the enemy slit-gun sector.
  - Penalizes arcs passing within $6.0\text{ m}$ of friendly tanks, eliminating bunching.
- **Gate Reservation Mutex:** `GateReservationManager` ensures only a single tank transits or approaches the $7\text{ m}$ gateway at a time. Other retreating or deploying units hold at lateral staging waypoints ($Y = 32\text{ m}$ or $68\text{ m}$).

### 5.2 Target Selection & Active-Threat Prioritization (`src/sim/ai/executor.js`)
Target selection evaluates all visible (or smoke-tracked) enemy field tanks and selects the minimum-score target:
- **Slit-Gun Bait Rejection (`targetInEnemySlit`):**
  - Any enemy tank sitting inside its own base's slit-gun firing sector (`isInEnemySlitGunSector(e.x, e.y, e.owner, 1.0)`) is ignored as a pursuit target unless it is already within immediate gun reach (`dist <= SHELL_RANGE_M + 2.0 m` $= 34\text{ m}$). This prevents AI tanks from being baited into enemy slit-gun crossfire when an enemy retreats into or lingers near its hangar doorway.
- **Active-Attacker & Base-Raider Priority (`activeThreatBonus`):**
  - Moving enemy tanks ($|v| > 1.5\text{ m/s}$) receive a $-38\text{ pt}$ score reduction (higher priority), plus an additional $-24\text{ pt}$ reduction ($-62\text{ pt}$ total) when raiding within $60\text{ m}$ of the AI's own gate. This ensures the AI focuses fire on active human raiders instead of shooting unmanned tanks parked at spawn.
- **Gate-Emergence Filter (`isEmergingFromGate`):**
  - The $-70\text{ pt}$ gate-emergence bonus ($\Delta X \le 9\text{ m}, \Delta Y \le 5\text{ m}$ from the enemy gate) only applies if the enemy tank is **actively moving** ($|v| > 0.5\text{ m/s}$), preventing stationary spawn reserves from acting as permanent target magnets.
- **Extended Opportunity Intercept (`37 m`):**
  - Unblocked targets within `AI_TARGET_OPPORTUNITY_MAX_DIST_M + 12 m` ($37\text{ m}$) that are outside the enemy slit-gun sector trigger direct opportunity engagement (`isOpportunityTarget`), steering directly toward the target rather than detouring to a lateral standoff waypoint.

### 5.3 Hull Aiming, Mobile Turn-to-Aim & Ballistic Fire Reflex (`aiming.js`, `weapons.js`)
- **Full-Range Moving-Target Engagement:**
  - `AI_EFFECTIVE_MOVING_RANGE_M` equals the full physical `SHELL_RANGE_M` ($32\text{ m}$), so `HARD` AI engages moving targets at full range without artificial distance clipping.
- **Two-Step Iterative Curvilinear Muzzle Lead (`leadPoint`):**
  - Accounts for the $3.5\text{ m}$ gun muzzle forward offset (`TANK_LENGTH_M / 2 + SHELL_MUZZLE_OFFSET_M`) when computing projectile flight time $t_{\text{fly}} = \min(0.4\text{ s}, \max(0, d - 3.5\text{ m}) / v_{\text{shell}})$, refined over two iterations.
  - Projects target motion along a curvilinear circular arc when angular velocity $|\omega| > 0.04\text{ rad/s}$ and $|v| > 0.3\text{ m/s}$, or straight-line dead-reckoning otherwise.
  - Reports both center-to-lead distance (`leadDist`) and muzzle-to-lead distance (`muzzleDist = max(0, leadDist - 3.5 m)`).
- **Early Pre-Alignment, Slit-Sector Guard & 4-Tier Mobile Turn-to-Aim (`findAimSolution`):**
  - **Pre-Alignment Window & Hazard/Slit Guard:** Aiming activates whenever `lead.muzzleDist <= maxEngageDist + 16.0 m` ($\approx 48\text{ m}$ from muzzle) and line of fire is clear, provided the forward hull corridor is free of mines, pits, walls, and the enemy slit-gun sector (`isForwardArcHazardous`). When the tank is already within firing range ($\le 30\text{ m}$) or nearly aligned ($|\text{errRad}| < 0.35\text{ rad}$), the forward hazard check uses a compact $7.0\text{ m}$ probe so tanks near a pit or wall can still aim and fire at enemies in open ground instead of freezing.
  - **Mobile Turn-to-Aim Speed Ladder:** Because moving tanks turn at $45^\circ/\text{s}$ (`TANK_MAX_TURN_DEG_S`) whereas stationary tanks pivot at only $30^\circ/\text{s}$ (`TANK_MAX_PIVOT_TURN_DEG_S`), the AI stays mobile while turning:
    1. `lead.muzzleDist > maxEngageDist - 1.0 m` and $|\text{errRad}| < 1.0\text{ rad}$: commands $36\text{ km/h}$ (`maxSpeedKmh`) to close distance with the barrel pre-aligned on the lead point (unless the target is inside the enemy slit-gun sector, where forward speed is capped to $0\text{ km/h}$ if $dx < 38\text{ m}$).
    2. $|\text{errRad}| > 0.16\text{ rad}$ ($\approx 9.2^\circ$): commands $18\text{ km/h}$ with proportional turn gain $\ge 2.2$ so the hull turns at the full $45^\circ/\text{s}$ moving limit while remaining evasive.
    3. $|\text{errRad}| > 0.04\text{ rad}$ ($\approx 2.3^\circ$) or target moving ($|v| > 2.0\text{ m/s}$): commands $6\text{ km/h}$ to retain $45^\circ/\text{s}$ turn authority during fine tracking.
    4. $|\text{errRad}| \le 0.04\text{ rad}$ against slow/stationary target: commands $0\text{ km/h}$.
  - Turn rate hysteresis around $180^\circ$ prevents direction fluttering when acquiring targets directly behind.
- **Dual Precision Firing Gate (`tryFireWeapon`):**
  - Evaluates targets up to `lead.muzzleDist <= maxEngageDist + 2.6 m` (accounting for the target hull's $3.0\text{ m}$ half-length and $2.0\text{ m}$ half-width so head-on and oblique shots that physically reach the hull within $32\text{ m}$ of shell travel are taken immediately).
  - On `HARD`, removes random lead dispersion and misfire delay, pulling the trigger when line-of-fire is clear and **either**:
    1. **Ballistic Ray-vs-OBB Intersection:** The $32\text{ m}$ ray from the gun muzzle `(mx, my)` along `tank.heading` intersects (`segmentVsObb`) the $88\%$-scaled predicted target OBB at shell arrival time $t_{\text{arrival}}$, **or**
    2. **Strict Angular Gate:** `lead.muzzleDist <= maxEngageDist + 1.5 m` and `aimErr <= Math.max(0.03, Math.min(targetAngularHalfWidth, profile.fireTolerance))`—using `Math.min` on `HARD` so the tank never fires prematurely at $6^\circ\text{--}7^\circ$ off-bore before the barrel points inside the target's angular width.

### 5.4 Parallel Multi-Tank Command Architecture, Mine/Slit Avoidance & Defensive Mine Laying
- **Unified Hazard & Slit-Sector Check (`isPathClearOfPits` in `commander.js`):**
  - Validates arena boundary margins ($6.5\text{ m}$ outside gate lane), water pits, mines (`MINE_LETHAL_RADIUS_M + 1.0 m` $= 6.26\text{ m}$ lateral clearance), **and** enemy slit-gun sectors (`isSegmentInEnemySlitGunSector` with $2.0\text{ m}$ margin) across initial brigade mobilization, unselected rearming, unselected cruising, and stopped-unit restarts.
  - **Anti-Corner-Swing Mine Escape:** Because a $6\text{ m} \times 4\text{ m}$ tank hull pivoting near a mine ($d \le 6.76\text{ m}$) can swing its rear or front corner into the $1.0\text{ m}$ mine trigger radius, stopped or slow tanks within `MINE_LETHAL_RADIUS_M + 1.5 m` of a mine are forbidden from pivoting in place (`cmdTurnDeg = 0` when `cmdSpeedKmh === 0`) and instead drive straight forward (`cmdTurnDeg = 0, cmdSpeedKmh = 18`) if the straight path increases distance from the mine.
- **Per-Tick Parallel Multi-Tank Controller (`enforceUnselectedTanksSafety` & `updateCommander`):**
  - Runs every simulation tick for **all unselected field tanks** (including when the AI is currently operating a hangar slit-gun window in `pl.view === 'window'`):
    1. **Unselected Incoming-Shell Dodge Reflex:** If an enemy shell within $34\text{ m}$ is flying toward an unselected tank ($\text{dot} > 0.88$, lateral miss distance $< 3.6\text{ m}$), the unselected tank immediately jinks perpendicular to the shell trajectory at $36\text{ km/h}$ and $45^\circ/\text{s}$ (provided the $10\text{ m}$ escape path is clear of pits and mines).
    2. **Unselected Slit-Gun Sector Escape:** If an unselected tank is inside or within $2.2\text{ m}$ of the enemy slit-gun firing sector, it immediately steers radially outward toward the safe Forward Containment Arc ($dx = 38\text{ m}, Y = 26\text{ m}$ or $74\text{ m}$) at $36\text{ km/h}$, or reverses out at $-12\text{ km/h}$ if forward escape angles are blocked.
    3. **Hazard Evasion & Current-Heading Safety Verification:** Before accelerating toward any target or waypoint, an unselected tank verifies that its **current physical heading** (`t.heading`) is clear over $\max(10\text{ m}, 1.5 \cdot |v|)$ so it never accelerates forward into a mine or pit while still turning toward a safe desired bearing.
    4. **Parallel Brigade Task Partitioning (Wolfpack Crossfire vs. Unattended-Tank Hunters):**
       - **Wolfpack Crossfire Swarm (Up to 3 Closest Armed Tanks):** When one or more enemy tanks outside the enemy slit-gun sector are actively moving ($|v| > 1.0\text{ m/s}$), the closest 3 armed friendly tanks (`wolfpackRank = 0, 1, 2`) converge on the primary active attacker along three distinct crossfire bearings ($0\text{ rad}$ direct lead, $+0.52\text{ rad}$ / $+30^\circ$ left pincer, and $-0.52\text{ rad}$ / $-30^\circ$ right pincer at $22\text{ m}$ standoff).
       - **Unattended-Tank Hunters (Remaining Armed Tanks):** Remaining armed friendly tanks (`wolfpackRank >= 3`) hunt down unattended/stationary enemy tanks ($|v| \le 1.0\text{ m/s}$) outside the enemy slit-gun sector.
    5. **Continuous Parallel Pre-Aiming & Forward Containment Orientation:**
       - **Within $50\text{ m}$ of Assigned Target:** Unselected tanks continuously steer (`cmdTurnDeg` in $15^\circ, 30^\circ, 45^\circ/\text{s}$ steps) onto their assigned target's iterative `leadPoint`, closing at $36\text{ km/h}$ outside firing range, turning at $18\text{ km/h}$ ($45^\circ/\text{s}$) when $|\text{err}| > 0.14\text{ rad}$, and tracking at $6\text{ km/h}$ when locked on (`|err| <= 0.035 rad`) so `runDispatcher` can trigger an instant $0.08\text{ s}$ volley shot (`combatScore = 98..99`).
       - **On the Forward Containment Arc (No Exposed Enemies):** Unselected tanks parked within $8\text{ m}$ of their containment waypoint pre-rotate toward the enemy gate exit $(gx \pm 12\text{ m}, Y = 50\text{ m})$ at $6\text{ km/h}$ ($45^\circ/\text{s}$ fast turn) when $4.5\text{ m}$ ahead is clear, then hold at $0\text{ km/h}$ once aligned within $4^\circ$.
- **Slit-Window Dead-Zone Guard (`src/sim/ai/slit.js`, `src/sim/ai/executor.js`):**
  - Hangar slit guns have a hard physical traverse stop of `SLIT_MAX_YAW_RAD` ($\pm 45^\circ \approx 0.785\text{ rad}$) and require $|\text{yawErr}| \le 0.12\text{ rad}$ to fire. Both `executeTactics` (before entering window view) and `updateSlit` (while operating window view) strictly reject enemies whose relative yaw from the window exceeds `SLIT_MAX_YAW_RAD + 0.06 rad`, preventing the AI from locking up in window view when an enemy tank parks near the base wall outside the $45^\circ$ firing cone.
- **Hardened Defensive Mine Laying (`executeTactics`):**
  - Enabled via `AI_MINES_ENABLED = true`, with strict anti-fratricide and pursuit checks:
    - Never lays mines inside own gate approach corridor ($\Delta X < 14\text{ m}, \Delta Y < 6\text{ m}$) or when any friendly tank is within $\max(18\text{ m}, \text{AI\_MINE\_FRIENDLY\_SAFE\_DIST\_M})$.
    - Requires an enemy actively pursuing in the rear wake corridor ($x_{\text{local}} \in [-24, -2]\text{ m}$, $|y_{\text{local}}| < 5.0\text{ m}$, $v > 1.5\text{ m/s}$, and heading alignment $\cos(\theta_e - \theta_{\text{tank}}) > 0.35$), including during base defense (`gateThreat` within $40\text{ m}$).
- **Reverse Safety:** Stuck-recovery reverse maneuvers verify that no mine lies within $8.0\text{ m}$ behind the hull before backing up.

### 5.5 Fair Smoke Obscuration & Dead-Reckoning
- Active smoke clouds completely block line-of-sight for both tank crews and slit sentries (`isLineOfSightBlockedBySmoke`). The AI never cheats through smoke.
- `enemyTracker` records last-known enemy position and velocity, applying dead-reckoning extrapolation with spatial dispersion ($\pm 1.5\dots 4.0\text{ m}$) for blind fire into smoke.
- Confidence decays rapidly over time; firing ceases when confidence falls below difficulty thresholds.

### 5.6 Pre-Switch Safe Cruising Trim (`applySafeCruisingTrim`)
Before relinquishing control of a tank, the AI zeroes turn commands (`cmdTurnDeg = 0`) and projects a $3.5\text{ s}$ ($\ge 25\text{ m}$) lookahead path checking boundaries, pits, obstacles, mines (`MINE_LETHAL_RADIUS_M`), friendly tanks, and enemy slit sectors:
- If clear: locks stable cruising speed ($18$ or $36\text{ km/h}$).
- If a hazard is ahead: veers away at creep speed ($6\text{ km/h}$, `AI_TRIM_ESCAPE_SPEED_KMH`) along the first clear escape offset ($\pm 0.5, \pm 1.0\text{ rad}$), or issues an emergency `STOP` if boxed in.

---

## 6. Difficulty Profiles & Threshold Fuzzing (`src/sim/ai/profiles.js`, `src/sim/ai/math.js`)

| Parameter | EASY | MEDIUM | HARD |
|---|---|---|---|
| Decision Interval (`tickInterval`) | ~0.16 s | ~0.10 s | ~0.05 s |
| Brigade Coord Interval (`coordInterval`) | 3.5 s | 2.0 s | 1.2 s |
| Threshold Randomness (`noiseFactor`) | **High (`0.32` / $\pm 32\%$)** | **Moderate (`0.14` / $\pm 14\%$)** | **Low (`0.03` / $\pm 3\%$)** |
| Aim / Fire Tolerance | ~7° / ~10° (0.0 lead) | ~4.5° / ~8° (0.5 lead) | ~3° / Hull-OBB gated (1.0 curvilinear lead) |
| Max Firing Distance (`maxFireDist`) | 16 m | 22 m | Full shell range ($32\text{ m}$ stationary & moving) |
| Max Cruising Speed (`maxSpeedKmh`) | 18 km/h | 36 km/h | 36 km/h |
| Standoff / Min Distance | 12 m / 8 m | 15 m / 9 m | 18 m / 10 m |
| Tactical Countermeasures (`useSmoke` / `useMines`) | Low (0.2) | Medium (0.6) | High (0.9) |
| Blind Fire Confidence Threshold | $\ge 0.65$ | $\ge 0.45$ | $\ge 0.30$ |

### 6.1 Generic Domain-Safe Threshold Fuzzing (`fuzz` in `src/sim/ai/math.js`)
- Every non-integer numeric comparison across the AI controller (distances, angles, speeds, durations/hold times, urgency scores) passes through `fuzz(value, profileOrLevel, min, max)`.
- `fuzz` perturbs `value` by a uniform relative factor in $[-\text{noiseFactor}, +\text{noiseFactor}]$ while strictly enforcing domain boundaries:
  - Positive quantities (times, distances, speeds, angle magnitudes) are clamped above a positive floor ($\ge \max(0, \text{min})$ or $0.1 \cdot \text{value}$) so subtraction of a random delta never produces negative or zero durations/distances.
  - Negative quantities (such as rear wake local coordinates $-2.0\text{ m}$ or $-24.0\text{ m}$) are clamped below zero ($\le \min(0, \text{max})$) so they never flip sign.
  - Explicit `[min, max]` domain bounds clamp the result to safe operational ranges.
- **Difficulty Behavioral Effect:**
  - **`HARD` (`noiseFactor = 0.03`):** High predictability and near-optimal execution, while the $\pm 3\%$ micro-randomness breaks symmetric deadlocks (e.g., two tanks circling each other in a turning loop).
  - **`MEDIUM` (`noiseFactor = 0.14`):** Moderate variation in engagement distances, reaction timings, and lead accuracy.
  - **`EASY` (`noiseFactor = 0.32`):** High distortion in distance/angle/speed/time comparisons plus occasional unselected-unit reaction lag (`commander.js`), making the AI noticeably hesitate, misjudge ranges, and play sub-optimally without crashing or violating physical bounds.

---

## 7. AI Diagnostic Tooling, Replay Slicing & Telemetry

- **On-Screen Decision Log Panels:** For AI-controlled sides, scrolling telemetry appears in the canvas margins outside the 2D map, streaming timestamped decisions: `DOCTRINE`, `PLAN`, `ROLES`, `ATTACK`, `PURSUE`, `AIM`, `AVOID`, `SLIT`, `REARM`, `DEPLOY`, `FIRE`, `SELECT`, `LOSS`, `SMOKE`, `MINE`, `AMBUSH`.
- **Headless VCR Tool (`.\vcr.cmd [seconds] [level] [seed]`):** Runs deterministic headless AI matches producing comprehensive logs of tank states and strategic choices for tuning without browser overhead.
- **Benchmark Suite (`.\bench.cmd [seeds] [seconds] [level]`):** Aggregates win rates, tank losses, accuracy, pit deaths, and friendly/enemy mine casualties across seeded matches to validate AI improvements.
- **Saved-Game Replay Forensics & Slice Simulation Suite (`tools/`):**
  - `tools/replays/`: Stores real HvC match recordings (`game1_hvc_hard.replay`, `game2_hvc_hard.replay`, `game3_hvc_hard.replay`) used for regression testing and AI battle hardening.
  - `tools/replay_utils.js`: Node.js utilities (`loadReplay`, `analyzeReplayEvents`, `sliceReplayFrames`, `createWorldAtTime`, `simulateMoment`) that decompress base64 recordings via `PlaybackController`, assign valid field numbers `'1'..'5'` to deployed reserve tanks (`id >= 20`), reconstruct world state at any timestamp `startT`, and replay human-controlled Red motions/shots/slit-guns/mines while running live `AiController` logic for Blue.
  - `tools/analyze_replay.js`: CLI analyzer printing chronological kills, causes of death (tank shell, slit gun, mine, pit), shooter distances, and active/unselected tank states.
  - `tools/sim_replay.js`: Automated regression and validation runner that simulates critical battle slices across all saved games (`GAME1_MOMENTS`, `GAME2_MOMENTS`, `GAME3_MOMENTS`) or any custom time window (`node tools/sim_replay.js <replay_file> <start_sec> <duration_sec> [level]`).
