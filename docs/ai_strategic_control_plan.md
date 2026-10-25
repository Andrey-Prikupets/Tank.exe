# Architectural Plan: AI Strategic Brigade Control in Tank.exe

## 1. Executive Summary & Root Cause Analysis

### Current Limitations
In **Tank.exe**, the simulation rules dictate that player controls (linear speed, rotational turn, fire, secondary weapons) are directly issued to **only the currently selected unit**. Unselected tanks continue moving on their last commanded linear speed and turn rate indefinitely until commanded again.

The current AI controller behaves myopically:
1. **Blind Round-Robin Cycling:** Every 2.0 seconds, it simply rotates to the next tank (`1 -> 2 -> 3 -> 4 -> 5 -> 1`).
2. **Zero Situational Prioritization:** It switches away from a tank that is engaged in an active firefight, leaving it unable to dodge or aim. Conversely, an unselected tank driving towards a lethal water pit or building obstacle remains unselected until its turn comes 8 seconds later, leading to avoidable collisions and drownings.
3. **No Coordinated Formations or Roles:** Tanks do not operate as a cohesive 5-tank brigade. Each unit drives forward independently in a straight corridor rather than executing coordinated pincer movements, crossfire traps, or layered defensive formations.
4. **No Dynamic Strategy Switching:** The AI lacks the capability to detect high-level battle phase transitions (e.g., enemy assault on base, severe casualties, or opponent ammo depletion) and cannot pivot its plan on the fly.

---

## 2. High-Level Architecture: Three-Tier Hierarchy

```
+-------------------------------------------------------------+
|             TIER 1: BRIGADE COMMANDER                      |
|  - Assesses global battlefield state every 1.0s             |
|  - Selects active Brigade Strategic Plan                    |
|  - Assigns tactical roles to all 5 tanks                    |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|             TIER 2: TIME-SLICE DISPATCHER                   |
|  - Replaces fixed round-robin with Urgency-Weighted Priority|
|  - Evaluates immediate micro-needs across all 5 tanks       |
|  - Instantly switches selection to the most critical unit   |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|             TIER 3: TACTICAL UNIT EXECUTOR                  |
|  - Executes role-specific behavior (Vanguard, Flanker, etc.)|
|  - Calculates safe trajectory & cruising vectors            |
|  - Performs aim alignment, weapon fire, and hazard evasion  |
+-------------------------------------------------------------+
```

---

## 3. Tier 1: Brigade Strategic Plans & Formations

The Commander evaluates the battlefield state and dynamically executes one of four strategic plans:

### Plan Alpha: "Pincer Envelopment" (Default Offensive)
- **Objective:** Overwhelm the opponent from opposing edges while pinning the center.
- **Roles:**
  - **Tank 1 (Vanguard/Decoy):** Advances along centerline ($Y \approx 50$), holding a conservative standoff distance ($32\text{ m}$) to attract fire.
  - **Tank 2 & 3 (North Flankers):** Move along upper boundary ($Y = 15\text{--}25$), flanking around buildings to attack from the enemy's blind side.
  - **Tank 4 & 5 (South Flankers):** Move along lower boundary ($Y = 75\text{--}85$), coordinating convergence upon the enemy gate.

### Plan Bravo: "Wedge Breach" (Concentrated Assault)
- **Objective:** Punch through a single weak sector when enemy forces are dispersed.
- **Roles:**
  - **Tank 1 & 2:** Lead spearhead abreast ($4\text{ m}$ lateral spacing), advancing aggressively with maximum cruising speed.
  - **Tank 3 & 4:** Trailing support echelon ($12\text{ m}$ behind spearhead), firing past lead tanks through open sight lines.
  - **Tank 5:** Rearguard / Interceptor preventing rear flanks.

### Plan Charlie: "Base Defense & Slit Crossfire" (Defensive Retraction)
- **Objective:** Defend the home gate when opponent forces advance deep into home territory ($< 50\text{ m}$ from gate).
- **Roles:**
  - **Hangar Slit Sentry:** Commander switches view to active slit window, exploiting infinite ammo to suppress incoming attackers.
  - **Tanks 1--3:** Form a defensive arc around the gateway perimeter ($20\text{--}30\text{ m}$ out), laying mines in approach lanes.
  - **Tanks 4 & 5:** Staggered rear reloaders cycling through hangar slots for fresh ammo.

### Plan Delta: "All-Out Pursuit" (Exploitation)
- **Objective:** Triggered when enemy tanks are out of ammunition, retreating, or outnumbered $\ge 3:1$.
- **Roles:** All available units switch to high-speed pursuit ($36\text{ km/h}$), cutting off retreat angles towards the enemy gate.

---

## 4. Tier 2: Urgency-Weighted Time-Slice Dispatcher

Instead of switching tanks at static time intervals, the dispatcher continuously evaluates an **Urgency Score ($U_i$)** for every live tank $i \in [1..5]$ each simulation tick:

$$U_i = W_{\text{hazard}} \cdot H_i + W_{\text{combat}} \cdot C_i + W_{\text{rearm}} \cdot R_i + W_{\text{starvation}} \cdot S_i$$

### Urgency Weighting Matrix:
1. **Critical Hazard Threat ($H_i \in [0, 100]$):**
   - Imminent pit or obstacle collision within $1.5\text{ s}$ course projection: **Score = 95**
   - Mine in forward or reverse path: **Score = 90**
2. **Combat Firing Opportunity ($C_i \in [0, 80]$):**
   - Shell loaded, gun pointed within $5^\circ$ of unblocked enemy target: **Score = 80**
   - Incoming hostile shell on collision course (requires immediate smoke/turn): **Score = 75**
3. **Rearm & Gate Clearance ($R_i \in [0, 60]$):**
   - Ammo depleted, needs course alignment toward hangar doors: **Score = 50**
4. **Starvation / Neglect ($S_i \in [0, 40]$):**
   - Accumulated elapsed time since unit was last commanded: **$+5\text{ points/sec}$** (ensures no tank is abandoned).

**Selection Rule:** When $\max(U_i) - U_{\text{current}} > \Delta_{\text{threshold}}$, the dispatcher instantly switches selection to Tank $i$, commands corrective/firing action for a micro-slice ($150\text{--}300\text{ ms}$), and re-evaluates.

---

## 5. Dynamic Plan Adaptation ("Quickly Change Plan")

The Commander continuously tracks battlefield telemetry and triggers immediate plan transitions:

| Trigger Condition | Current Plan | New Plan | Action Taken |
|---|---|---|---|
| **Enemy unit penetrates within $45\text{ m}$ of gate** | Pincer / Wedge | **Plan Charlie (Base Defense)** | Immediate retraction of nearest tanks; commander mans slit window |
| **Friendly casualty ($\ge 2$ tanks lost within $8\text{ s}$)** | Wedge / Pursuit | **Plan Alpha (Pincer/Standoff)** | Disengage from close brawl; fall back to safe standoff distance |
| **All active tanks out of shells** | Offensive | **Coordinated Rearm** | Staggered hangar retreat while active sentry suppresses via slit |
| **Enemy brigade low on shells ($\le 1$ avg ammo)** | Defense / Pincer | **Plan Delta (Pursuit)** | Full offensive charge; surround enemy and deny hangar entrance |

---

## 6. Micro-Waypoint Course Projection for Unselected Tanks

Before the dispatcher switches selection away from Tank $A$ to Tank $B$, it must ensure Tank $A$ is left in a **stable cruising vector**:
1. **Clear Path Verification:** AI projects Tank $A$'s current speed and turn rate forward for $3.0\text{ s}$.
2. **Safe Trim Application:**
   - If forward path approaches a boundary or obstacle, AI zeroes turn rate (`TURN_L` / `TURN_R` back to $0^\circ/\text{s}$) or reduces speed to $12\text{ km/h}$ to prevent high-speed collisions.
   - If positioned in an open lane, AI locks a stable forward speed ($24\text{--}36\text{ km/h}$) with $0^\circ/\text{s}$ turn rate so the tank holds its tactical heading reliably.

---

## 7. Phased Implementation Roadmap

- [x] **Phase 1: Foundation (Completed):**
  - Organic decision asymmetry, desynchronized tick/coordination timers, personality jitter.
  - Obstacle LOS checking, threat weighting, lock hysteresis, and tie-breaking noise.
  - Strategic map UI: 2 thin directional arrows from active units to locked targets.
  - Hangar slit window aiming and defensive firing.
- [ ] **Phase 2: Urgency-Weighted Time-Slice Dispatcher:**
  - Implement urgency scoring across all 5 brigade tanks.
  - Replace static cyclic timeout with priority-based micro-switching.
- [ ] **Phase 3: Formation & Role Assignment Engine:**
  - Implement North/South Flanker, Vanguard, and Anchor tactical roles.
  - Implement stable cruising course projection for unselected tanks.
- [ ] **Phase 4: Commander Strategic State Machine:**
  - Implement real-time plan switching (Pincer, Wedge, Base Defense, Pursuit).
  - Telemetry monitoring for casualty rates, penetration threats, and ammunition levels.
